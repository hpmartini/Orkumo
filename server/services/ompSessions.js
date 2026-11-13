/**
 * Oh My Pi (`omp`, #195) sessions for the agents view: read from omp's own session store
 * (`~/.omp/agent/sessions/<cwd-slug>/<timestamp>_<id>.jsonl`, the same files `omp -r` lists),
 * so a session shows up whether it was started here or in any terminal, and survives reloads.
 *
 * A session runs while an `omp` process holds its file open (lsof); its rail row then opens
 * the pane that runs it, otherwise `omp -r <id>` resumes it. A running session works while its
 * file ends in an open turn (see `turnSignal`), one of its subagents does, or the Orkumo pane
 * running it prints.
 */
import { execFile } from 'child_process';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';

export const OMP_SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Finished sessions older than this stay in `omp -r` only */
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
/** Tiebreak only: a running session whose tail says nothing about its turn but changed this recently */
const RECENT_WRITE_MS = 15_000;
const HEAD_BYTES = 64 * 1024;
const MAX_LISTED = 100;

export const ompSessionsDir = (home = os.homedir()) => path.join(home, '.omp', 'agent', 'sessions');

// Nerd-font icons omp puts into titles: private-use code points render as boxes elsewhere
const PRIVATE_USE_RE = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu;

const oneLine = (text, max = 120) => {
  const clean = String(text).replace(PRIVATE_USE_RE, '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

const textOf = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter((block) => block?.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('\n')
      : '';

/**
 * Header of a session file: id, cwd and start from the `session` record, the title from the
 * `title` record (omp rewrites it in place), else the first user message; `prompted` whether
 * the head holds a user message at all.
 */
export function parseSessionHead(head) {
  let title = '';
  let session = null;
  let firstPrompt = '';
  let prompted = false;
  for (const line of head.split('\n')) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record?.type === 'title' && typeof record.title === 'string') title = oneLine(record.title);
    else if (record?.type === 'session' && !session) session = record;
    else if (record?.type === 'message' && record.message?.role === 'user' && !prompted) {
      prompted = true;
      firstPrompt = oneLine(textOf(record.message.content));
    }
    if (session && prompted) break;
  }
  if (!session || !OMP_SESSION_ID_RE.test(session.id || '')) return null;
  return {
    id: session.id,
    cwd: typeof session.cwd === 'string' ? session.cwd : '',
    startedAt: Date.parse(session.timestamp) || null,
    title: title || firstPrompt || null,
    prompted,
  };
}

/** stdout of `command`; null when it failed without output */
function run(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) =>
      resolve(error && !stdout ? null : String(stdout))
    );
  });
}

/** Pids of interactive `omp` processes (not its worker processes) */
export function parseOmpPids(psOutput) {
  const pids = [];
  for (const line of psOutput.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\S+)(.*)$/);
    if (!match || path.basename(match[2]) !== 'omp' || match[3].includes('__omp_worker')) continue;
    pids.push(Number(match[1]));
  }
  return pids;
}

/**
 * Per omp pid from `lsof -F pn` output: the session file it holds open (omp opens it only when
 * it writes, so a freshly resumed session is not open yet) and its terminal device. Subagent
 * transcripts live in the session's artifact folder (`<cwd>/<stem>/<agent>.jsonl`) and are written
 * by the same process: one of them open means its parent `<cwd>/<stem>.jsonl` runs there.
 */
export function parseLsof(lsofOutput, sessionsDir) {
  const byPid = new Map();
  let entry = null;
  let parent = null;
  const settle = () => {
    if (entry && !entry.file) entry.file = parent;
  };
  for (const line of lsofOutput.split('\n')) {
    if (line.startsWith('p')) {
      settle();
      entry = { file: null, tty: null };
      parent = null;
      byPid.set(Number(line.slice(1)), entry);
    } else if (line.startsWith('n') && entry) {
      const name = line.slice(1);
      if (name.startsWith(sessionsDir + path.sep) && name.endsWith('.jsonl')) {
        const parts = path.relative(sessionsDir, name).split(path.sep);
        if (parts.length === 2) entry.file = name;
        else parent ??= path.join(sessionsDir, parts[0], `${parts[1]}.jsonl`);
      } else if (/^\/dev\/tty\w+$/.test(name)) entry.tty ??= path.basename(name);
    }
  }
  settle();
  return byPid;
}

