/**
 * Chat history (#280): claude.ai and ChatGPT conversations as one local, searchable list.
 * Two ways in, one shape: the official data exports the user unpacks (`importFrom`), and the
 * provider APIs the desktop app reads through its built-in browser's login (electron/chatSync.js,
 * posted here via `ingest`). The detail responses of those APIs have the export's shape, so one
 * parser serves both. This module itself fetches nothing and sees no login: only conversations.
 *
 * Neither provider publishes a schema (Anthropic help article 9450526, OpenAI help article
 * 7260999 only describe how to request the ZIP); the shapes read here are the ones the exports
 * carry, cross-checked with the parsers in kenn-io/agentsview (internal/parser/claude_ai.go,
 * chatgpt.go). Every field is optional to the parser: a conversation it cannot read is counted
 * as skipped with a reason, never dropped silently.
 *
 * Store: one JSON line per conversation, appended on change (the last line of an id wins) and
 * compacted once stale lines outweigh live ones. In memory only metadata and a lower-cased
 * haystack per conversation; messages are read from the file by offset when one is opened.
 */
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { setImmediate } from 'timers/promises';
import { getDataPath } from './dataPath.js';

const EXPORT_FILE = /^(conversations(-\d+)?|projects)\.json$/;
// shortcut: a file is parsed in one piece, V8 caps a string near 512 MB; stream-parse when an
// export outgrows that (ChatGPT already splits large exports into conversations-NNN.json)
const MAX_FILE_BYTES = 500 * 1024 * 1024;

const ms = (value) => {
  const time = typeof value === 'number' ? value * 1000 : Date.parse(value ?? '');
  return Number.isFinite(time) ? Math.round(time) : null;
};

/** Text of a Claude message: the content blocks' text, else the flat `text`; plus attachment names */
function claudeText(message) {
  const blocks = Array.isArray(message.content) ? message.content : [];
  const text =
    blocks
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim() || (typeof message.text === 'string' ? message.text.trim() : '');
  const files = [...(message.attachments ?? []), ...(message.files ?? [])]
    .map((f) => f?.file_name)
    .filter((name) => typeof name === 'string' && name);
  return [text, ...files.map((name) => `[File: ${name}]`)].filter(Boolean).join('\n');
}

function parseClaude(raw, projectNames) {
  if (typeof raw?.uuid !== 'string' || !raw.uuid) return { reason: 'no id' };
  let list = Array.isArray(raw.chat_messages) ? raw.chat_messages : [];
  // Edited / regenerated messages are branches: keep the path to the current leaf when the
  // export names it, else every message in file order
  const leaf = raw.current_leaf_message_uuid;
  if (typeof leaf === 'string' && list.some((m) => m?.uuid === leaf)) {
    const byId = new Map(list.map((m) => [m?.uuid, m]));
    const chain = [];
    for (let m = byId.get(leaf); m && !chain.includes(m); m = byId.get(m.parent_message_uuid))
      chain.unshift(m);
    list = chain;
  }
  const messages = list
    .map((m) => ({
      role: m?.sender === 'human' ? 'user' : 'assistant',
      text: claudeText(m ?? {}),
      at: ms(m?.created_at),
    }))
    .filter((m) => m.text);
  if (messages.length === 0) return { reason: 'no messages' };
  const project = raw.project_uuid ?? raw.project?.uuid ?? null;
  return {
    conversation: {
      id: `claude:${raw.uuid}`,
      provider: 'claude',
      title: (typeof raw.name === 'string' && raw.name.trim()) || firstLine(messages),
      createdAt: ms(raw.created_at) ?? messages[0].at,
      updatedAt: ms(raw.updated_at) ?? messages[messages.length - 1].at ?? ms(raw.created_at),
      project: typeof project === 'string' ? project : null,
      projectName: raw.project?.name ?? projectNames.get(project) ?? null,
      messages,
    },
  };
}

