/**
 * Chat sessions (#189): an agent harness driven by the Chat pane in the agents view instead of
 * a PTY. This module is the harness-neutral part: session list, replay buffer, watchers, orphan
 * timer. A driver per protocol (chatDrivers/) spawns the CLI and translates its protocol into
 * Claude Code's stream-json event shapes, which the client reducer (utils/chatEvents.ts) reads:
 *
 * | harness        | driver   | protocol                     |
 * | :------------- | :------- | :--------------------------- |
 * | claude         | claude   | `claude -p` stream-json      |
 * | omp, opencode  | acp      | ACP (`omp acp`, `opencode acp`) |
 * | pi             | piRpc    | `pi --mode rpc`              |
 * | codex          | codex    | `codex app-server`           |
 *
 * Driver interface: `startDriver(opts, { bin, spawn, emit, exit })` returns
 * `{ send(text), interrupt(), answer(requestId, decision), stop() }`. Resume ids are checked
 * here first (Claude's UUID, else `HARNESS_RESUME` in config/harnesses.js, the same ids the
 * terminal resume takes). The driver emits Claude-shaped events, this module adds `devorbit_user`,
 * `devorbit_permission` and `devorbit_exit`.
 */
import { spawn as nodeSpawn } from 'child_process';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs';
import { HARNESS_RESUME, resolveHarnessBinary } from '../../config/harnesses.js';
import { ompSkillsArgs } from './ompSkills.js';
import { promptImages } from './imageUpload.js';
import * as claudeDriver from './chatDrivers/claude.js';
import * as acpDriver from './chatDrivers/acp.js';
import * as piRpcDriver from './chatDrivers/piRpc.js';
import * as codexDriver from './chatDrivers/codex.js';
import {
  assertAllowedPath,
  getAllowedDirectories,
  isUnsafeFlagsAllowed,
  resolveClaudeBinary,
  replySession,
  interruptSession,
  listSlashCommands,
  listSubagents,
} from './agentService.js';

const { findTranscript, historyEvents, commandsEvent, HISTORY_BYTES } = claudeDriver;

/** harness → driver module */
const DRIVERS = {
  claude: claudeDriver,
  omp: acpDriver,
  opencode: acpDriver,
  pi: piRpcDriver,
  codex: codexDriver,
};
export const CHAT_HARNESSES = Object.keys(DRIVERS);

export const PERMISSION_MODES = ['default', 'acceptEdits', 'auto', 'manual', 'dontAsk', 'plan'];
const MODEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._[\]-]{0,79}$/;
const NAME_RE = /^[^\0\n\r]{1,80}$/;
/** Replay buffer per session; stream deltas are live-only, the full messages replay */
const MAX_EVENTS = 5000;
/** A chat nobody watches is stopped after this long (pane closed without stop, tab gone) */
const ORPHAN_TIMEOUT_MS = Number(process.env.DEVORBIT_CHAT_ORPHAN_MS) || 10 * 60 * 1000;

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

/**
 * Validate a start request. Throws 400/403 before anything is spawned.
 * Model, permission mode, skip permissions and continue are Claude Code options; the other
 * harnesses start with their own configured defaults.
 * @returns {{harness: string, cwd: string, model?: string, permissionMode?: string,
 *   resume?: string, continue?: boolean, skipPermissions?: boolean, name?: string}}
 */