/**
 * omp records the session each terminal last opened in `terminal-sessions/<tty>`
 * (line 1 cwd, line 2 session file): the running omp on that tty is that session.
 */
async function terminalSessionFile(sessionsDir, tty) {
  const record = path.join(path.dirname(sessionsDir), 'terminal-sessions', tty);
  const file = (await fsp.readFile(record, 'utf-8').catch(() => '')).split('\n')[1]?.trim();
  return file && file.startsWith(sessionsDir + path.sep) && file.endsWith('.jsonl') ? file : null;
}

/**
 * session file → pid of the omp process running it; null when `ps` or `lsof` failed (no answer
 * is not "nothing runs")
 */
export async function runningSessionFiles(sessionsDir, { exec = run } = {}) {
  const ps = await exec('ps', ['-axo', 'pid=,args=']);
  if (!ps) return null;
  const pids = parseOmpPids(ps);
  const holders = new Map();
  if (pids.length === 0) return holders;
  // -b/-w: never block on stale network mounts; -a: only these pids
  const out = await exec('lsof', ['-nP', '-b', '-w', '-a', '-p', pids.join(','), '-Fpn']);
  if (!out) return null;
  for (const [pid, { file, tty }] of parseLsof(out, sessionsDir)) {
    const running = file ?? (tty ? await terminalSessionFile(sessionsDir, tty) : null);
    if (running) holders.set(running, pid);
  }
  return holders;
}

/** Holders of the last successful scan per sessions dir: a failed scan keeps them */
const lastHolders = new Map();

/** `runningSessionFiles`, or the previous answer when this scan failed */
export async function currentHolders(sessionsDir, deps) {
  const holders = await runningSessionFiles(sessionsDir, deps);
  if (!holders) return lastHolders.get(sessionsDir) ?? new Map();
  lastHolders.set(sessionsDir, holders);
  return holders;
}

// Session heads change only with the file: cache per path and mtime
const heads = new Map();

async function readHead(file, mtimeMs) {
  const cached = heads.get(file);
  if (cached && cached.mtimeMs === mtimeMs) return cached.head;
  const handle = await fsp.open(file, 'r');
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    const head = parseSessionHead(buffer.subarray(0, bytesRead).toString('utf-8'));
    heads.set(file, { mtimeMs, head });
    return head;
  } finally {
    await handle.close();
  }
}

/** Inputs that start a turn although no user message is written (skill prompts, woken by a job) */
const TURN_NOTICES = new Set(['async-result', 'goal-continuation', 'irc:incoming']);
const IDLE_STOPS = new Set(['stop', 'aborted', 'error', 'length']);

/**
 * What one session record says about the turn: 'working' (a model call or tool runs next),
 * 'idle' (the turn ended), 'unknown' (an assistant message without a known stop reason), or null
 * when it says nothing (title, usage, reminders and other bookkeeping written while idle).
 * omp writes a record when it is complete, so an assistant `toolUse` stays the last record
 * while its tools run, and a user message while the model answers.
 */
export function turnSignal(record) {
  switch (record?.type) {
    case 'message': {
      const { role, stopReason } = record.message ?? {};
      if (role === 'assistant') {
        if (stopReason === 'toolUse') return 'working';
        return IDLE_STOPS.has(stopReason) ? 'idle' : 'unknown';
      }
      return role === 'user' || role === 'toolResult' || role === 'developer' ? 'working' : null;
    }
    case 'custom':
      if (record.customType === 'tool_execution_start') return 'working';
      return record.customType === 'session_exit' ? 'idle' : null;
    case 'custom_message':
      return record.attribution === 'user' || TURN_NOTICES.has(record.customType)
        ? 'working'
        : null;
    default:
      return null;
  }
}

/** Bytes scanned at most for the turn state: one tool result can be megabytes */
const TURN_SCAN_MAX = 4 * 1024 * 1024;
const TURN_SCAN_CHUNK = 64 * 1024;

/**
 * Visits the complete lines of an open file newest first, reading backwards in chunks of
 * `chunk` bytes up to `max` bytes; `visit` returning false stops.
 */
