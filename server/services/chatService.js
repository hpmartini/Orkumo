/**
 * Chat sessions (#189): the unmodified `claude` CLI in print mode with stream-json on
 * stdin/stdout, driven by the Chat pane in the agents view instead of a PTY.
 *
 * Protocol (verified against CLI 2.1.317): one JSON object per line. We send
 * `control_request initialize` once, then `user` messages; the CLI streams system/assistant/
 * user(tool_result)/stream_event/result lines and asks `control_request can_use_tool` for
 * permissions, which we answer with `control_response`. `control_request interrupt` stops a turn.
 */
import { spawn as nodeSpawn } from 'child_process';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  paths as agentPaths,
  projectSlug,
  assertAllowedPath,
  getAllowedDirectories,
  isUnsafeFlagsAllowed,
  resolveClaudeBinary,
} from './agentService.js';

export const PERMISSION_MODES = ['default', 'acceptEdits', 'auto', 'manual', 'dontAsk', 'plan'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
 * @returns {{cwd: string, model?: string, permissionMode?: string, resume?: string,
 *   continue?: boolean, skipPermissions?: boolean, name?: string}}
 */
export function sanitizeChatOptions(opts = {}, context = {}) {
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
  const out = { cwd };
  if (opts.model != null && opts.model !== '') {
    if (typeof opts.model !== 'string' || !MODEL_RE.test(opts.model))
      throw badRequest('Invalid model');
    out.model = opts.model;
  }
  if (opts.permissionMode != null && opts.permissionMode !== '') {
    if (!PERMISSION_MODES.includes(opts.permissionMode))
      throw badRequest('Invalid permission mode');
    out.permissionMode = opts.permissionMode;
  }
  if (opts.resume != null && opts.resume !== '') {
    if (typeof opts.resume !== 'string' || !UUID_RE.test(opts.resume))
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
  if (opts.name != null && opts.name !== '') {
    if (typeof opts.name !== 'string' || !NAME_RE.test(opts.name)) throw badRequest('Invalid name');
    out.name = opts.name;
  }
  return out;
}

/** CLI arguments for a sanitized start request (argument array, never a shell string) */
export function buildChatArgs(safe) {
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-prompt-tool',
    'stdio',
  ];
  if (safe.model) args.push('--model', safe.model);
  // CLI 2.1.x has no `default` mode any more; its equivalent (ask for every tool) is `manual`
  if (safe.permissionMode)
    args.push(
      '--permission-mode',
      safe.permissionMode === 'default' ? 'manual' : safe.permissionMode
    );
  if (safe.skipPermissions) args.push('--dangerously-skip-permissions');
  if (safe.resume) args.push('--resume', safe.resume);
  if (safe.continue) args.push('--continue');
  if (safe.name) args.push('--name', safe.name);
  return args;
}

/** One stdout line → message object, or null for blank/garbage lines (never throws) */
export function parseLine(line) {
  const trimmed = typeof line === 'string' ? line.trim() : '';
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed);
    return value && typeof value === 'object' && typeof value.type === 'string' ? value : null;
  } catch {
    return null;
  }
}

/** Transcript bytes read for the history of a resumed chat (newest part of the file) */
const HISTORY_BYTES = 8 * 1024 * 1024;

/**
 * Transcript JSONL lines → replay events, so a resumed chat shows what came before.
 * `claude -p --resume` itself never replays the old turns.
 */
export function historyEvents(lines) {
  const events = [];
  for (const line of lines) {
    const rec = parseLine(line);
    if (!rec || rec.isSidechain || rec.isMeta || rec.isCompactSummary) continue;
    if (rec.type === 'system' && rec.subtype === 'away_summary' && rec.content) {
      events.push({ type: 'system', subtype: 'away_summary', content: rec.content });
      continue;
    }
    if (!rec.message) continue;
    const content = rec.message.content;
    if (rec.type === 'assistant' && Array.isArray(content)) {
      events.push({
        type: 'assistant',
        message: rec.message,
        parent_tool_use_id: null,
        history: true,
      });
    } else if (rec.type === 'user') {
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .filter((b) => b?.type === 'text')
                .map((b) => b.text)
                .join('\n')
            : '';
      // `<command-name>`, `<local-command-stdout>` and similar CLI wrappers are not user turns
      if (text.trim() && !text.trimStart().startsWith('<')) {
        events.push({ type: 'devorbit_user', text, history: true });
      }
      if (Array.isArray(content) && content.some((b) => b?.type === 'tool_result')) {
        events.push({ type: 'user', message: rec.message, parent_tool_use_id: null });
      }
    }
  }
  return events.slice(-MAX_EVENTS);
}

