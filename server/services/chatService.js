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
import {
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

function handleMessage(s, msg) {
  if (msg.session_id && !s.sessionId) s.sessionId = msg.session_id;
  if (msg.type === 'system' && msg.subtype === 'init' && msg.model) s.model = msg.model;
  if (msg.type === 'control_request' && msg.request?.subtype === 'can_use_tool') {
    s.pending.set(msg.request_id, msg.request);
  }
  if (msg.type === 'result') s.busy = false;
  // Our own initialize answer (huge command list) and hook chatter stay out of the chat
  if (msg.type === 'control_response') return;
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
    env: process.env,
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
    events: [],
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
