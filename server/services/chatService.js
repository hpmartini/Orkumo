/**
 * Chat views (#189): the UI view of an agent pane. Every agent runs as a TUI process in a
 * terminal pane; its UI view is a read-only rendering of that agent's transcript, and the client
 * types user input straight into the pane's PTY. Switching views never starts or stops a process.
 *
 * This module tails the transcript (claude: `~/.claude/projects`, omp/pi: session jsonl; readers
 * in chatTranscripts.js) and keeps per view: replay buffer, watchers, orphan timer. Events are
 * Claude Code stream-json shapes as the client reducer (utils/chatEvents.ts) reads them.
 */
import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { CLI_BUILTINS, CLI_INTERACTIVE_BUILTINS } from './claudeBuiltins.js';
import { listOmpCommands, ompSnapshot } from './ompCommands.js';
import { resolveHarnessBinary } from '../../config/harnesses.js';
import { HISTORY_BYTES, TRANSCRIPT_READERS, commandsEvent } from './chatTranscripts.js';
import {
  artifactContent,
  createArtifactLog,
  logArtifactEvent,
  sessionArtifacts,
} from './chatArtifacts.js';
import {
  assertAllowedPath,
  getAllowedDirectories,
  listSlashCommands,
  listSubagents,
} from './agentService.js';

export const VIEW_HARNESSES = Object.keys(TRANSCRIPT_READERS);

const NAME_RE = /^[^\0\n\r]{1,80}$/;
/** Replay buffer per view */
const MAX_EVENTS = 5000;
/** A view nobody watches is stopped after this long (pane closed without stop, tab gone) */
const ORPHAN_TIMEOUT_MS = Number(process.env.DEVORBIT_CHAT_ORPHAN_MS) || 10 * 60 * 1000;
/** How often a view looks for new transcript lines */
const VIEW_POLL_MS = 1000;

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
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
    running: s.running,
    startedAt: s.startedAt,
  };
}

function record(s, event) {
  if (event.type === 'system' && event.subtype === 'init' && event.model) s.model = event.model;
  if (event.type === 'devorbit_commands') {
    // One merged list in the replay buffer
    const prev = s.events.findIndex((e) => e.type === 'devorbit_commands');
    if (prev >= 0) {
      event = { ...s.events[prev], ...event };
      s.events.splice(prev, 1);
    }
  }
  logArtifactEvent(s.artifactLog, event);
  s.events.push(event);
  if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
  chatEvents.emit(`event:${s.id}`, event);
}

/**
 * Validate a view request. Throws 400 (cwd outside the project dirs included).
 * @returns {{ harness: string, sessionId: string, cwd: string, name?: string }}
 */
function sanitizeView(opts, context) {
  if (!Object.hasOwn(TRANSCRIPT_READERS, opts?.harness)) throw badRequest('Unknown harness');
  const reader = TRANSCRIPT_READERS[opts.harness];
  if (typeof opts.sessionId !== 'string' || !reader.idRe.test(opts.sessionId))
    throw badRequest('Invalid session id');
  let cwd;
  try {
    cwd = assertAllowedPath(
      opts.cwd,
      context.allowedDirs ?? getAllowedDirectories(),
      'Working directory'
    );
  } catch (error) {
    error.status = 400;
    throw error;
  }
  const named = opts.name != null && opts.name !== '';
  if (named && !(typeof opts.name === 'string' && NAME_RE.test(opts.name)))
    throw badRequest('Invalid name');
  return { harness: opts.harness, sessionId: opts.sessionId, cwd, name: opts.name || null };
}

/** Claude's `/` and `@` picker: the TUI's built-ins plus the project's and user's skills */
async function claudePicker(cwd, context) {
  const [commands, agents] = await Promise.all([
    (context.listCommands ?? listSlashCommands)(cwd),
    (context.listAgents ?? listSubagents)(cwd),
  ]);
  const builtins = [
    ...CLI_BUILTINS.map((name) => ({ name, builtin: true })),
    ...CLI_INTERACTIVE_BUILTINS.map((c) => ({ ...c, builtin: true })),
  ];
  const known = new Set(builtins.map((c) => c.name));
  // listSlashCommands' own built-ins describe the dispatch input, not the TUI
  const own = commands.filter((c) => c.source !== 'builtin' && !known.has(c.name));
  return commandsEvent([...builtins, ...own], agents);
}

/**
 * omp's `/` list: the TUI snapshot right away (`onSnapshot`), then the probed list. The probe
 * (a short-lived `omp --mode rpc --no-session`) starts after the view is up.
 */
function defaultOmpLister(cwd, onSnapshot) {
  const { promise, resolve } = Promise.withResolvers();
  setTimeout(() => {
    onSnapshot(ompSnapshot());
    resolve(listOmpCommands(cwd, { bin: resolveHarnessBinary('omp') }));
  });
  return promise;
}