/** Transcript of a CLI session: the cwd's project folder, else any (worktree sessions) */
function findTranscript(sessionId, cwd, projectsDir = agentPaths.PROJECTS_DIR) {
  const name = `${sessionId}.jsonl`;
  const direct = path.join(projectsDir, projectSlug(cwd), name);
  if (fs.existsSync(direct)) return direct;
  try {
    for (const dir of fs.readdirSync(projectsDir)) {
      const candidate = path.join(projectsDir, dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    // no projects dir
  }
  return null;
}

/** Replay events for a resumed session; empty when there is no readable transcript */
export function loadHistory(sessionId, cwd, projectsDir) {
  const file = findTranscript(sessionId, cwd, projectsDir);
  if (!file) return [];
  try {
    const size = fs.statSync(file).size;
    const length = Math.min(size, HISTORY_BYTES);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(file, 'r');
    try {
      fs.readSync(fd, buffer, 0, length, size - length);
    } finally {
      fs.closeSync(fd);
    }
    const lines = buffer.toString('utf8').split('\n');
    if (length < size) lines.shift(); // partial first line
    return historyEvents(lines);
  } catch {
    return [];
  }
}

const sessions = new Map();
export const chatEvents = new EventEmitter();
chatEvents.setMaxListeners(0);

function summary(s) {
  return {
    id: s.id,
    cwd: s.cwd,
    name: s.name,
    sessionId: s.sessionId,
    model: s.model,
    busy: s.busy,
    running: s.running,
    startedAt: s.startedAt,
    pendingPermissions: s.pending.size,
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

function write(s, obj) {
  if (!s.running || !s.proc.stdin.writable) throw badRequest('Chat session is not running');
  s.proc.stdin.write(`${JSON.stringify(obj)}\n`);
}

const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

/** The CLI's command / agent lists, trimmed: the raw init answer is ~100 KB per chat */
export function commandsEvent(commands, agents) {
  const event = { type: 'devorbit_commands' };
  if (Array.isArray(commands))
    event.commands = commands
      .filter((c) => c && typeof c.name === 'string' && !c.name.startsWith('__'))
      .map((c) => ({
        name: c.name,
        description: clip(c.description, 600),
        argumentHint: clip(c.argumentHint, 200),
        builtin: c.builtin === true,
      }));
  if (Array.isArray(agents))
    event.agents = agents
      .filter((a) => a && typeof a.name === 'string')
      .map((a) => ({ name: a.name, description: clip(a.description, 600) }));
  return event;
}

function handleMessage(s, msg) {
  if (msg.session_id && !s.sessionId) s.sessionId = msg.session_id;
  if (msg.type === 'system' && msg.subtype === 'init' && msg.model) s.model = msg.model;
  if (msg.type === 'control_request' && msg.request?.subtype === 'can_use_tool') {
    s.pending.set(msg.request_id, msg.request);
  }
  if (msg.type === 'result') s.busy = false;
  // Our own initialize answer carries the command list; the rest of it stays out of the chat
  if (msg.type === 'control_response') {
    const r = msg.response;
    if (r?.request_id === `init-${s.id}` && r.response)
      record(s, commandsEvent(r.response.commands, r.response.agents));
    return;
  }
  if (msg.type === 'system' && msg.subtype === 'commands_changed') {
    record(s, commandsEvent(msg.commands));
    return;
  }
  if (msg.type === 'system' && /^hook_/.test(msg.subtype || '')) return;
  record(s, msg);
}

/**
 * Start a chat session. `spawn` is injectable for tests.
 * @returns {object} session summary
 */
export function startChat(opts, context = {}) {
  const safe = sanitizeChatOptions(opts, context);
  const bin = context.bin ?? resolveClaudeBinary();
  if (!bin || bin.includes('via PTY-Host')) {
    const error = new Error('Chat needs a local claude CLI');
    error.status = 501;
    throw error;
  }
  const spawn = context.spawn ?? nodeSpawn;
  const proc = spawn(bin, buildChatArgs(safe), {
    cwd: safe.cwd,
    // -p leaves out TaskCreate/TaskUpdate; the chat's plan card needs them like the TUI has them
    env: { ...process.env, CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const s = {
    id: crypto.randomUUID(),
    cwd: safe.cwd,
    name: safe.name || safe.cwd.split('/').pop() || 'chat',
    sessionId: safe.resume || null,
    model: safe.model || null,
    busy: false,
    running: true,
    startedAt: Date.now(),
    proc,
    events: safe.resume ? (context.loadHistory ?? loadHistory)(safe.resume, safe.cwd) : [],
    pending: new Map(),
    watchers: 0,
    orphanTimer: null,
    stderr: '',
  };
  s.exited = new Promise((resolve) => {
    s.markExited = resolve;
  });
  sessions.set(s.id, s);

  let buffer = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const msg = parseLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      if (msg) handleMessage(s, msg);
    }
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk) => {
    s.stderr = (s.stderr + chunk).slice(-4000);
  });
  const onEnd = (code) => {
    if (!s.running) return;
    s.running = false;
    s.busy = false;
    s.markExited();
    clearTimeout(s.orphanTimer);
    record(s, {
      type: 'devorbit_exit',
      code: code ?? null,
      stderr: code ? s.stderr.trim().slice(-800) : '',
    });
    chatEvents.emit('change', listChats());
  };
  proc.on('exit', onEnd);
  proc.on('error', (error) => {
    s.stderr += `\n${error.message}`;
    onEnd(-1);
  });
  proc.stdin.on('error', () => {
    // EPIPE after the process died; onEnd reports it
  });

  write(s, {
    type: 'control_request',
    request_id: `init-${s.id}`,
    request: { subtype: 'initialize' },
  });
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

/** Send a user turn. `text` is markdown as typed; image paths are already inlined by the client */
export function sendMessage(id, text) {
  const s = get(id);
  if (typeof text !== 'string' || !text.trim()) throw badRequest('Message is empty');
  write(s, { type: 'user', message: { role: 'user', content: text } });
  s.busy = true;
  record(s, { type: 'devorbit_user', text });
}

/**
 * Answer a pending permission request.
 * @param {'allow'|'deny'|'always'} decision - `always` also applies the CLI's own suggestions
 */
export function answerPermission(id, requestId, decision) {
  const s = get(id);
  const request = s.pending.get(requestId);
  if (!request) throw badRequest('No such permission request');
  if (!['allow', 'deny', 'always'].includes(decision)) throw badRequest('Invalid decision');
  const response =
    decision === 'deny'
      ? { behavior: 'deny', message: 'Denied in the DevOrbit chat' }
      : {
          behavior: 'allow',
          updatedInput: request.input,
          ...(decision === 'always' && Array.isArray(request.permission_suggestions)
            ? { updatedPermissions: request.permission_suggestions }
            : {}),
        };
  write(s, {
    type: 'control_response',
    response: { subtype: 'success', request_id: requestId, response },
  });
  s.pending.delete(requestId);
  record(s, { type: 'devorbit_permission', request_id: requestId, decision });
}

export function interruptChat(id) {
  const s = get(id);
  write(s, {
    type: 'control_request',
    request_id: `int-${Date.now()}`,
    request: { subtype: 'interrupt' },
  });
}

/** End the process (SIGTERM, SIGKILL after 3 s) and forget the session */
export function stopChat(id) {
  const s = sessions.get(id);
  if (!s) return false;
  sessions.delete(id);
  if (s.running) {
    try {
      s.proc.stdin.end();
      s.proc.kill('SIGTERM');
    } catch {
      // already gone
    }
    setTimeout(() => {
      if (s.running) s.proc.kill('SIGKILL');
    }, 3000).unref?.();
  }
  clearTimeout(s.orphanTimer);
  chatEvents.emit('change', listChats());
  return true;
}

/** stopChat, resolved once the process is gone, so a terminal can resume the same session */
export async function stopChatAndWait(id, timeoutMs = 4000) {
  const s = sessions.get(id);
  if (!stopChat(id)) return false;
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