export function sanitizeChatOptions(opts = {}, context = {}) {
  const harness = opts.harness ?? 'claude';
  if (!Object.hasOwn(DRIVERS, harness)) throw badRequest('Unknown harness');
  const allowedDirs = context.allowedDirs ?? getAllowedDirectories();
  if (allowedDirs.length === 0) {
    const error = new Error('No project directories are configured');
    error.status = 403;
    throw error;
  }
  let cwd;
  try {
    cwd = assertAllowedPath(opts.cwd, allowedDirs, 'Working directory');
  } catch (error) {
    // Contract #189: every invalid start parameter is a 400, including cwd outside the allowlist
    error.status = 400;
    throw error;
  }
  const out = { harness, cwd };
  const given = (v) => v != null && v !== '' && v !== false;
  if (harness !== 'claude') {
    for (const key of ['model', 'permissionMode', 'skipPermissions', 'continue'])
      if (given(opts[key])) throw badRequest(`${key} is a Claude Code option`);
  }
  if (given(opts.model)) {
    if (typeof opts.model !== 'string' || !MODEL_RE.test(opts.model))
      throw badRequest('Invalid model');
    out.model = opts.model;
  }
  if (given(opts.permissionMode)) {
    if (!PERMISSION_MODES.includes(opts.permissionMode))
      throw badRequest('Invalid permission mode');
    out.permissionMode = opts.permissionMode;
  }
  if (given(opts.resume)) {
    const idRe = harness === 'claude' ? claudeDriver.SESSION_ID_RE : HARNESS_RESUME[harness].id;
    if (typeof opts.resume !== 'string' || !idRe.test(opts.resume))
      throw badRequest('Invalid session id');
    out.resume = opts.resume;
  }
  if (opts.continue === true) {
    if (out.resume) throw badRequest('Use either resume or continue');
    out.continue = true;
  }
  if (opts.skipPermissions === true) {
    if (!(context.unsafeAllowed ?? isUnsafeFlagsAllowed())) {
      const error = new Error(
        'Skip permissions is disabled on this server. Start it with DEVORBIT_AGENTS_ALLOW_UNSAFE_FLAGS=true to enable it.'
      );
      error.status = 403;
      throw error;
    }
    out.skipPermissions = true;
  }
  if (given(opts.name)) {
    if (typeof opts.name !== 'string' || !NAME_RE.test(opts.name)) throw badRequest('Invalid name');
    out.name = opts.name;
  }
  return out;
}

const sessions = new Map();
export const chatEvents = new EventEmitter();
chatEvents.setMaxListeners(0);

function summary(s) {
  return {
    id: s.id,
    harness: s.harness,
    cwd: s.cwd,
    name: s.name,
    sessionId: s.sessionId,
    model: s.model,
    busy: s.busy,
    running: s.running,
    startedAt: s.startedAt,
    pendingPermissions: s.pending.size,
    view: s.view ?? null,
  };
}

function record(s, event) {
  if (event.type === 'devorbit_commands') {
    // One merged list in the replay buffer, however often the CLI re-sends it
    const prev = s.events.findIndex((e) => e.type === 'devorbit_commands');
    if (prev >= 0) {
      event = { ...s.events[prev], ...event };
      s.events.splice(prev, 1);
    }
  }
  // Deltas are only useful live; the full assistant message replays on reconnect
  if (event.type !== 'stream_event') {
    s.events.push(event);
    if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
  }
  chatEvents.emit(`event:${s.id}`, event);
}

/** A driver event: session id, model, open permission requests and the busy flag ride along */
function handleEvent(s, event) {
  // Context fill and plan limits a harness reports: status line data, not a chat message
  if (event.type === 'devorbit_usage') {
    s.usage = {
      ...s.usage,
      ...(event.context && { context: event.context }),
      ...(event.limits && { limits: event.limits }),
    };
    return;
  }
  if (event.session_id && !s.sessionId) s.sessionId = event.session_id;
  if (event.type === 'system' && event.subtype === 'init' && event.model) s.model = event.model;
  if (event.type === 'control_request' && event.request?.subtype === 'can_use_tool')
    s.pending.add(event.request_id);
  if (event.type === 'result') {
    s.busy = false;
    // A turn that ended (interrupted) left its open requests unanswerable: close their cards
    for (const requestId of s.pending)
      record(s, { type: 'devorbit_permission', request_id: requestId, decision: 'deny' });
    s.pending.clear();
  }
  record(s, event);
}

/** Driver call on a live session; a dead process or a live view is a 400 */
function live(s) {
  if (s.view) throw badRequest('Live view: the agent runs in its own process, use its terminal');
  if (!s.running) throw badRequest('Chat session is not running');
  return s.driver;
}

/**
 * Start a chat session. `spawn` and `bin` are injectable for tests.
 * @returns {object} session summary
 */
