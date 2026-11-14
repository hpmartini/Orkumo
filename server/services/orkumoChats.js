/**
 * Orkumo chats (#19): chats started without a project run as agent sessions in a folder of their
 * own, `<data>/chats` (not ~: Claude Code refuses `--bg` there). That folder is what marks a
 * session as a chat. The scanner reads the transcripts of every session that ran there, of each
 * harness, and hands them to the chat history (chatHistoryService.js) as conversations of the
 * source `orkumo`, so /chats lists and searches them next to the claude.ai / ChatGPT history.
 *
 * | harness | transcripts                                                       |
 * | :------ | :---------------------------------------------------------------- |
 * | claude  | `~/.claude/projects/<slug of the chats folder>/<uuid>.jsonl`      |
 * | omp, pi | `~/.omp|.pi/agent/sessions/<cwd folder>/<ts>_<uuid>.jsonl`         |
 * | codex   | `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-…-<uuid>.jsonl` (cwd in its first line) |
 *
 * Only text is kept (user prompts and answers; tool calls and results are left out), read-only.
 */
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { getDataPath } from './dataPath.js';

export const chatsDir = (dataDir = getDataPath()) => path.join(dataDir, 'chats');

/** The chats folder, created on first use; its real path (agents report real paths) */
export function ensureChatsDir(dir = chatsDir()) {
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync(dir);
}

/** A transcript read whole up to this size, else only its end */
const MAX_READ_BYTES = 16 * 1024 * 1024;
/** Bytes of a codex rollout's head searched for its cwd */
const CODEX_HEAD_BYTES = 16 * 1024;

const str = (v) => (typeof v === 'string' ? v : '');
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const time = (v) => {
  const t = typeof v === 'number' ? v : Date.parse(str(v));
  return Number.isFinite(t) ? t : null;
};
const oneLine = (text) => text.replace(/\s+/g, ' ').trim();

function parse(line) {
  if (!line.trim()) return null;
  try {
    const value = JSON.parse(line);
    return isObj(value) ? value : null;
  } catch {
    return null;
  }
}

/** Text blocks of a message content (string or `[{ type: 'text'|…, text }]`) */
function textOf(content, types = ['text']) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => isObj(b) && types.includes(b.type) && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/** Messages in order; an answer split over several records becomes one message */
function collector() {
  const messages = [];
  return {
    messages,
    add(role, text, at) {
      const clean = text.trim();
      if (!clean) return;
      const last = messages[messages.length - 1];
      if (role === 'assistant' && last?.role === 'assistant') last.text += `\n\n${clean}`;
      else messages.push({ role, text: clean, at });
    },
  };
}

/**
 * Claude Code transcript lines → `{ title, createdAt, messages }`. Skipped: meta, sidechain and
 * compaction records, CLI wrappers (`<command-name>`, `<local-command-stdout>`), tool results.
 */
export function claudeChat(lines) {
  const { messages, add } = collector();
  let title = '';
  let createdAt = null;
  for (const line of lines) {
    const rec = parse(line);
    if (!rec) continue;
    if (rec.type === 'custom-title' && str(rec.customTitle)) title = oneLine(rec.customTitle);
    if (rec.isMeta || rec.isSidechain || rec.isCompactSummary || !isObj(rec.message)) continue;
    const at = time(rec.timestamp);
    createdAt ??= at;
    if (rec.type === 'user') {
      const text = textOf(rec.message.content);
      if (!text.trimStart().startsWith('<')) add('user', text, at);
    } else if (rec.type === 'assistant') add('assistant', textOf(rec.message.content), at);
  }
  return { title, createdAt, messages };
}

