/**
 * Threads of an orchestrator chat (agents-ui `utils/chatThreads.ts` routes the messages): one file
 * per orchestrator under `<data>/orchestrator-reports/threads/<id>.json`, next to its reports.
 * A thread keeps its tag, binding and linked workers from the moment it was made, so a retitled
 * or dropped task never orphans the messages already sent under it.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { httpError, writeAtomic } from './orchestratorReports.js';

const NAME_MAX = 60;

/** One line without the characters that would break the tag (`[`, `]`, quotes), capped */
export function cleanName(text, max = NAME_MAX) {
  const line = String(text ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f[\]"“”„`]/g, ' ')
    .replace(/\s+/g, ' ')
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

export function createThreadStore(dir) {
  const threadsDir = path.join(dir, 'threads');
  const fileOf = (id) => path.join(threadsDir, `${id}.json`);
  const read = (id) => {
    try {
      return JSON.parse(fs.readFileSync(fileOf(id), 'utf8')).threads ?? [];
    } catch {
      return [];
    }
  };
  const save = (id, threads) => {
    fs.mkdirSync(threadsDir, { recursive: true });
    writeAtomic(fileOf(id), { threads });
  };

  return {
    list: read,
    /**
     * A thread for `binding` (the existing one, opened again, its links grown) or a new one; an
     * unbound name taken already gets a number
     */
    create(
      orchestratorId,
      { name, binding = null, parentKey = null, agents = [], now = Date.now() }
    ) {
      const threads = read(orchestratorId);
      const existing = binding && threads.find((t) => sameBinding(t.binding, binding));
      if (existing) {
        existing.closed = false;
        existing.agents = [...new Set([...existing.agents, ...agents])];
        save(orchestratorId, threads);
        return existing;
      }
      const clean = { project: cleanName(name.project), task: cleanName(name.task) || 'Thread' };
      const taken = new Set(threads.map((t) => t.tag));
      let unique = clean;
      for (let i = 2; taken.has(tagOf(unique)); i++)
        unique = { ...clean, task: `${clean.task} ${i}` };
      const thread = {
        id: crypto.randomUUID(),
        tag: tagOf(unique),
        name: unique,
        binding,
        parentKey,
        agents: [...new Set(agents)],
        createdAt: now,
        readAt: now,
        closed: false,
      };
      save(orchestratorId, [...threads, thread]);
      return thread;
    },
    /** Close or open, mark read (forward only), link more workers */
    update(orchestratorId, threadId, { closed, readAt, agents }) {
      const threads = read(orchestratorId);
      const thread = threads.find((t) => t.id === threadId);
      if (!thread) throw httpError(404, 'No thread with this id');
      if (typeof closed === 'boolean') thread.closed = closed;
      if (typeof readAt === 'number') thread.readAt = Math.max(thread.readAt, readAt);
      if (agents?.length) thread.agents = [...new Set([...thread.agents, ...agents])];
      save(orchestratorId, threads);
      return thread;
    },
  };
}
