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
import { StringDecoder } from 'string_decoder';
import { CLI_BUILTINS, CLI_INTERACTIVE_BUILTINS } from './claudeBuiltins.js';
import { listOmpCommands, ompSnapshot } from './ompCommands.js';
import { resolveHarnessBinary } from '../../config/harnesses.js';
import { READ_CHUNK_BYTES, TRANSCRIPT_READERS, commandsEvent } from './chatTranscripts.js';
import {
  artifactContent,
  createArtifactLog,
  logArtifactEvent,
  sessionArtifacts,
  claudeArtifacts,
} from './chatArtifacts.js';
import {
  assertAllowedPath,
  getAllowedDirectories,
  listSlashCommands,
  listSubagents,
} from './agentService.js';

export const VIEW_HARNESSES = Object.keys(TRANSCRIPT_READERS);

const NAME_RE = /^[^\0\n\r]+$/;
/** A view's name only labels it: a longer session name is shortened, not refused */
const NAME_MAX = 80;
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
    // One merged list, kept beside the buffer so buffer positions stay stable
    s.commands = { ...s.commands, ...event };
    chatEvents.emit(`event:${s.id}`, s.commands);
    return;
  }
  logArtifactEvent(s.artifactLog, event);
  s.events.push(event);
  if (s.events.length > MAX_EVENTS) {
    s.dropped += s.events.length - MAX_EVENTS;
    s.events.splice(0, s.events.length - MAX_EVENTS);
  }
  chatEvents.emit(`event:${s.id}`, event);
}

/** Turns a view replays on open; older ones come page by page (`chatHistoryPage`) */
export const PAGE_TURNS = 20;
/** Events that only carry state (queue, ended tasks, model): replayed even before the first page */
const isState = (e) =>
  e.type === 'devorbit_queue' ||
  e.type === 'devorbit_task_ended' ||
  (e.type === 'system' && e.subtype === 'init');

/** Buffer index where the `turns` user turns before index `end` start (0: none older) */
function pageStart(events, end, turns) {
  let seen = 0;
  for (let i = end - 1; i >= 0; i--)
    if (events[i].type === 'devorbit_user' && ++seen === turns) return i;
  return 0;
}

/**
 * The page of `PAGE_TURNS` turns before buffer position `before` (from a `devorbit_page` event):
 * `{ events, before, more }`, `before` being the cursor for the next older page
 */
export function chatHistoryPage(id, before, turns = PAGE_TURNS) {
  const s = get(id);
  const end = Math.max(0, Math.min(s.events.length, before - s.dropped));
  const start = pageStart(s.events, end, turns);
  return {
    events: s.events.slice(start, end).filter((e) => !isState(e)),
    before: s.dropped + start,
    more: start > 0,
  };
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
  const name =
    named && opts.name.length > NAME_MAX ? `${opts.name.slice(0, NAME_MAX - 1)}…` : opts.name;
  return { harness: opts.harness, sessionId: opts.sessionId, cwd, name: name || null };
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
    /** Events cut off the front of `events` (MAX_EVENTS): buffer position = dropped + index */
    dropped: 0,
    /** The `/` and `@` picker entries */
    commands: null,
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
  // a chunk may end inside a multi-byte character
  let decoder = new StringDecoder('utf8');
  let ticking = false;
  const read = () => {
    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      return;
    }
    if (size < offset) {
      offset = 0; // rewritten
      rest = '';
      decoder = new StringDecoder('utf8');
    }
    if (size === offset) return;
    // The whole file from its start (the history before a compaction included), chunk by chunk;
    // the replay buffer keeps the newest MAX_EVENTS
    const buffer = Buffer.alloc(Math.min(size - offset, READ_CHUNK_BYTES));
    const fd = fs.openSync(file, 'r');
    try {
      while (offset < size) {
        const n = fs.readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset);
        if (n <= 0) break;
        offset += n;
        const lines = (rest + decoder.write(buffer.subarray(0, n))).split('\n');
        rest = lines.pop() ?? '';
        for (const event of reader.historyEvents(lines)) record(s, event);
      }
    } finally {
      fs.closeSync(fd);
    }
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
 * Subscribe to a view: replays its last `turns` turns (a `devorbit_page` marker holds the cursor
 * for older ones), then streams live events.
 * Counts as a watcher; the orphan timer runs while nobody watches.
 * @returns {() => void} unsubscribe
 */
export function watchChat(id, onEvent, turns = PAGE_TURNS) {
  const s = get(id);
  if (s.commands) onEvent(s.commands);
  // Only the last `turns` turns; older ones on request. State events before them still count.
  const start = pageStart(s.events, s.events.length, turns);
  for (let i = 0; i < start; i++) if (isState(s.events[i])) onEvent(s.events[i]);
  onEvent({ type: 'devorbit_page', before: s.dropped + start, more: start > 0 });
  for (let i = start; i < s.events.length; i++) onEvent(s.events[i]);
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

/**
 * Chat streams: one SSE per client window carries every view it watches, each watch tagged with
 * the client's `sub` id. A stream per view starved the window's other requests: Chromium allows
 * 6 HTTP/1.1 connections per host, so with 5 UI views open every fetch queued indefinitely.
 * client id -> { send(event, data), watches: Map<sub, unsubscribe> }
 */
const streamClients = new Map();

function closeStream(clientId) {
  const client = streamClients.get(clientId);
  if (!client) return;
  streamClients.delete(clientId);
  for (const off of client.watches.values()) off();
}

/**
 * Registers the SSE of `clientId`; a reconnect with the same id replaces the old stream.
 * @param {(event: 'watch'|'message', data: object) => void} send
 * @returns {() => void} call when the stream closes
 */
export function openChatStream(clientId, send) {
  closeStream(clientId);
  const client = { send, watches: new Map() };
  streamClients.set(clientId, client);
  return () => {
    if (streamClients.get(clientId) === client) closeStream(clientId);
  };
}

/**
 * Streams view `chatId` on the client's SSE as `sub`: `watch` {sub}, the replay, then live
 * `message` {sub, event}. Watching an existing `sub` again restarts it with a fresh replay.
 * Throws 404 for an unknown view, 409 while the client has no stream.
 */
export function watchChatStream(clientId, sub, chatId) {
  const client = streamClients.get(clientId);
  if (!client) {
    const error = new Error('No chat stream open for this client');
    error.status = 409;
    throw error;
  }
  get(chatId);
  client.watches.get(sub)?.();
  client.send('watch', { sub });
  client.watches.set(
    sub,
    watchChat(chatId, (event) => client.send('message', { sub, event }))
  );
}

export function unwatchChatStream(clientId, sub) {
  const client = streamClients.get(clientId);
  client?.watches.get(sub)?.();
  client?.watches.delete(sub);
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

/** Pages the agent published on claude.ai, read or linked to (chatArtifacts.js) */
export function chatClaudeArtifacts(id) {
  return claudeArtifacts(get(id).artifactLog);
}

/** Text preview of one listed artifact: under the project dirs or the document folder, <= 1 MB */
export function chatArtifactContent(id, file) {
  const s = get(id);
  const dir = documentDir(s);
  const roots = [...(s.allowedDirs ?? getAllowedDirectories()), dir];
  return artifactContent(sessionArtifacts(s.artifactLog, s.cwd, dir), file, roots);
}