/** omp / pi session lines (pi session format v3) → `{ id, cwd, title, createdAt, messages }` */
export function sessionChat(lines) {
  const { messages, add } = collector();
  let id = '';
  let cwd = '';
  let title = '';
  let createdAt = null;
  for (const line of lines) {
    const rec = parse(line);
    if (!rec) continue;
    if (rec.type === 'session' && !id) {
      id = str(rec.id);
      cwd = str(rec.cwd);
      createdAt = time(rec.timestamp);
    } else if (rec.type === 'title' && str(rec.title)) title = oneLine(rec.title);
    else if (rec.type === 'message' && isObj(rec.message)) {
      const { role, content } = rec.message;
      const text = textOf(content);
      if (role === 'user' && !text.trimStart().startsWith('<system-reminder'))
        add('user', text, time(rec.timestamp));
      else if (role === 'assistant') add('assistant', text, time(rec.timestamp));
    }
  }
  return { id, cwd, title, createdAt, messages };
}

// Codex puts its context (AGENTS.md, environment, instructions) into user messages of its own
const CODEX_CONTEXT = /^\s*(<[a-z_]+>|# AGENTS\.md instructions)/;

/** Codex rollout lines → `{ id, cwd, createdAt, messages }` */
export function codexChat(lines) {
  const { messages, add } = collector();
  let id = '';
  let cwd = '';
  let createdAt = null;
  for (const line of lines) {
    const rec = parse(line);
    if (!rec || !isObj(rec.payload)) continue;
    const p = rec.payload;
    if (rec.type === 'session_meta' && !id) {
      id = str(p.id);
      cwd = str(p.cwd);
      createdAt = time(p.timestamp) ?? time(rec.timestamp);
    } else if (rec.type === 'response_item' && p.type === 'message') {
      if (p.role === 'user') {
        const text = textOf(p.content, ['input_text']);
        if (!CODEX_CONTEXT.test(text)) add('user', text, time(rec.timestamp));
      } else if (p.role === 'assistant')
        add('assistant', textOf(p.content, ['output_text']), time(rec.timestamp));
    }
  }
  return { id, cwd, createdAt, messages };
}

async function readLines(file, size) {
  if (size <= MAX_READ_BYTES) return (await fsp.readFile(file, 'utf8')).split('\n');
  const handle = await fsp.open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(
      Buffer.alloc(MAX_READ_BYTES),
      0,
      MAX_READ_BYTES,
      size - MAX_READ_BYTES
    );
    // the first line is cut: drop it
    return buffer.toString('utf8', 0, bytesRead).split('\n').slice(1);
  } finally {
    await handle.close();
  }
}