export function startChat(opts, context = {}) {
  const safe = sanitizeChatOptions(opts, context);
  const bin =
    context.bin ??
    (safe.harness === 'claude' ? resolveClaudeBinary() : resolveHarnessBinary(safe.harness));
  if (!bin || bin.includes('via PTY-Host')) {
    const error = new Error(`Chat needs a local ${safe.harness} CLI`);
    error.status = 501;
    throw error;
  }
  const s = {
    id: crypto.randomUUID(),
    harness: safe.harness,
    cwd: safe.cwd,
    name: safe.name || safe.cwd.split('/').pop() || 'chat',
    sessionId: safe.resume || null,
    model: safe.model || null,
    busy: false,
    running: true,
    startedAt: Date.now(),
    driver: null,
    events: [],
    pending: new Set(),
    watchers: 0,
    orphanTimer: null,
  };
  s.exited = new Promise((resolve) => {
    s.markExited = resolve;
  });
  sessions.set(s.id, s);
  s.driver = DRIVERS[safe.harness].startDriver(safe, {
    bin,
    // omp: the user's Claude skills (ompSkills.js); tests inject their own
    extraArgs: context.extraArgs ?? (safe.harness === 'omp' ? ompSkillsArgs(bin, safe.cwd) : []),
    spawn: context.spawn ?? nodeSpawn,
    emit: (event) => handleEvent(s, event),
    exit: ({ code, stderr }) => {
      if (!s.running) return;
      s.running = false;
      s.busy = false;
      s.markExited();
      clearTimeout(s.orphanTimer);
      record(s, {
        type: 'devorbit_exit',
        code: code ?? null,
        stderr: code ? stderr.trim().slice(-800) : '',
      });
      chatEvents.emit('change', listChats());
    },
  });
  armOrphanTimer(s);
  chatEvents.emit('change', listChats());
  return summary(s);
}

/** How often a live view looks for new transcript lines */
const VIEW_POLL_MS = 1000;

/**
 * Live chat view of a Claude Code agent that runs in its own process (terminal or `claude --bg`):
 * tails the session transcript instead of spawning a second claude, so it works mid-turn and
 * never stops the agent. Messages go to the agent through `claude attach` (replySession).
 * @param {{ agentId: string, sessionId: string, cwd: string, name?: string }} agent
 */
export function viewAgent(agent, context = {}) {
  if (!claudeDriver.SESSION_ID_RE.test(agent.sessionId || ''))
    throw badRequest('Agent has no session id yet');
  for (const existing of sessions.values())
    if (existing.view === agent.agentId && existing.running) return summary(existing);
  const s = {
    id: crypto.randomUUID(),
    harness: 'claude',
    view: agent.agentId,
    cwd: agent.cwd,
    name: agent.name || agent.cwd.split('/').pop() || 'agent',
    sessionId: agent.sessionId,
    model: null,
    busy: false,
    running: true,
    startedAt: Date.now(),
    events: [],
    pending: new Set(),
    watchers: 0,
    orphanTimer: null,
    reply: context.reply ?? replySession,
    interrupt: context.interrupt ?? interruptSession,
  };
  sessions.set(s.id, s);
  const projectsDir = context.projectsDir;
  let file = null;
  let offset = 0;
  let rest = '';
  const tick = () => {
    file ??= findTranscript(s.sessionId, s.cwd, projectsDir);
    if (!file) return;
    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      return;
    }
    if (offset === 0 && size > HISTORY_BYTES) offset = size - HISTORY_BYTES;
    if (size < offset) offset = 0; // rewritten
    if (size === offset) return;
    const buffer = Buffer.alloc(size - offset);
    const fd = fs.openSync(file, 'r');
    try {
      fs.readSync(fd, buffer, 0, buffer.length, offset);
    } finally {
      fs.closeSync(fd);
    }
    const first = offset > 0 && s.events.length === 0;
    offset = size;
    const lines = (rest + buffer.toString('utf8')).split('\n');
    rest = lines.pop() ?? '';
    if (first) lines.shift(); // started mid-file: partial first line
    for (const event of historyEvents(lines)) record(s, event);
  };
  tick();
  s.timer = setInterval(tick, context.pollMs ?? VIEW_POLL_MS);
  // The `/` and `@` picker: the agent's skills and subagents (its own init answer is not ours)
  Promise.all([
    (context.listCommands ?? listSlashCommands)(s.cwd),
    (context.listAgents ?? listSubagents)(s.cwd),
  ])
    .then(([commands, agents]) =>
      record(
        s,
        commandsEvent(
          commands.filter((c) => c.source !== 'builtin'),
          agents
        )
      )
    )
    .catch(() => {
      // no picker entries; typing still works
    });
  s.timer.unref?.();
  armOrphanTimer(s);
  chatEvents.emit('change', listChats());
  return summary(s);
}

function armOrphanTimer(s) {
  clearTimeout(s.orphanTimer);
  if (s.running && s.watchers === 0) {
    s.orphanTimer = setTimeout(() => stopChat(s.id), ORPHAN_TIMEOUT_MS);
    s.orphanTimer.unref?.();
  }
}

