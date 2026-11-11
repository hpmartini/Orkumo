/**
 * Claude Code chat driver (#189): the unmodified `claude` CLI in print mode with stream-json on
 * stdin/stdout. Its events are the shapes every other driver translates to (local contract:
 * chatService.js).
 *
 * Protocol (verified against CLI 2.1.317): one JSON object per line. We send
 * `control_request initialize` once, then `user` messages; the CLI streams system/assistant/
 * user(tool_result)/stream_event/result lines and asks `control_request can_use_tool` for
 * permissions, which we answer with `control_response`. `control_request interrupt` stops a turn.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { CLI_BUILTINS } from '../claudeBuiltins.js';
import { paths as agentPaths, projectSlug } from '../agentService.js';

export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Replay events kept from a transcript; the chat's replay buffer has the same cap */
export const MAX_HISTORY_EVENTS = 5000;

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
export const HISTORY_BYTES = 8 * 1024 * 1024;

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
  return events.slice(-MAX_HISTORY_EVENTS);
}

/** Transcript of a CLI session: the cwd's project folder, else any (worktree sessions) */
export function findTranscript(sessionId, cwd, projectsDir = agentPaths.PROJECTS_DIR) {
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

// The CLI answers our initialize only after the first message, so a fresh chat starts with the
// built-ins the last chat reported, or the shipped snapshot (the same for every chat)
let knownBuiltins = CLI_BUILTINS.map((name) => ({
  name,
  description: '',
  argumentHint: '',
  builtin: true,
}));

/**
 * Starts `claude -p` in stream-json mode (driver interface: see chatService.js).
 * @param {{ cwd: string, resume?: string, continue?: boolean, model?: string,
 *   permissionMode?: string, skipPermissions?: boolean, name?: string }} safe sanitized options
 */
export function startDriver(safe, io) {
  const proc = io.spawn(io.bin, buildChatArgs(safe), {
    cwd: safe.cwd,
    // -p leaves out TaskCreate/TaskUpdate; the chat's plan card needs them like the TUI has them
    env: { ...process.env, CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const initId = `init-${crypto.randomUUID()}`;
  /** request_id → can_use_tool request, for the allow answer that passes the input back */
  const pending = new Map();
  let running = true;
  let stderr = '';

  const write = (obj) => {
    if (!running || !proc.stdin.writable) {
      const error = new Error('Chat session is not running');
      error.status = 400;
      throw error;
    }
    proc.stdin.write(`${JSON.stringify(obj)}\n`);
  };
  const emitCommands = (event) => {
    const builtins = event.commands?.filter((c) => c.builtin);
    if (builtins?.length) knownBuiltins = builtins;
    io.emit(event);
  };
  const handle = (msg) => {
    if (msg.type === 'control_request' && msg.request?.subtype === 'can_use_tool')
      pending.set(msg.request_id, msg.request);
    // Our own initialize answer carries the command list; the rest of it stays out of the chat
    if (msg.type === 'control_response') {
      const r = msg.response;
      if (r?.request_id === initId && r.response)
        emitCommands(commandsEvent(r.response.commands, r.response.agents));
      return;
    }
    if (msg.type === 'system' && msg.subtype === 'commands_changed') {
      emitCommands(commandsEvent(msg.commands));
      return;
    }
    if (msg.type === 'system' && /^hook_/.test(msg.subtype || '')) return;
    io.emit(msg);
  };

  io.emit({ type: 'devorbit_commands', commands: knownBuiltins });
  if (safe.resume) for (const event of loadHistory(safe.resume, safe.cwd)) io.emit(event);

  let buffer = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const msg = parseLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      if (msg) handle(msg);
    }
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  const onEnd = (code) => {
    if (!running) return;
    running = false;
    io.exit({ code: code ?? null, stderr });
  };
  proc.on('exit', onEnd);
  proc.on('error', (error) => {
    stderr += `\n${error.message}`;
    onEnd(-1);
  });
  proc.stdin.on('error', () => {
    // EPIPE after the process died; onEnd reports it
  });

  write({ type: 'control_request', request_id: initId, request: { subtype: 'initialize' } });

  return {
    /** `images`: `{ mimeType, data }` (base64) sent as image blocks, like a pasted image */
    send(text, images = []) {
      const content = images.length
        ? [
            ...(text ? [{ type: 'text', text }] : []),
            ...images.map((i) => ({
              type: 'image',
              source: { type: 'base64', media_type: i.mimeType, data: i.data },
            })),
          ]
        : text;
      write({ type: 'user', message: { role: 'user', content } });
    },
    interrupt() {
      write({
        type: 'control_request',
        request_id: `int-${Date.now()}`,
        request: { subtype: 'interrupt' },
      });
    },
    answer(requestId, decision) {
      const request = pending.get(requestId);
      const response =
        decision === 'deny'
          ? { behavior: 'deny', message: 'Denied in the DevOrbit chat' }
          : {
              behavior: 'allow',
              updatedInput: request?.input,
              ...(decision === 'always' && Array.isArray(request?.permission_suggestions)
                ? { updatedPermissions: request.permission_suggestions }
                : {}),
            };
      write({
        type: 'control_response',
        response: { subtype: 'success', request_id: requestId, response },
      });
      pending.delete(requestId);
    },
    stop() {
      if (!running) return;
      try {
        proc.stdin.end();
        proc.kill('SIGTERM');
      } catch {
        // already gone
      }
      setTimeout(() => {
        if (running) proc.kill('SIGKILL');
      }, 3000).unref?.();
    },
  };
}
