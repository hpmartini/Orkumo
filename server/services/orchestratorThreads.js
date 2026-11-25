/**
 * Threads of an orchestrator chat (agents-ui `utils/chatThreads.ts` routes the messages): one file
 * per orchestrator under `<data>/orchestrator-reports/threads/<id>.json`, next to its reports.
 * A thread keeps its tag, binding and linked workers from the moment it was made, so a retitled
 * or dropped task never orphans the messages already sent under it.
 */
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { unwrapPasted } from './chatTranscripts.js';
import { httpError, writeAtomic } from './orchestratorReports.js';

const NAME_MAX = 60;

/** One line without the characters that would break the tag (`[`, `]`, quotes), capped */
export function cleanName(text, max = NAME_MAX) {
  const line = String(text ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f[\]"“”„`]/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    // Markdown of an answer's first line: list marker or heading hashes
    .replace(/^\s*(?:[-*]\s+|#+\s*)+/, '')
    .trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

const tagOf = (name) => `[Thread: ${name.project} · ${name.task}]`;

/** The message typed into the orchestrator for a thread: its tag line first */
export const threadText = (thread, text) => `${thread.tag}\n${text}`;

/**
 * Name, binding and linked agents of the thread for a status task or inbox entry (an entry binds
 * to its task); null when the report has neither
 * @param {{ entry?: string, task?: { project: string, task: string } }} target
 */
export function taskThread(report, target) {
  let project;
  let task;
  if (target.entry) {
    const entry = report.inbox.find((e) => e.id === target.entry);
    if (!entry) return null;
    project =
      report.projects.find((p) => p.id === entry.projectId) ??
      report.projects.find((p) => p.tasks.some((t) => t.id === entry.taskId));
    task = project?.tasks.find((t) => t.id === entry.taskId);
    // an entry without a task is a thread of its own
    if (!task)
      return {
        name: { project: cleanName(project?.name ?? 'Inbox'), task: cleanName(entry.title) },
        binding: { project: project?.id ?? null, task: null, entry: entry.id },
        agents: entry.refs?.agents ?? [],
      };
  } else {
    project = report.projects.find((p) => p.id === target.task.project);
    task = project?.tasks.find((t) => t.id === target.task.task);
  }
  if (!task) return null;
  return {
    name: { project: cleanName(project.name), task: cleanName(task.title) },
    binding: { project: project.id, task: task.id },
    agents: task.refs?.agents ?? [],
  };
}

const sameBinding = (a, b) =>
  !!a &&
  !!b &&
  a.project === b.project &&
  a.task === b.task &&
  (a.entry ?? null) === (b.entry ?? null);

/** `#42` for an issue or PR URL, else the ref itself */
const shortRef = (url) => url.match(/\/(?:issues|pull)\/(\d+)/)?.[1] ?? null;

/**
 * What the list shows of a thread, read from the current report: repo and summary of its task
 * (title, note, description of its inbox entry, refs; no model call). Unbound: no summary
 */
export function threadView(thread, report) {
  const b = thread.binding;
  const project = b && report?.projects.find((p) => p.id === b.project);
  const task = b?.task && project?.tasks.find((t) => t.id === b.task);
  const entry = report?.inbox.find(
    (e) => (b?.entry && e.id === b.entry) || (task && e.taskId === task.id)
  );
  if (!task && !entry) return { ...thread, repo: project?.repo ?? null, summary: null };
  const description = entry?.description
    ?.split('\n')
    .find((l) => l.trim() && !l.startsWith('#'))
    ?.trim();
  const refs = [...(task?.refs?.issues ?? []), ...(task?.refs?.prs ?? [])]
    .map(shortRef)
    .filter(Boolean)
    .map((n) => `#${n}`);
  const summary = [task?.note || task?.title || entry?.title, description, refs.join(' ')]
    .filter(Boolean)
    .join(' · ');
  return { ...thread, repo: project?.repo ?? null, summary };
}

/** Sessions working in the project's repo (by their git remote), never the orchestrator itself */
export function repoAgents(report, projectId, sessions, contexts, orchestratorSessionId) {
  const repo = report?.projects.find((p) => p.id === projectId)?.repo?.toLowerCase();
  if (!repo) return [];
  return sessions
    .filter(
      (s) => s.id !== orchestratorSessionId && contexts[s.id]?.repo?.slug?.toLowerCase() === repo
    )
    .map((s) => s.id);
}

/** Command marks kept per thread: older ones have claimed their turn long ago */
const MAX_COMMANDS = 100;

/**
 * Key of an orchestrator's threads: its session id; a Claude terminal's row id is its pid (new on
 * every restart), so its transcript uuid
 */
export const threadOwnerKey = (session) =>
  (session.id.startsWith('interactive-') && session.sessionId) || session.id;

/** Tidy-up actions an orchestrator can take back (`orkumo thread undo`, "Undo tidy-up") */
const UNDO_MAX = 20;
const MIN_REF = 4;
const clone = (v) => JSON.parse(JSON.stringify(v));

/** The thread `ref` names: its id or a unique id prefix (as `orkumo thread list` prints them) */
export function findThread(threads, ref) {
  const exact = threads.find((t) => t.id === ref);
  if (exact) return exact;
  const hits = ref.length >= MIN_REF ? threads.filter((t) => t.id.startsWith(ref)) : [];
  if (hits.length === 1) return hits[0];
  throw httpError(
    404,
    hits.length ? `"${ref}" matches ${hits.length} threads` : `No thread "${ref}"`
  );
}

/** Final thread of `id` along the merge chain; a cycle stops where it closes (as agents-ui) */
export function mergeTarget(id, merged) {
  const seen = new Set();
  let to = id;
  while (merged[to] && !seen.has(to)) {
    seen.add(to);
    to = merged[to];
  }
  return to;
}

/** "Project · Topic" → name; one part alone names both (the UI shows a doubled part once) */
export function parseTitle(title) {
  const at = title.indexOf(' · ');
  const project = cleanName(at === -1 ? title : title.slice(0, at));
  const task = cleanName(at === -1 ? title : title.slice(at + 3)) || project;
  if (!project) throw httpError(400, 'A thread name needs a project');
  return { project, task };
}

/**
 * Thread file of an orchestrator: its threads, the tidy-up layer over the transcript
 * (`overrides.entries`: entry key → thread id or 'main'; `overrides.merged`: source → target) and
 * the undo stack of earlier states of both. The transcript itself is never written
 */
export function createThreadStore(dir) {
  const threadsDir = path.join(dir, 'threads');
  const fileOf = (id) => path.join(threadsDir, `${id}.json`);
  const load = (id) => {
    let doc = {};
    try {
      doc = JSON.parse(fs.readFileSync(fileOf(id), 'utf8')) ?? {};
    } catch {
      doc = {};
    }
    return {
      threads: doc.threads ?? [],
      overrides: { entries: { ...doc.overrides?.entries }, merged: { ...doc.overrides?.merged } },
      undo: doc.undo ?? [],
    };
  };
  const store = (id, doc) => {
    fs.mkdirSync(threadsDir, { recursive: true });
    writeAtomic(fileOf(id), doc);
  };
  /** Reads, changes and writes without a pause, so two requests never interleave */
  const change = (id, fn) => {
    const doc = load(id);
    const before = JSON.stringify(doc);
    const result = fn(doc);
    // polls change nothing most of the time: the file is only written when it changes
    if (JSON.stringify(doc) !== before) store(id, doc);
    return result;
  };

  const newThread = (threads, { name, binding, parentKey, agents, now, readAt, autoName }) => {
    const clean = { project: cleanName(name.project), task: cleanName(name.task) || 'Thread' };
    const taken = new Set(threads.flatMap((t) => [t.tag, tagOf(t.name)]));
    let unique = clean;
    for (let i = 2; taken.has(tagOf(unique)); i++)
      unique = { ...clean, task: `${clean.task} ${i}` };
    return {
      id: crypto.randomUUID(),
      tag: tagOf(unique),
      name: unique,
      binding,
      parentKey,
      agents: [...new Set(agents)],
      createdAt: now,
      readAt,
      closed: false,
      commands: [],
      ...(autoName ? { autoName: true } : {}),
    };
  };

  return {
    list: (id) => load(id).threads,
    /** Threads, overrides and whether a tidy-up action can be taken back */
    state(id) {
      const { threads, overrides, undo } = load(id);
      return { threads, overrides, canUndo: undo.length > 0 };
    },
    /**
     * A thread for `binding` (the existing one, opened again, its links grown) or a new one; a
     * name taken already gets a number. `autoName`: named by the server, renamed on later loads
     */
    create(
      orchestratorId,
      {
        name,
        binding = null,
        parentKey = null,
        agents = [],
        now = Date.now(),
        readAt = now,
        autoName = false,
      }
    ) {
      return change(orchestratorId, (doc) => {
        const existing = binding && doc.threads.find((t) => sameBinding(t.binding, binding));
        if (existing) {
          existing.closed = false;
          existing.agents = [...new Set([...existing.agents, ...agents])];
          return existing;
        }
        const thread = newThread(doc.threads, {
          name,
          binding,
          parentKey,
          agents,
          now,
          readAt,
          autoName,
        });
        doc.threads.push(thread);
        return thread;
      });
    },
    /**
     * Close or open, mark read (forward only), link more workers, rename. A rename is the user's
     * (UI): it changes the shown name only (the tag stays) and is never overwritten again.
     * `command` (`/name`): sent from the thread without its tag (the CLI runs it only as the first
     * word); marked with the server time, its first turn after it belongs to the thread.
     * `cancelCommand`: drop the latest mark (the send failed)
     */
    update(
      orchestratorId,
      threadId,
      { closed, readAt, agents, name, command, cancelCommand, now = Date.now() }
    ) {
      return change(orchestratorId, (doc) => {
        const thread = doc.threads.find((t) => t.id === threadId);
        if (!thread) throw httpError(404, 'No thread with this id');
        if (name) {
          const clean = { project: cleanName(name.project), task: cleanName(name.task) };
          if (!clean.task) throw httpError(400, 'A thread name needs a task');
          thread.name = clean;
          thread.renamed = true;
          delete thread.autoName;
        }
        if (typeof closed === 'boolean') thread.closed = closed;
        if (typeof readAt === 'number') thread.readAt = Math.max(thread.readAt, readAt);
        if (agents?.length) thread.agents = [...new Set([...thread.agents, ...agents])];
        if (command)
          thread.commands = [...(thread.commands ?? []), { at: now, command }].slice(-MAX_COMMANDS);
        if (cancelCommand) thread.commands = (thread.commands ?? []).slice(0, -1);
        return thread;
      });
    },
    /** Server-made names (`autoName`), by thread id; never a thread the user renamed */
    autoRename(orchestratorId, names) {
      return change(orchestratorId, (doc) => {
        for (const thread of doc.threads) {
          const name = names.get(thread.id);
          if (!name || thread.renamed) continue;
          thread.name = name;
          thread.autoName = true;
        }
        return doc.threads;
      });
    },
    /**
     * One unbound thread per agent no thread links yet (closed ones count): what `orkumo start`
     * and the transcript backfill open. `start`: only an unbound thread counts, and bound threads
     * a poll linked the new agent to meanwhile let go of it (its own thread wins)
     * @param {{ agents: string[], name: { project: string, task: string }, now: number, readAt?: number }[]} wanted
     */
    addAgentThreads(orchestratorId, wanted, { start = false } = {}) {
      return change(orchestratorId, (doc) => {
        const added = [];
        for (const init of wanted) {
          const linking = doc.threads.filter((t) =>
            t.agents.some((a) => linksAgent(a, init.agents))
          );
          if (linking.some((t) => !start || !t.binding)) continue;
          for (const t of linking) t.agents = t.agents.filter((a) => !linksAgent(a, init.agents));
          const thread = newThread(doc.threads, {
            ...init,
            binding: null,
            parentKey: null,
            readAt: init.readAt ?? init.now,
            // follows the agent's name: an omp session is named after its prompt until it titles itself
            autoName: true,
          });
          doc.threads.push(thread);
          added.push(thread);
        }
        return added;
      });
    },
    /**
     * A tidy-up action of the orchestrator: `fn(doc)` changes threads and overrides (throws to
     * refuse, nothing stored); the state before goes on the undo stack under `label`
     */
    tidy(orchestratorId, label, fn) {
      return change(orchestratorId, (doc) => {
        const before = { label, threads: clone(doc.threads), overrides: clone(doc.overrides) };
        fn(doc);
        doc.undo = [...doc.undo, before].slice(-UNDO_MAX);
        return doc;
      });
    },
    /**
     * Takes back the last tidy-up action: threads and overrides as they were, except what the user
     * did since (a manual rename, read marks, command marks) and threads opened since. Its label
     */
    undo(orchestratorId) {
      return change(orchestratorId, (doc) => {
        const last = doc.undo.pop();
        if (!last) throw httpError(409, 'Nothing to undo');
        const current = new Map(doc.threads.map((t) => [t.id, t]));
        const restored = last.threads.map((t) => {
          const now = current.get(t.id);
          if (!now) return t;
          if (now.readAt > t.readAt) t.readAt = now.readAt;
          // command marks are the user's sends, not tidy-up: they stay
          if (now.commands) t.commands = now.commands;
          if (now.renamed) {
            t.name = now.name;
            t.renamed = true;
            delete t.autoName;
          }
          return t;
        });
        const known = new Set(restored.map((t) => t.id));
        doc.threads = [...restored, ...doc.threads.filter((t) => !known.has(t.id))];
        doc.overrides = last.overrides;
        return last.label;
      });
    },
  };
}

/** Tidy-up actions on a thread file (`createThreadStore().tidy`); each throws to refuse */
export const tidyActions = {
  merge(doc, targetRef, sourceRefs) {
    const target = findThread(doc.threads, targetRef);
    const final = mergeTarget(target.id, doc.overrides.merged);
    for (const ref of sourceRefs) {
      const source = findThread(doc.threads, ref);
      if (mergeTarget(source.id, doc.overrides.merged) === final)
        throw httpError(400, `Thread ${source.id} is the target or already merged into it`);
      doc.overrides.merged[source.id] = final;
    }
  },
  /** `keys`: entry keys the transcript holds (the route checks); `to`: thread ref or 'main' */
  move(doc, keys, to) {
    const target =
      to === 'main' ? 'main' : mergeTarget(findThread(doc.threads, to).id, doc.overrides.merged);
    for (const key of keys) doc.overrides.entries[key] = target;
  },
  rename(doc, ref, title) {
    const thread = findThread(doc.threads, ref);
    if (thread.renamed)
      throw httpError(409, `Thread ${thread.id} was renamed by the user: its name stays`);
    thread.name = parseTitle(title);
    thread.autoName = false;
  },
  /** Links `agents` here only (other threads let go of them), or binds a status task */
  bind(doc, ref, { agents, binding }) {
    const thread = findThread(doc.threads, ref);
    if (agents) {
      for (const t of doc.threads)
        if (t !== thread) t.agents = t.agents.filter((a) => !linksAgent(a, agents));
      thread.agents = [...new Set([...thread.agents, ...agents])];
    }
    if (binding) thread.binding = binding;
  },
  close(doc, ref) {
    findThread(doc.threads, ref).closed = true;
  },
};

/** A sender id of a message header (often shortened) names this linked agent; as the UI routes */
const MIN_ID = 8;
const linksAgent = (linked, ids) =>
  ids.some((id) => linked === id || (id.length >= MIN_ID && linked.startsWith(id)));

/** First line `orkumo send` puts before a message; the German form of older transcripts too */
const SENDER_RE = /^\[(?:from agent|von Agent) (\S+)(?: "([^"]*)"| „([^“]*)“)? via orkumo send\]/;

/** Text the user side typed (Claude `user` record, omp/pi `message` of role user), not tool output */
function typedText(rec) {
  const msg = rec?.message;
  const typed = (rec?.type === 'user' || rec?.type === 'message') && msg?.role === 'user';
  if (!typed) return '';
  if (typeof msg.content === 'string') return msg.content;
  return Array.isArray(msg.content)
    ? msg.content.map((b) => (b?.type === 'text' ? b.text || '' : '')).join('\n')
    : '';
}

/** Sender of one transcript line typed by `orkumo send`, null for anything else */
export function senderOfLine(line) {
  if (!line.includes('via orkumo send')) return null;
  let rec;
  try {
    rec = JSON.parse(line);
  } catch {
    return null;
  }
  const m = SENDER_RE.exec(unwrapPasted(typedText(rec)).trimStart());
  const ts = Date.parse(rec.timestamp);
  return m && Number.isFinite(ts) ? { id: m[1], name: m[2] ?? m[3] ?? null, ts } : null;
}

const SCAN_CHUNK = 4 * 1024 * 1024;

/**
 * Senders of `orkumo send` messages in transcripts, by id with name and first time. Remembers
 * the offset per file and reads only what was appended since (the thread list is polled)
 */
export function createSenderScanner() {
  const files = new Map();
  return async function senders(file) {
    const { size } = await fsp.stat(file);
    let state = files.get(file);
    // a shorter file was rewritten: start over
    if (!state || size < state.offset) state = { offset: 0, senders: new Map() };
    files.set(file, state);
    if (size === state.offset) return state.senders;
    const handle = await fsp.open(file, 'r');
    try {
      let pos = state.offset;
      let pending = Buffer.alloc(0);
      while (pos < size) {
        const chunk = Buffer.alloc(Math.min(SCAN_CHUNK, size - pos));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, pos);
        if (!bytesRead) break;
        pos += bytesRead;
        pending = Buffer.concat([pending, chunk.subarray(0, bytesRead)]);
        // whole lines only: a line still being written is read again next time
        const end = pending.lastIndexOf(10);
        if (end === -1) continue;
        for (const line of pending.subarray(0, end).toString('utf8').split('\n')) {
          const sender = senderOfLine(line);
          if (sender && !state.senders.has(sender.id)) state.senders.set(sender.id, sender);
        }
        pending = pending.subarray(end + 1);
        state.offset = pos - pending.length;
      }
    } finally {
      await handle.close();
    }
    return state.senders;
  };
}

// ---------------------------------------------------------------------------------------------
// Entries of the orchestrator chat, routed as agents-ui routes them (utils/chatThreads.ts
// `routeThreads`, utils/chatEvents.ts `reduceChat` + `groupAnswers`); `orkumo thread list/messages`
// count and print them, the tidy-up layer addresses them by key.
// ---------------------------------------------------------------------------------------------

const TEXT_MAX = 4000;
const TAG_START = '[Thread: ';
/** `orkumo send` header as agents-ui reads it (chatEvents.ts AGENT_MESSAGE_RE) */
const AGENT_MESSAGE_RE =
  /^\[(?:(?:from agent|von Agent) (\S+)(?: "([^"]*)"| „([^“]*)“)? via orkumo send|via orkumo send, (?:sender unknown|Absender unbekannt))\]\n*/;

/**
 * Chat items of a transcript, read incrementally (the file only grows; a shorter one starts
 * over). Entry key = the key the chat view routes by: a user message's transcript key
 * (`devorbit_user.key`: Claude `uuid`, omp/pi record `id`), an answer's first assistant message id
 * (Claude `message.id`, omp/pi record `id`). Recaps and stray results are items too (they end a
 * turn) but no entries: their keys are positions in the client's state
 */
export function createEntryScanner() {
  const files = new Map();
  const fold = (state, event) => {
    if (event.type === 'devorbit_user') {
      state.items.push({
        kind: 'user',
        key: event.key || `u${state.count}`,
        text: String(event.text ?? '').slice(0, TEXT_MAX),
        ts: event.ts,
      });
      state.count++;
      state.last = 'user';
    } else if (event.type === 'assistant' && !event.parent_tool_use_id) {
      const content = Array.isArray(event.message?.content) ? event.message.content : null;
      if (!content) return;
      const id = event.message.id || `a${state.count}`;
      const text = content
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text);
      // the same message id again (one event per content block) joins its message
      let item = state.byMessage.get(id);
      if (!item) {
        state.count++;
        if (state.last === 'assistant' && state.open) item = state.open;
        else {
          item = { kind: 'answer', key: id, text: '', first: '', ts: event.ts };
          state.items.push(item);
          state.open = item;
        }
        state.byMessage.set(id, item);
        state.last = 'assistant';
      }
      for (const t of text) {
        if (!item.first && t.trim()) item.first = t.trimStart().slice(0, TEXT_MAX);
        if (item.text.length < TEXT_MAX)
          item.text = (item.text ? `${item.text}\n\n${t}` : t).slice(0, TEXT_MAX);
      }
    } else if (event.type === 'result') {
      if (state.last !== 'assistant') state.items.push({ kind: 'result', key: `r${state.count}` });
      state.count++;
      state.last = 'result';
      state.open = null;
    } else if (event.type === 'system' && event.subtype === 'away_summary' && event.content) {
      state.items.push({ kind: 'recap', key: `c${state.count}` });
      state.count++;
      state.last = 'recap';
      state.open = null;
    }
  };
  // one read per file at a time: a second caller (CLI and UI at once) reads after the first, so
  // no state is folded twice
  const running = new Map();
  return function entries(file, reader) {
    const next = (running.get(file) ?? Promise.resolve())
      .catch(() => {})
      .then(() => read(file, reader));
    running.set(file, next);
    const done = () => running.get(file) === next && running.delete(file);
    next.then(done, done);
    return next;
  };
  async function read(file, reader) {
    const { size } = await fsp.stat(file);
    let state = files.get(file);
    if (!state || size < state.offset)
      state = { offset: 0, items: [], byMessage: new Map(), open: null, last: null, count: 0 };
    files.set(file, state);
    if (size === state.offset) return state.items;
    const handle = await fsp.open(file, 'r');
    try {
      let pos = state.offset;
      let pending = Buffer.alloc(0);
      while (pos < size) {
        const chunk = Buffer.alloc(Math.min(SCAN_CHUNK, size - pos));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, pos);
        if (!bytesRead) break;
        pos += bytesRead;
        pending = Buffer.concat([pending, chunk.subarray(0, bytesRead)]);
        const end = pending.lastIndexOf(10);
        if (end === -1) continue;
        const lines = pending.subarray(0, end).toString('utf8').split('\n');
        // every entry: the CLI lists and moves old ones too (the view's replay cap is no limit here)
        for (const event of reader.historyEvents(lines, Infinity)) fold(state, event);
        pending = pending.subarray(end + 1);
        state.offset = pos - pending.length;
      }
    } finally {
      await handle.close();
    }
    return state.items;
  }
}

/** Routing key of a chat item key: without the history page prefixes `h<before>:` */
export const entryKey = (key) => String(key ?? '').replace(/^(?:h\d+:)+/, '');

const sameAgent = (linked, sender) =>
  sender.length >= MIN_ID && (linked === sender || linked.startsWith(sender));

/** Thread of one item by tag or linked agent, null for the main chat (agents-ui `threadOf`) */
function threadOf(item, threads) {
  const byTag = (text) => {
    const hits = threads.filter((t) => text.startsWith(t.tag));
    return hits.length === 1 ? hits[0].id : null;
  };
  if (item.kind === 'answer') return byTag(item.first);
  if (item.kind !== 'user') return null;
  const sent = AGENT_MESSAGE_RE.exec(item.text);
  if (!sent) return byTag(item.text.trimStart());
  const tagged = byTag(item.text.slice(sent[0].length).trimStart());
  if (tagged) return tagged;
  const sender = sent[1];
  if (!sender) return null;
  const linked = threads.filter(
    (t) =>
      !t.closed &&
      (item.ts === undefined || item.ts >= t.createdAt) &&
      t.agents.some((a) => sameAgent(a, sender))
  );
  return linked.length === 1 ? linked[0].id : null;
}

/** A logged command is the marked one, with or without the plugin prefix (agents-ui `sameCommand`) */
const sameCommand = (logged, marked) => logged === marked || logged.endsWith(`:${marked.slice(1)}`);

/**
 * Command prompts the threads' marks claim, as agents-ui `commandTurns` on the whole history: each
 * mark takes the first prompt at or after it that is its command; a tidy-up move of that prompt
 * still uses the mark up (the move decides where it goes)
 */
function commandTurns(items, threads) {
  const claimed = new Map();
  const marks = threads
    .flatMap((t) => (t.commands ?? []).map((m) => ({ ...m, id: t.id })))
    .sort((a, b) => a.at - b.at);
  for (const mark of marks) {
    const own = items.find(
      (i) =>
        i.kind === 'user' &&
        i.ts !== undefined &&
        i.ts >= mark.at &&
        !claimed.has(i) &&
        !AGENT_MESSAGE_RE.test(i.text) &&
        sameCommand(/^\/\w[\w:.-]*(?=\s|$)/.exec(i.text.trim())?.[0] ?? '', mark.command) &&
        !threadOf(i, threads)
    );
    if (own) claimed.set(own, mark.id);
  }
  return claimed;
}

/**
 * Thread id (null: main chat) of every item, as agents-ui `routeThreads(items, threads, true,
 * undefined, overrides)`: an override wins (one to an unknown thread falls back to the rules),
 * then command marks, tag, linked agent and turn; merged threads resolve to their final target
 */
export function routeEntries(items, threads, overrides) {
  const known = new Set(threads.map((t) => t.id));
  const merged = overrides?.merged ?? {};
  const target = (id) => {
    if (!id) return null;
    const to = mergeTarget(id, merged);
    return to !== id && known.has(to) ? to : id;
  };
  const commands = commandTurns(items, threads);
  let prev = null;
  return items.map((item) => {
    const untagged = item.kind === 'answer' && !item.first.startsWith(TAG_START);
    const moved = overrides?.entries?.[entryKey(item.key)];
    const id =
      moved === 'main'
        ? null
        : moved && known.has(moved)
          ? target(moved)
          : !threads.length
            ? null
            : commands.has(item)
              ? target(commands.get(item))
              : untagged
                ? (target(threadOf(item, threads)) ?? prev)
                : target(threadOf(item, threads));
    prev = id;
    return id;
  });
}

/** Entries (user messages and answers) with their thread: what the tidy-up CLI reads */
export const routedEntries = (items, threads, overrides) => {
  const routed = routeEntries(items, threads, overrides);
  return items.flatMap((item, i) =>
    item.kind === 'user' || item.kind === 'answer'
      ? [
          {
            key: item.key,
            kind: item.kind,
            text: item.text,
            ts: item.ts ?? null,
            thread: routed[i],
          },
        ]
      : []
  );
};

// ---------------------------------------------------------------------------------------------
// Names (AC-9): after the project, never "Answer HH:MM · <first words>"
// ---------------------------------------------------------------------------------------------

/** Old client-made names ("Answer 18:39 · …"): renamed like server-made ones */
const LEGACY_NAME_RE = /^Answer \d{1,2}:\d{2}$/;
export const isAutoNamed = (thread) =>
  !thread.renamed && (thread.autoName === true || LEGACY_NAME_RE.test(thread.name.project));

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Display name of the first known project `text` mentions (earliest position, then the longest
 * alias), case-insensitive on word boundaries (letters, digits, `_` and `-` count as word)
 * @param {{ name: string, aliases: string[] }[]} projects
 */
export function mentionedProject(text, projects) {
  let best = null;
  for (const project of projects)
    for (const alias of project.aliases) {
      if (alias.length < 3) continue;
      const re = new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRe(alias)}(?![\\p{L}\\p{N}_-])`, 'iu');
      const m = re.exec(text);
      if (m && (!best || m.index < best.at || (m.index === best.at && alias.length > best.len)))
        best = { at: m.index, len: alias.length, name: project.name };
    }
  return best?.name ?? null;
}

/**
 * Name of a server-named thread, in this order: the agent it links (its project and name), its
 * status task, the first project `text` names, else the provisional `fallback`
 * @param {{ agentName: (id: string) => ({ project: string, task: string } | null),
 *   report: object|null, projects: { name: string, aliases: string[] }[], text: string,
 *   fallback: { project: string, task: string } }} ctx
 */
export function threadName(thread, { agentName, report, projects, text, fallback }) {
  for (const id of thread.agents ?? []) {
    const name = agentName(id);
    if (name) return name;
  }
  const b = thread.binding;
  const project = b && report?.projects.find((p) => p.id === b.project);
  const task = b?.task && project?.tasks.find((t) => t.id === b.task);
  if (task) return { project: cleanName(project.name), task: cleanName(task.title) };
  const mentioned = text && mentionedProject(text, projects);
  if (mentioned) {
    const name = cleanName(mentioned);
    return { project: name, task: name };
  }
  return fallback;
}

/** Which of `needles` occur in the files, read line by line (transcripts run to hundreds of MB) */
async function needlesIn(files, needles) {
  const found = new Set();
  for (const file of files)
    try {
      const lines = readline.createInterface({
        input: fs.createReadStream(file),
        crlfDelay: Infinity,
      });
      for await (const line of lines)
        for (const n of needles) if (!found.has(n) && line.includes(n)) found.add(n);
    } catch {
      // unreadable transcript: no evidence
    }
  return found;
}

/** Entry keys a transcript holds verbatim (uuid, record or message id); `u3`-like positions never */
const PROVABLE_KEY = 8;

/**
 * Threads kept under a role (before threads were keyed by session, every orchestrator of a role
 * shared them) moved to the holder whose transcript proves them: the answered message's record
 * id, else the tag (only when every holder's transcript was found), in exactly one holder's
 * transcript. Unproven ones stay. The role's tidy-up layer goes along, as only the session's is
 * read: an entry with the thread it names (wherever an earlier run put it), a `main` entry to the
 * one holder whose transcript has its key, a merge link with its source's (else target's) thread;
 * the session's own entries win. The role's undo states split the same way: each holder gets the
 * part of its threads and layer (under its own undo states, so the session's own go back first),
 * the role keeps the rest; the holder's undo states keep the carried layer. Nothing else is
 * rewritten or dropped; a second run changes nothing.
 * @param {string} dir orchestrator-reports dir of the store
 * @param {{ key: string, transcripts: string[] }[]} holders current sessions of the role
 * @returns {Promise<number>} threads moved
 */
export async function returnMisplacedThreads(dir, role, holders) {
  const fileOf = (id) => path.join(dir, 'threads', `${id}.json`);
  const load = (id) => {
    try {
      return JSON.parse(fs.readFileSync(fileOf(id), 'utf8')) ?? {};
    } catch {
      return {};
    }
  };
  // exact JSON forms: a bare 8-hex id would match by chance in a large transcript
  const keyNeedle = (t) => t.parentKey && `"id":${JSON.stringify(t.parentKey)}`;
  const tagNeedle = (t) => JSON.stringify(t.tag).slice(1, -1);
  const entryNeedle = (key) => key.length >= PROVABLE_KEY && JSON.stringify(key);
  const first = load(role);
  const legacy = first.threads ?? [];
  // undo states may name main entries the current layer no longer has
  const mainKeys = [first.overrides, ...(first.undo ?? []).map((u) => u.overrides)]
    .flatMap((o) => Object.entries(o?.entries ?? {}))
    .filter(([, to]) => to === 'main')
    .map(([key]) => key);
  const layer = Object.keys(first.overrides?.entries ?? {}).length;
  const links = Object.keys(first.overrides?.merged ?? {}).length;
  if ((!legacy.length && !layer && !links) || !holders.length) return 0;
  const needles = [
    ...legacy.flatMap((t) => [keyNeedle(t), tagNeedle(t)]),
    ...mainKeys.map(entryNeedle),
  ].filter(Boolean);
  const found = await Promise.all(holders.map((h) => needlesIn(h.transcripts, needles)));
  const allRead = holders.every((h) => h.transcripts.length);
  const only = (needle) => {
    const at = holders.filter((_, i) => needle && found[i].has(needle));
    return at.length === 1 ? at[0].key : null;
  };
  const moved = new Map();
  for (const t of legacy) {
    // a holder without transcript could hold the tag too: a tag alone proves nothing then
    const to = only(keyNeedle(t)) ?? (allRead ? only(tagNeedle(t)) : null);
    if (to) moved.set(t.id, to);
  }
  // read again after the scan: a PATCH meanwhile is kept, a moved thread goes as it is now
  const roleDoc = load(role);
  const fresh = roleDoc.threads ?? [];
  const docs = new Map(holders.map((h) => [h.key, load(h.key)]));
  // holder a thread lives with after this run (moved now or by an earlier run)
  const holderOf = (id) =>
    moved.get(id) ??
    holders.find((h) => (docs.get(h.key).threads ?? []).some((t) => t.id === id))?.key;
  /** A tidy-up layer split: each holder's part, and what stays with the role */
  const split = (overrides) => {
    const rest = { entries: { ...overrides?.entries }, merged: { ...overrides?.merged } };
    const parts = new Map(holders.map((h) => [h.key, { entries: {}, merged: {} }]));
    for (const [key, to] of Object.entries(rest.entries)) {
      const at = to === 'main' ? only(entryNeedle(key)) : holderOf(to);
      if (!at) continue;
      parts.get(at).entries[key] = to;
      delete rest.entries[key];
    }
    for (const [from, to] of Object.entries(rest.merged)) {
      const at = holderOf(from) ?? holderOf(to);
      if (!at) continue;
      parts.get(at).merged[from] = to;
      delete rest.merged[from];
    }
    return { parts, rest };
  };
  const empty = (layer) => !Object.keys(layer.entries).length && !Object.keys(layer.merged).length;
  const { parts: carry, rest: roleLayer } = split(roleDoc.overrides);
  // role undo states: per holder its threads and layer part, the role keeps what is left
  const carryUndo = new Map(holders.map((h) => [h.key, []]));
  const roleUndo = [];
  for (const u of roleDoc.undo ?? []) {
    const { parts, rest } = split(u.overrides);
    const threads = u.threads ?? [];
    let gone = false;
    for (const { key } of holders) {
      const own = threads.filter((t) => holderOf(t.id) === key);
      if (!own.length && empty(parts.get(key))) continue;
      gone = true;
      carryUndo.get(key).push({ label: u.label, threads: own, layer: parts.get(key) });
    }
    if (!gone) roleUndo.push(u);
    else {
      const stays = threads.filter((t) => !holderOf(t.id));
      if (stays.length || !empty(rest)) roleUndo.push({ ...u, threads: stays, overrides: rest });
    }
  }
  const changed = (before, after) => JSON.stringify(before) !== JSON.stringify(after);
  // carried first, the session's own over them
  const withLayer = (overrides, add) => ({
    entries: { ...add.entries, ...overrides?.entries },
    merged: { ...add.merged, ...overrides?.merged },
  });
  for (const { key } of holders) {
    const doc = docs.get(key);
    const own = doc.threads ?? [];
    const have = new Set(own.map((t) => t.id));
    const add = carry.get(key);
    // a run cut short before the role file shrank carried these already
    const had = new Set((doc.undo ?? []).map((u) => JSON.stringify([u.label, u.threads])));
    const carried = carryUndo
      .get(key)
      .filter((u) => !had.has(JSON.stringify([u.label, u.threads])))
      // taken back, the session's own entries stay; the role part goes back to how it was
      .map((u) => ({
        label: u.label,
        threads: u.threads,
        overrides: withLayer(doc.overrides, u.layer),
      }));
    const next = {
      ...doc,
      threads: [...own, ...fresh.filter((t) => moved.get(t.id) === key && !have.has(t.id))],
      overrides: withLayer(doc.overrides, add),
      // an undo goes back to a state the carried layer was already in
      undo: [
        ...carried,
        ...(doc.undo ?? []).map((u) => ({ ...u, overrides: withLayer(u.overrides, add) })),
      ].slice(-UNDO_MAX),
    };
    if (!doc.overrides && empty(add)) delete next.overrides;
    if (!doc.undo && !carried.length) delete next.undo;
    if (changed(doc, next)) writeAtomic(fileOf(key), next);
  }
  // the role file shrinks last: a run cut short leaves copies the next run does not add again
  const stay = fresh.filter((t) => !moved.has(t.id));
  const nextRole = {
    ...roleDoc,
    threads: stay,
    ...(roleDoc.overrides ? { overrides: roleLayer } : {}),
    ...(roleDoc.undo ? { undo: roleUndo } : {}),
  };
  if (changed(roleDoc, nextRole)) writeAtomic(fileOf(role), nextRole);
  return fresh.length - stay.length;
}