/** Text of a ChatGPT message; parts may be strings or objects (images, audio: named, not read) */
function chatgptText(content) {
  if (!content || typeof content !== 'object') return '';
  if (Array.isArray(content.parts))
    return content.parts
      .map((part) =>
        typeof part === 'string'
          ? part
          : typeof part?.text === 'string'
            ? part.text
            : part?.content_type
              ? `[${part.content_type}]`
              : ''
      )
      .filter(Boolean)
      .join('\n')
      .trim();
  return typeof content.text === 'string' ? content.text.trim() : '';
}

function parseChatgpt(raw, projectNames) {
  const id = raw?.conversation_id || raw?.id;
  if (typeof id !== 'string' || !id) return { reason: 'no id' };
  const mapping = raw.mapping && typeof raw.mapping === 'object' ? raw.mapping : {};
  // The mapping is a tree (edits and regenerations branch): the shown thread is the path from
  // `current_node` up to the root
  const chain = [];
  const seen = new Set();
  for (let node = mapping[raw.current_node]; node && !seen.has(node); node = mapping[node.parent]) {
    seen.add(node);
    chain.unshift(node);
  }
  const messages = chain
    .map((node) => node.message)
    .filter(
      (m) =>
        m &&
        (m.author?.role === 'user' || m.author?.role === 'assistant') &&
        !m.metadata?.is_visually_hidden_from_conversation &&
        // an assistant turn addressed to a tool is a tool call, not an answer
        (m.recipient ?? 'all') === 'all' &&
        ['text', 'multimodal_text', 'code'].includes(m.content?.content_type ?? 'text')
    )
    .map((m) => ({ role: m.author.role, text: chatgptText(m.content), at: ms(m.create_time) }))
    .filter((m) => m.text);
  if (messages.length === 0) return { reason: 'no messages' };
  // Chats of a ChatGPT project carry the project as gizmo `g-p-…`; the export lacks its name,
  // the sync brings it from the sidebar
  const project =
    typeof raw.gizmo_id === 'string' && raw.gizmo_id.startsWith('g-p-') ? raw.gizmo_id : null;
  return {
    conversation: {
      id: `chatgpt:${id}`,
      provider: 'chatgpt',
      title: (typeof raw.title === 'string' && raw.title.trim()) || firstLine(messages),
      createdAt: ms(raw.create_time) ?? messages[0].at,
      updatedAt: ms(raw.update_time) ?? messages[messages.length - 1].at ?? ms(raw.create_time),
      project,
      projectName: project
        ? (projectNames.get(project) ?? `Project ${project.slice(4, 12)}`)
        : null,
      messages,
    },
  };
}

const firstLine = (messages) => messages[0].text.split('\n')[0].slice(0, 80);

/** What a parsed export file holds, told by its content (both providers name it conversations.json) */
export function detectExport(json) {
  if (!Array.isArray(json)) return null;
  const first = json.find((entry) => entry && typeof entry === 'object');
  if (!first) return json.length === 0 ? 'empty' : null;
  if ('chat_messages' in first) return 'claude';
  if ('mapping' in first) return 'chatgpt';
  if ('uuid' in first && 'name' in first && ('docs' in first || 'prompt_template' in first))
    return 'claude-projects';
  return null;
}

/**
 * Conversations of one parsed `conversations*.json`.
 * @returns {{ provider: string|null, found: number, conversations: object[], skipped: Record<string, number> }}
 */
export function parseExport(json, projectNames = new Map()) {
  const provider = detectExport(json);
  if (provider !== 'claude' && provider !== 'chatgpt')
    return { provider: null, found: 0, conversations: [], skipped: {} };
  return parseAs(provider, json, projectNames);
}

/**
 * Conversations of a known provider: an export file's entries or the API's detail responses
 * (same shapes), so a sync batch is not guessed from its first entry.
 */