function get(id) {
  const s = sessions.get(id);
  if (!s) {
    const error = new Error('Chat session not found');
    error.status = 404;
    throw error;
  }
  return s;
}

export function listChats() {
  return [...sessions.values()].filter((s) => s.running).map(summary);
}

/**
 * Send a user turn. `text` is markdown as typed; attached images are `[Image: <path>]` lines
 * (`promptWithImages`). The harness gets them as image content, like an image pasted into its
 * terminal; the chat transcript keeps the lines (they render as thumbnails).
 */
export function sendMessage(id, text) {
  const s = get(id);
  if (typeof text !== 'string' || !text.trim()) throw badRequest('Message is empty');
  if (s.view) {
    // attach only: a --resume fallback would start a second process on the same session
    // The agent's transcript brings the message back into the view
    return s.reply(s.view, text, { mode: 'attach' }).then(() => undefined);
  }
  const { text: prompt, images } = promptImages(text);
  live(s).send(prompt, images);
  s.busy = true;
  record(s, { type: 'devorbit_user', text });
}

/**
 * Answer a pending permission request.
 * @param {'allow'|'deny'|'always'} decision - `always` also applies the harness's own suggestions
 */
export function answerPermission(id, requestId, decision) {
  const s = get(id);
  if (!s.pending.has(requestId)) throw badRequest('No such permission request');
  if (!['allow', 'deny', 'always'].includes(decision)) throw badRequest('Invalid decision');
  live(s).answer(requestId, decision);
  s.pending.delete(requestId);
  record(s, { type: 'devorbit_permission', request_id: requestId, decision });
}

export function interruptChat(id) {
  const s = get(id);
  if (s.view) return s.interrupt(s.view);
  live(s).interrupt();
}

/** End the process (SIGTERM, SIGKILL after 3 s) and forget the session */
export function stopChat(id) {
  const s = sessions.get(id);
  if (!s) return false;
  sessions.delete(id);
  if (s.view) {
    clearInterval(s.timer);
    s.running = false;
  } else if (s.running) {
    s.driver.stop();
  }
  clearTimeout(s.orphanTimer);
  chatEvents.emit('change', listChats());
  return true;
}

/** stopChat, resolved once the process is gone, so a terminal can resume the same session */
export async function stopChatAndWait(id, timeoutMs = 4000) {
  const s = sessions.get(id);
  if (!stopChat(id)) return false;
  if (s.view) return true;
  await Promise.race([s.exited, new Promise((r) => setTimeout(r, timeoutMs).unref?.())]);
  return true;
}

export function stopAllChats() {
  for (const id of [...sessions.keys()]) stopChat(id);
}

/**
 * Subscribe to a session: replays the buffer, then streams live events.
 * Counts as a watcher; the orphan timer runs while nobody watches.
 * @returns {() => void} unsubscribe
 */
export function watchChat(id, onEvent) {
  const s = get(id);
  for (const event of s.events) onEvent(event);
  const listener = (event) => onEvent(event);
  chatEvents.on(`event:${id}`, listener);
  s.watchers++;
  clearTimeout(s.orphanTimer);
  return () => {
    chatEvents.off(`event:${id}`, listener);
    s.watchers--;
    armOrphanTimer(s);
  };
}

export function chatSummary(id) {
  return summary(get(id));
}

/** Last context fill / plan limits the chat's harness reported; null for Claude Code */
export function chatUsage(id) {
  return get(id).usage ?? null;
}

/**
 * Output file of a background shell this chat started. Only a path the CLI itself reported in a
 * tool result of this session qualifies, so the client never names a file.
 */
export function shellOutputFile(id, shellId) {
  const s = get(id);
  if (!/^\w{1,40}$/.test(shellId)) return null;
  const pattern = new RegExp(`Output is being written to: (\\S+/tasks/${shellId}\\.output)`);
  for (const event of s.events) {
    if (event.type !== 'user' || !Array.isArray(event.message?.content)) continue;
    for (const block of event.message.content) {
      const text =
        typeof block?.content === 'string'
          ? block.content
          : Array.isArray(block?.content)
            ? block.content.map((c) => c?.text || '').join('\n')
            : '';
      const match = text.match(pattern);
      if (match) return match[1];
    }
  }
  return null;
}