/**
 * Open the UI view of an agent session: tails its transcript, never touches the agent process.
 * The same harness + session already in view returns that view.
 * Context (tests): `allowedDirs`, `transcriptDir`, `pollMs`, `listCommands`, `listAgents`,
 * `listOmpCommands(cwd, onSnapshot) → Promise<commands>`.
 * @param {{ harness: 'claude'|'omp'|'pi', sessionId: string, cwd: string, name?: string }} opts
 * @returns {object} view summary
 */
export function viewSession(opts, context = {}) {
  const safe = sanitizeView(opts, context);
  for (const existing of sessions.values())
    if (
      existing.running &&
      existing.harness === safe.harness &&
      existing.sessionId === safe.sessionId
    )
      return summary(existing);
  const reader = TRANSCRIPT_READERS[safe.harness];
  const s = {
    id: crypto.randomUUID(),
    harness: safe.harness,
    cwd: safe.cwd,
    name: safe.name || safe.cwd.split('/').pop() || 'agent',
    sessionId: safe.sessionId,
    model: null,
    running: true,
    startedAt: Date.now(),
    events: [],
    watchers: 0,
    orphanTimer: null,
    /** File tool calls of the whole tail (the replay buffer is capped) */
    artifactLog: createArtifactLog(),
    /** Transcript file once found; omp keeps its `local://` documents next to it */
    transcript: null,
    /** Tests pass their project dirs; else the configured ones at request time */
    allowedDirs: context.allowedDirs ?? null,
  };
  sessions.set(s.id, s);
  let file = null;
  let offset = 0;
  let rest = '';
  let started = false;
  let ticking = false;
  const read = () => {
    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      return;
    }
    if (offset === 0 && size > HISTORY_BYTES) offset = size - HISTORY_BYTES;
    if (size < offset) {
      offset = 0; // rewritten
      rest = '';
    }
    if (size === offset) return;
    const buffer = Buffer.alloc(size - offset);
    const fd = fs.openSync(file, 'r');
    try {
      fs.readSync(fd, buffer, 0, buffer.length, offset);
    } finally {
      fs.closeSync(fd);
    }
    const midFile = !started && offset > 0;
    started = true;
    offset = size;
    const lines = (rest + buffer.toString('utf8')).split('\n');
    rest = lines.pop() ?? '';
    if (midFile) lines.shift(); // started mid-file: partial first line
    for (const event of reader.historyEvents(lines)) record(s, event);
  };
  const tick = async () => {
    if (ticking || !s.running) return;
    ticking = true;
    try {
      file ??= await reader.findTranscript(s.sessionId, s.cwd, context.transcriptDir);
      s.transcript = file;
      if (file && s.running) read();
    } catch {
      // unreadable now; the next tick retries
    } finally {
      ticking = false;
    }
  };
  tick();
  s.timer = setInterval(tick, context.pollMs ?? VIEW_POLL_MS);
  s.timer.unref?.();
  if (s.harness === 'claude')
    claudePicker(s.cwd, context)
      .then((event) => s.running && record(s, event))
      .catch(() => {
        // no picker entries; typing still works
      });
  else if (s.harness === 'omp')
    (context.listOmpCommands ?? defaultOmpLister)(s.cwd, (list) => {
      if (s.running) record(s, commandsEvent(list));
    })
      .then((list) => s.running && record(s, commandsEvent(list)))
      .catch(() => {
        // no picker entries; typing still works
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

/** Stop tailing and forget the view (the agent keeps running in its pane) */
export function stopChat(id) {
  const s = sessions.get(id);
  if (!s) return false;
  sessions.delete(id);
  s.running = false;
  clearInterval(s.timer);
  clearTimeout(s.orphanTimer);
  chatEvents.emit('change', listChats());
  return true;
}

export function stopAllChats() {
  for (const id of [...sessions.keys()]) stopChat(id);
}

/**
 * Subscribe to a view: replays the buffer, then streams live events.
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
 * Output file of a background shell this agent started. Only a path the CLI itself reported in a
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

/** omp/pi keep a session's `local://` documents in `<session file without .jsonl>/local` */
function documentDir(s) {
  if (s.harness === 'claude' || !s.transcript?.endsWith('.jsonl')) return null;
  return path.join(s.transcript.slice(0, -'.jsonl'.length), 'local');
}

/** Files the agent created or edited plus its session documents (chatArtifacts.js) */
export function chatArtifacts(id) {
  const s = get(id);
  return sessionArtifacts(s.artifactLog, s.cwd, documentDir(s));
}

/** Text preview of one listed artifact: under the project dirs or the document folder, <= 1 MB */
export function chatArtifactContent(id, file) {
  const s = get(id);
  const dir = documentDir(s);
  const roots = [...(s.allowedDirs ?? getAllowedDirectories()), dir];
  return artifactContent(sessionArtifacts(s.artifactLog, s.cwd, dir), file, roots);
}