export function parseAs(provider, list, projectNames = new Map()) {
  const conversations = [];
  const skipped = {};
  for (const raw of list) {
    const result =
      provider === 'claude' ? parseClaude(raw, projectNames) : parseChatgpt(raw, projectNames);
    if (result.conversation) conversations.push(result.conversation);
    else skipped[result.reason] = (skipped[result.reason] ?? 0) + 1;
  }
  return { provider, found: list.length, conversations, skipped };
}

// ---------------------------------------------------------------------------
// Topics: local and deterministic, no model and no network. A conversation's topic is the
// most widely shared distinctive word of its title (else of its first message).
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(
  `aber alle allem allen aller alles also andere anderen auch auf aus bei beim bin bis bitte
  dabei dadurch dafür damit dann dass dein deine dem den denn der des dich die dies diese diesem
  diesen dieser dieses doch dort durch eine einem einen einer eines einfach erstelle etwas euch
  für gegen gibt habe haben hallo hast hat hatte hier ich ihm ihn ihr ihre immer ist jetzt kann
  kannst kein keine können könnte machen mehr mein meine meinem meinen mich mir mit möchte muss
  nach nicht noch nun nur oder ohne schon sehr sein seine sich sie sind soll sollte über und uns
  unser unter viel vom von vor wann warum was weil welche welcher wenn wer werden wie wieder will
  wir wird wo wurde zu zum zur zwischen
  about after again all also and any are because been before being between both but can could
  did does doing don down each few for from further had has have having help her here hers him
  his how into its just like make more most need new not now off once only other our out over
  own please same she should some such than that the their them then there these they this
  those through too under until use using very want was were what when where which while who
  why will with would you your chat conversation question frage hilfe untitled`
    .split(/\s+/)
    .filter(Boolean)
);
export const NO_TOPIC = 'Other';

const words = (text) =>
  [...new Set(text.toLowerCase().match(/\p{L}[\p{L}\p{N}-]{3,}/gu) ?? [])].filter(
    (w) => !STOPWORDS.has(w)
  );

/**
 * Topic per conversation, in input order. A word names a topic when at least `minSize`
 * conversations share it; among its candidates a conversation takes the most shared one.
 * In a larger history a word that a quarter of all conversations share says nothing.
 * @param {{ title: string, firstMessage: string }[]} entries
 */