async function scanLinesBackward(handle, size, { chunk, max }, visit) {
  let end = size;
  // bytes of the line cut by the chunk read last; kept raw so a split UTF-8 character survives
  let carry = Buffer.alloc(0);
  while (end > 0 && size - end < max) {
    const start = Math.max(0, end - chunk);
    const read = Buffer.alloc(end - start);
    await handle.read(read, 0, read.length, start);
    let buffer = Buffer.concat([read, carry]);
    carry = Buffer.alloc(0);
    if (start > 0) {
      const nl = buffer.indexOf(0x0a);
      carry = nl === -1 ? buffer : buffer.subarray(0, nl);
      buffer = nl === -1 ? Buffer.alloc(0) : buffer.subarray(nl + 1);
    }
    const lines = buffer.toString('utf-8').split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (lines[i] && visit(lines[i]) === false) return;
    }
    end = start;
  }
}

// The turn state changes only with the file: cache per path, size and mtime
const turns = new Map();

/** 'working' | 'idle' | null (the tail does not tell) from the newest record that says something */
export async function readTurnState(file, size, mtimeMs) {
  const cached = turns.get(file);
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached.state;
  let state = null;
  const handle = await fsp.open(file, 'r');
  try {
    await scanLinesBackward(
      handle,
      size,
      { chunk: TURN_SCAN_CHUNK, max: TURN_SCAN_MAX },
      (line) => {
        let signal;
        try {
          signal = turnSignal(JSON.parse(line));
        } catch {
          return true;
        }
        if (!signal) return true;
        state = signal === 'unknown' ? null : signal;
        return false;
      }
    );
  } finally {
    await handle.close();
  }
  turns.set(file, { size, mtimeMs, state });
  return state;
}

/**
 * Whether a subagent of a session works: its transcript in the session's artifact folder ends in
 * an open turn and was written after the parent's last write (a subagent killed mid-turn leaves an
 * open tail behind, but the parent writes its outcome afterwards).
 */
async function subagentWorking(file, parentMtimeMs) {
  const folder = file.slice(0, -'.jsonl'.length);
  const names = await fsp.readdir(folder).catch(() => []);
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const sub = path.join(folder, name);
    const stat = await fsp.stat(sub).catch(() => null);
    if (!stat?.isFile() || stat.mtimeMs <= parentMtimeMs) continue;
    if ((await readTurnState(sub, stat.size, stat.mtimeMs).catch(() => null)) === 'working') {
      return true;
    }
  }
  return false;
}

/** Whether a running session works right now (see the module comment) */
async function isWorking(file, stat, { now, pane }) {
  if (pane?.active) return true;
  const turn = await readTurnState(file, stat.size, stat.mtimeMs).catch(() => null);
  if (turn === 'working') return true;
  if (turn === null && now - stat.mtimeMs < RECENT_WRITE_MS) return true;
  return subagentWorking(file, stat.mtimeMs);
}

/**
 * omp sessions as agent rows: every running one plus the ones written in the last 7 days that
 * hold a prompt. `panes` maps the pid of an Orkumo PTY to its pane: `{ paneId, active }`, active
 * while the PTY prints.
 */
export async function listOmpSessions({
  sessionsDir = ompSessionsDir(),
  now = Date.now(),
  panes = new Map(),
  running,
} = {}) {
  let dirs;
  try {
    dirs = (await fsp.readdir(sessionsDir, { withFileTypes: true })).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
  const holders = running ?? (await currentHolders(sessionsDir));
  const rows = [];
  for (const dir of dirs) {
    let files;
    try {
      files = (await fsp.readdir(path.join(sessionsDir, dir.name))).filter((f) =>
        f.endsWith('.jsonl')
      );
    } catch {
      continue;
    }
    for (const name of files) {
      const file = path.join(sessionsDir, dir.name, name);
      let stat;
      try {
        stat = await fsp.stat(file);
      } catch {
        continue;
      }
      const pid = holders.get(file) ?? null;
      if (!pid && now - stat.mtimeMs > RECENT_MS) continue;
      const head = await readHead(file, stat.mtimeMs).catch(() => null);
      if (!head) continue;
      // Never prompted (`omp acp` opened and closed, a TUI quit at once): nothing to resume.
      // Only when the whole file was read; a running one still shows
      if (!pid && !head.prompted && stat.size <= HEAD_BYTES) continue;
      const pane = pid ? panes.get(pid) : null;
      const working = pid ? await isWorking(file, stat, { now, pane }) : false;
      rows.push(toRow(head, { pid, updatedAt: stat.mtimeMs, paneId: pane?.paneId, working }));
    }
  }
  return rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_LISTED);
}