async function readHead(file, bytes) {
  const handle = await fsp.open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(bytes), 0, bytes, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function jsonlFiles(dir) {
  try {
    return (await fsp.readdir(dir)).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

const firstLine = (messages) =>
  oneLine((messages.find((m) => m.role === 'user') ?? messages[0]).text).slice(0, 80);

/**
 * Scanner of the chats folder's sessions. `scan()` answers the conversations whose transcript
 * changed since its last call (all on the first); the caller stores them.
 * @param {{ dir: string, claudeDir: string, ompDir?: string, piDir?: string, codexDir?: string }} opts
 *   dir: the chats folder (real path); claudeDir: Claude Code's project folder of it
 */
export function createOrkumoChatScanner({
  dir,
  claudeDir,
  ompDir = path.join(os.homedir(), '.omp', 'agent', 'sessions'),
  piDir = path.join(os.homedir(), '.pi', 'agent', 'sessions'),
  codexDir = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions'),
}) {
  const inChats = (cwd) => cwd === dir || cwd.startsWith(dir + path.sep);
  /** file → `size:mtime` when last read */
  const seen = new Map();
  /** omp/pi cwd folder → whether it is the chats folder (one head read per folder) */
  const sessionDirs = new Map();
  /** codex rollout → whether it ran in the chats folder (one head read per file) */
  const codexFiles = new Map();

  /** Files of a harness that ran in the chats folder */
  async function sessionFiles(base) {
    let dirs;
    try {
      dirs = (await fsp.readdir(base, { withFileTypes: true })).filter((d) => d.isDirectory());
    } catch {
      return [];
    }
    const files = [];
    for (const d of dirs) {
      const folder = path.join(base, d.name);
      const listed = await jsonlFiles(folder);
      if (!sessionDirs.has(folder) && listed.length) {
        const head = await readHead(listed[0], 4096).catch(() => '');
        const session = head.split('\n').map(parse).find((r) => r?.type === 'session');
        // a folder whose first file shows no session record yet is asked again next time
        if (session) sessionDirs.set(folder, inChats(str(session.cwd)));
      }
      if (sessionDirs.get(folder)) files.push(...listed);
    }
    return files;
  }

  /** Codex rollouts that ran in the chats folder; date folders older than the chats folder skipped */
  async function codexChatFiles() {
    let born = 0;
    try {
      const stat = await fsp.stat(dir);
      born = stat.birthtimeMs || stat.ctimeMs;
    } catch {
      return [];
    }
    // the day before the folder's birth, as `YYYY/MM/DD` (rollouts are filed by local start date)
    const first = new Date(born - 86_400_000);
    const pad = (n) => String(n).padStart(2, '0');
    const firstDay = `${first.getFullYear()}/${pad(first.getMonth() + 1)}/${pad(first.getDate())}`;
    const files = [];
    const walk = async (folder, depth, prefix) => {
      let names;
      try {
        names = await fsp.readdir(folder);
      } catch {
        return;
      }
      for (const name of names) {
        const rel = prefix ? `${prefix}/${name}` : name;
        if (depth < 3) {
          if (/^\d+$/.test(name) && rel >= firstDay.slice(0, rel.length))
            await walk(path.join(folder, name), depth + 1, rel);
        } else if (name.endsWith('.jsonl')) files.push(path.join(folder, name));
      }
    };
    await walk(codexDir, 0, '');
    const chats = [];
    for (const file of files) {
      if (!codexFiles.has(file)) {
        const head = await readHead(file, CODEX_HEAD_BYTES).catch(() => '');
        const cwd = head.match(/"cwd":"((?:[^"\\]|\\.)*)"/)?.[1];
        if (cwd === undefined) continue;
        codexFiles.set(file, inChats(JSON.parse(`"${cwd}"`)));
      }
      if (codexFiles.get(file)) chats.push(file);
    }
    return chats;
  }

  /** Conversation of one transcript, or null (nothing said yet, not of the chats folder) */
  async function read(harness, file, stat) {
    const lines = await readLines(file, stat.size);
    let chat;
    let sessionId;
    if (harness === 'claude') {
      chat = claudeChat(lines);
      sessionId = path.basename(file, '.jsonl');
    } else if (harness === 'codex') {
      chat = codexChat(lines);
      sessionId = chat.id;
      if (!inChats(chat.cwd)) return null;
    } else {
      chat = sessionChat(lines);
      sessionId = chat.id;
      if (!inChats(chat.cwd)) return null;
    }
    if (!sessionId || chat.messages.length === 0) return null;
    return {
      id: `orkumo:${harness}:${sessionId}`,
      provider: 'orkumo',
      harness,
      sessionId,
      cwd: harness === 'claude' ? dir : chat.cwd,
      title: chat.title || firstLine(chat.messages),
      createdAt: chat.createdAt ?? stat.birthtimeMs ?? null,
      updatedAt: Math.round(stat.mtimeMs),
      project: null,
      projectName: null,
      messages: chat.messages,
    };
  }

  async function scan() {
    const candidates = [
      ...(await jsonlFiles(claudeDir)).map((file) => ['claude', file]),
      ...(await sessionFiles(ompDir)).map((file) => ['omp', file]),
      ...(await sessionFiles(piDir)).map((file) => ['pi', file]),
      ...(await codexChatFiles()).map((file) => ['codex', file]),
    ];
    const changed = [];
    for (const [harness, file] of candidates) {
      let stat;
      try {
        stat = await fsp.stat(file);
      } catch {
        continue;
      }
      const mark = `${stat.size}:${stat.mtimeMs}`;
      if (seen.get(file) === mark) continue;
      const conversation = await read(harness, file, stat).catch(() => null);
      seen.set(file, mark);
      if (conversation) changed.push(conversation);
    }
    return changed;
  }

  return { scan };
}