export function assignTopics(entries, minSize = 2) {
  const titleWords = entries.map((e) => words(e.title));
  const messageWords = entries.map((e) => words(e.firstMessage.slice(0, 400)));
  const shared = new Map();
  for (let i = 0; i < entries.length; i++)
    for (const w of new Set([...titleWords[i], ...messageWords[i]]))
      shared.set(w, (shared.get(w) ?? 0) + 1);
  const maxSize = entries.length < 20 ? Infinity : entries.length / 4;
  const best = (list) =>
    list
      .filter((w) => shared.get(w) >= minSize && shared.get(w) <= maxSize)
      .sort((a, b) => shared.get(b) - shared.get(a) || a.localeCompare(b))[0];
  return entries.map((_, i) => best(titleWords[i]) ?? best(messageWords[i]) ?? NO_TOPIC);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * @param {string} dir where the store lives (default `<data>/chat-history`)
 */
export function createChatHistory(dir = path.join(getDataPath(), 'chat-history')) {
  const file = path.join(dir, 'conversations.jsonl');
  // Where each provider's sync stopped (electron/chatSync.js); no login, only positions
  const stateFile = path.join(dir, 'sync-state.json');
  /** @type {null | object[]} metadata + `hay`, `offset`, `length` per conversation */
  let index = null;
  // Bytes in the file, and lines no entry points at any more (replaced conversations)
  let size = 0;
  let stale = 0;

  const entryOf = (c, offset, length) => ({
    id: c.id,
    provider: c.provider,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    project: c.project,
    projectName: c.projectName,
    messageCount: c.messages.length,
    firstMessage: (c.messages.find((m) => m.role === 'user') ?? c.messages[0]).text.slice(0, 400),
    hay: haystack(c).toLowerCase(),
    offset,
    length,
  });

  function retopic(entries) {
    const topics = assignTopics(entries);
    entries.forEach((entry, i) => (entry.topic = topics[i]));
    entries.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return entries;
  }

  let loading = null;
  /** The index, read from disk once; callers during the read share it */
  const load = () =>
    index ? Promise.resolve(index) : (loading ??= readStore().finally(() => (loading = null)));

  async function readStore() {
    const byId = new Map();
    let buffer;
    try {
      buffer = await fsp.readFile(file);
    } catch {
      size = stale = 0;
      return (index = []);
    }
    let offset = 0;
    let lines = 0;
    while (offset < buffer.length) {
      let end = buffer.indexOf(10, offset);
      if (end < 0) end = buffer.length;
      if (end > offset) {
        try {
          const c = JSON.parse(buffer.toString('utf8', offset, end));
          // appended later = newer: the last line of an id wins
          byId.set(c.id, entryOf(c, offset, end - offset));
          // a large store takes a moment to parse: let other requests through meanwhile
          if (++lines % 250 === 0) await setImmediate();
        } catch {
          // a torn line (crash while writing) costs that one conversation
        }
      }
      offset = end + 1;
    }
    size = buffer.length;
    stale = lines - byId.size;
    // a torn last line must not swallow the next append
    if (size > 0 && buffer[size - 1] !== 10) {
      await fsp.appendFile(file, '\n');
      size++;
    }
    return (index = retopic([...byId.values()]));
  }

  let writing = Promise.resolve();
  /** Writers one after the other: an import and a sync batch must not interleave their appends */
  const exclusive = (fn) => {
    const run = writing.then(fn);
    writing = run.catch(() => {});
    return run;
  };

  /** Lines appended to the store (stream: an import can be hundreds of MB) */
  async function append(conversations) {
    await fsp.mkdir(dir, { recursive: true });
    const out = fs.createWriteStream(file, { flags: 'a' });
    const entries = [];
    let offset = size;
    for (const c of conversations) {
      const line = Buffer.from(`${JSON.stringify(c)}\n`, 'utf8');
      entries.push(entryOf(c, offset, line.length - 1));
      offset += line.length;
      if (!out.write(line)) await new Promise((r) => out.once('drain', r));
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    size = offset;
    return entries;
  }

  /** Rewrites the file with the live lines only, byte for byte */
  async function compact() {
    const tmp = `${file}.tmp`;
    const out = fs.createWriteStream(tmp);
    const moved = [];
    let offset = 0;
    for (const entry of index) {
      const line = Buffer.concat([await readRaw(entry), Buffer.from('\n')]);
      moved.push([entry, offset, line.length - 1]);
      offset += line.length;
      if (!out.write(line)) await new Promise((r) => out.once('drain', r));
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    await fsp.rename(tmp, file);
    // in place and right after the rename: entries a running list() holds point at the new file
    for (const [entry, at, length] of moved) Object.assign(entry, { offset: at, length });
    size = offset;
    stale = 0;
  }

  /**
   * Stores conversations; one already stored (same id, e.g. imported from an export and now
   * synced) is replaced. A replacement without a project name keeps the name it had.
   * @returns {Promise<{ added: number, updated: number }>}
   */
  function upsert(conversations) {
    return exclusive(async () => {
      const old = await load();
      const byId = new Map(old.map((e) => [e.id, e]));
      const incoming = new Map();
      for (const c of conversations) {
        const before = byId.get(c.id);
        incoming.set(
          c.id,
          before && c.projectName == null && c.project != null && c.project === before.project
            ? { ...c, projectName: before.projectName }
            : c
        );
      }
      if (incoming.size === 0) return { added: 0, updated: 0 };
      const updated = [...incoming.keys()].filter((id) => byId.has(id)).length;
      const fresh = await append(incoming.values());
      stale += updated;
      index = retopic([...old.filter((e) => !incoming.has(e.id)), ...fresh]);
      if (stale >= index.length) await compact();
      return { added: incoming.size - updated, updated };
    });
  }

  async function readState() {
    try {
      const saved = JSON.parse(await fsp.readFile(stateFile, 'utf8'));
      return saved && typeof saved === 'object' ? saved : {};
    } catch {
      return {};
    }
  }

  /**
   * What a sync needs to fetch only what changed, per provider: where the last complete sync
   * stopped (`lastUpdatedAt`, ms), Claude's organisation, and the last activity of every stored
   * conversation by its provider id (imported ones count: they are not fetched again).
   */
  async function syncState() {
    const saved = await readState();
    const all = await load();
    const state = {};
    for (const provider of ['claude', 'chatgpt']) {
      const known = {};
      for (const e of all)
        if (e.provider === provider) known[e.id.slice(provider.length + 1)] = e.updatedAt ?? 0;
      const mark = saved[provider]?.lastUpdatedAt;
      state[provider] = {
        lastUpdatedAt: Number.isFinite(mark) ? mark : null,
        ...(provider === 'claude' && typeof saved.claude?.orgId === 'string'
          ? { orgId: saved.claude.orgId }
          : {}),
        known,
      };
    }
    return state;
  }

  /**
   * A batch of a sync: the providers' detail responses (export shape), the project names of
   * that provider and, with the last batch of a complete sync, where it stopped.
   * @param {{ provider: 'claude'|'chatgpt', conversations: object[],
   *   projects?: { id: string, name: string }[], state?: { lastUpdatedAt?: number, orgId?: string } }} batch
   */
  async function ingest({ provider, conversations, projects = [], state }) {
    const parsed = parseAs(provider, conversations, new Map(projects.map((p) => [p.id, p.name])));
    const result = await upsert(parsed.conversations);
    if (state)
      await exclusive(async () => {
        const saved = await readState();
        saved[provider] = { ...saved[provider], ...state };
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(`${stateFile}.tmp`, JSON.stringify(saved));
        await fsp.rename(`${stateFile}.tmp`, stateFile);
      });
    return {
      found: parsed.found,
      skipped: parsed.skipped,
      ...result,
      counts: counts(await load()),
    };
  }

  async function readRaw(entry) {
    const { offset, length } = entry;
    const handle = await fsp.open(file, 'r');
    try {
      const { buffer } = await handle.read(Buffer.alloc(length), 0, length, offset);
      return buffer;
    } finally {
      await handle.close();
    }
  }

  const read = async (entry) => JSON.parse((await readRaw(entry)).toString('utf8'));

  /**
   * Read an unpacked export: a folder (searched two levels deep) or one json file. A
   * conversation already stored is replaced by the imported one.
   */
  async function importFrom(given) {
    const source = path.resolve(given.trim().replace(/^~(?=\/|$)/, os.homedir()));
    const files = await exportFiles(source);
    if (files.length === 0)
      throw Object.assign(
        new Error(
          source.toLowerCase().endsWith('.zip')
            ? 'Unpack the ZIP first and give its folder'
            : 'No conversations.json found there'
        ),
        { status: 400 }
      );
    const parsed = [];
    for (const f of files) {
      const { size } = await fsp.stat(f);
      if (size > MAX_FILE_BYTES)
        throw Object.assign(new Error(`${path.basename(f)} is larger than 500 MB`), {
          status: 400,
        });
      try {
        parsed.push({ file: f, json: JSON.parse(await fsp.readFile(f, 'utf8')) });
      } catch {
        parsed.push({ file: f, json: null });
      }
    }
    const projectNames = new Map(
      parsed
        .filter((p) => detectExport(p.json) === 'claude-projects')
        .flatMap((p) => p.json.map((project) => [project?.uuid, project?.name]))
    );
    const report = [];
    const incoming = new Map();
    for (const { file: f, json } of parsed) {
      if (detectExport(json) === 'claude-projects') continue;
      const result = parseExport(json, projectNames);
      for (const c of result.conversations) incoming.set(c.id, c);
      report.push({
        file: path.basename(f),
        provider: result.provider,
        found: result.found,
        imported: result.conversations.length,
        skipped: json === null ? { 'not valid JSON': 1 } : result.skipped,
        ...(result.provider || json === null ? {} : { error: 'Unknown format' }),
      });
    }
    if (incoming.size > 0) await upsert([...incoming.values()]);
    return { files: report, counts: counts(await load()) };
  }

  const counts = (entries) => {
    const result = { claude: 0, chatgpt: 0 };
    for (const e of entries) result[e.provider]++;
    return result;
  };

  /**
   * Conversations by last activity. `q`: every word must occur (title or any message,
   * case-insensitive). `from` / `to` are ms bounds on the last activity.
   */
  async function list({ q = '', provider, project, topic, from, to, limit = 200 } = {}) {
    const started = Date.now();
    const all = await load();
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    // provider, period and search first: the project and topic choices are offered within them
    const base = all.filter(
      (e) =>
        (!provider || e.provider === provider) &&
        (from == null || (e.updatedAt ?? 0) >= from) &&
        (to == null || (e.updatedAt ?? 0) <= to) &&
        terms.every((t) => e.hay.includes(t))
    );
    const matches = base.filter(
      (e) => (!project || e.project === project) && (!topic || e.topic === topic)
    );
    const tally = (key, label) => {
      const groups = new Map();
      for (const e of base) {
        if (!e[key]) continue;
        const group = groups.get(e[key]) ?? { id: e[key], name: label(e), count: 0 };
        group.count++;
        groups.set(e[key], group);
      }
      return [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    };
    const page = matches.slice(0, limit);
    const items = [];
    for (const e of page) {
      items.push({
        ...metaOf(e),
        snippet: terms.length ? await snippet(e, terms[0]) : e.firstMessage.slice(0, 160),
      });
    }
    return {
      total: matches.length,
      counts: counts(all),
      projects: tally('project', (e) => e.projectName ?? e.project),
      topics: tally('topic', (e) => e.topic),
      items,
      tookMs: Date.now() - started,
    };
  }

  /** The words around the first hit, in the original spelling */
  async function snippet(entry, term) {
    const text = haystack(await read(entry));
    const at = text.toLowerCase().indexOf(term);
    if (at < 0) return '';
    const start = Math.max(0, at - 60);
    return (start > 0 ? '…' : '') + text.slice(start, at + term.length + 100).replace(/\s+/g, ' ');
  }

  async function get(id) {
    const entry = (await load()).find((e) => e.id === id);
    if (!entry) return null;
    return { ...metaOf(entry), messages: (await read(entry)).messages };
  }

  return { importFrom, upsert, ingest, syncState, list, get };
}

/** What a client gets of an index entry (not the haystack and file position) */
const metaOf = ({
  id,
  provider,
  title,
  createdAt,
  updatedAt,
  project,
  projectName,
  topic,
  messageCount,
}) => ({
  id,
  provider,
  title,
  createdAt,
  updatedAt,
  project,
  projectName,
  topic,
  messageCount,
});

const haystack = (c) => [c.title, ...c.messages.map((m) => m.text)].join('\n');

/** Export files in `source`: itself when it is one, else those up to two folders deep */
async function exportFiles(source) {
  let stat;
  try {
    stat = await fsp.stat(source);
  } catch {
    throw Object.assign(new Error('Path not found'), { status: 400 });
  }
  if (stat.isFile()) return EXPORT_FILE.test(path.basename(source)) ? [source] : [];
  const found = [];
  const walk = async (folder, depth) => {
    for (const entry of await fsp.readdir(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isFile() && EXPORT_FILE.test(entry.name)) found.push(full);
      else if (entry.isDirectory() && depth < 2 && !entry.name.startsWith('.'))
        await walk(full, depth + 1);
    }
  };
  await walk(source, 0);
  return found.sort();
}