function toRow(head, { pid, updatedAt, paneId, working }) {
  const busy = Boolean(pid && working);
  return {
    id: `omp-${head.id}`,
    sessionId: head.id,
    kind: 'interactive',
    ptyCommand: 'omp',
    ptyArgs: ['-r', head.id],
    paneId: paneId || null,
    cwd: head.cwd,
    startedAt: head.startedAt || updatedAt,
    updatedAt,
    name: head.title || `omp ${head.id.slice(0, 8)}`,
    pid,
    status: pid ? (busy ? 'busy' : 'idle') : null,
    state: pid ? null : 'done',
    waitingFor: null,
    detail: pid ? (paneId ? 'running in Orkumo' : `running in a terminal (PID ${pid})`) : null,
    pinned: false,
    order: null,
    links: [],
    displayState: pid ? (busy ? 'working' : 'idle') : 'completed',
  };
}

/** Session file of an omp session id, searched in every cwd folder; null when unknown */
export async function findOmpSessionFile(sessionId, sessionsDir = ompSessionsDir()) {
  if (!OMP_SESSION_ID_RE.test(sessionId || '')) return null;
  let dirs;
  try {
    dirs = await fsp.readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    let files;
    try {
      files = await fsp.readdir(path.join(sessionsDir, dir.name));
    } catch {
      continue;
    }
    const match = files.find((f) => f.endsWith(`_${sessionId}.jsonl`));
    if (match) return path.join(sessionsDir, dir.name, match);
  }
  return null;
}

/**
 * Ends the omp process that runs a session so it can be resumed elsewhere (omp has no attach):
 * SIGTERM, on which omp restores its terminal and exits. Only the process holding the session's
 * file is signalled. `stopped` is null when no process runs it.
 */
export async function stopOmpSession(
  sessionId,
  { sessionsDir = ompSessionsDir(), running, timeoutMs = 5000 } = {}
) {
  const file = await findOmpSessionFile(sessionId, sessionsDir);
  if (!file) throw new Error('Oh My Pi session not found');
  const pid = (running ?? (await runningSessionFiles(sessionsDir)))?.get(file);
  if (!pid) return { stopped: null };
  process.kill(pid, 'SIGTERM');
  for (const end = Date.now() + timeoutMs; Date.now() < end; ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return { stopped: pid };
    }
  }
  throw new Error(`omp (PID ${pid}) did not exit`);
}

/**
 * Deletes an omp session the way omp's own picker does (deleteSessionWithArtifacts): the session
 * file, its artifacts folder and stale `.bak` copies. A process still running it is ended first,
 * otherwise it would write the file again.
 */
export async function removeOmpSession(
  sessionId,
  { sessionsDir = ompSessionsDir(), running } = {}
) {
  const file = await findOmpSessionFile(sessionId, sessionsDir);
  if (!file) throw new Error('Oh My Pi session not found');
  const { stopped } = await stopOmpSession(sessionId, { sessionsDir, running });
  await fsp.unlink(file);
  heads.delete(file);
  turns.delete(file);
  await fsp.rm(file.slice(0, -'.jsonl'.length), { recursive: true, force: true });
  const base = path.basename(file);
  const siblings = await fsp.readdir(path.dirname(file)).catch(() => []);
  for (const name of siblings) {
    if (name.startsWith(`${base}.`) && name.endsWith('.bak')) {
      await fsp.rm(path.join(path.dirname(file), name), { force: true });
    }
  }
  return { stopped };
}

const TAIL_CHUNK = 512 * 1024;
/** Bytes read at most for a peek: tool output dominates a long session's newest megabytes */
const TAIL_MAX = 16 * 1024 * 1024;

/**
 * Last user/assistant messages of an omp session file (peek panel). Reads backwards in chunks
 * until `limit` messages are found: one chunk of a session full of tool output held only the
 * newest prompt.
 */
export async function readOmpTranscriptTail(file, limit = 40) {
  const { size } = await fsp.stat(file);
  const handle = await fsp.open(file, 'r');
  try {
    const entries = [];
    await scanLinesBackward(handle, size, { chunk: TAIL_CHUNK, max: TAIL_MAX }, (line) => {
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        return true;
      }
      const role = record?.type === 'message' ? record.message?.role : null;
      if (role !== 'user' && role !== 'assistant') return true;
      const text = textOf(record.message.content).trim();
      if (!text) return true;
      entries.push({ role, text: text.slice(0, 4000), timestamp: record.timestamp || null });
      return entries.length < limit;
    });
    return entries.reverse();
  } finally {
    await handle.close();
  }
}
