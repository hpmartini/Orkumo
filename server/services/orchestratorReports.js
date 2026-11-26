/**
 * Status reports of orchestrators (`orkumo report`): the latest report per orchestrator, the
 * answers given in the Status view, and a change log derived by comparing snapshots. Files under
 * `<data>/orchestrator-reports/` (outside the orchestrator workspace, which orchestrators may write): `reports/<id>.json` (written atomically) and `changes.jsonl`.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { findSessionByRef, isOrchestratorSession, sessionRole } from './orchestratorService.js';

/** A report is stale 30 min after the first event in its area that came after it (AC-5) */
export const STALE_AFTER_MS = 30 * 60_000;
const BUSY = new Set(['working', 'waiting', 'loop']);

const ms = (iso) => (iso ? Date.parse(iso) : NaN);

/** Stale iff the first event after the report is at least STALE_AFTER_MS old */
export function isStale({ reportedAt, events, now }) {
  const after = events.filter((t) => t > reportedAt);
  if (after.length === 0) return false;
  return now - Math.min(...after) >= STALE_AFTER_MS;
}

const decisionIds = (report) =>
  (report?.inbox || []).filter((e) => e.kind === 'decision').map((e) => e.id);

/** Decisions in `next` that `prev` did not have: the only thing that notifies (AC-6) */
export function newDecisionIds(prev, next) {
  const known = new Set(decisionIds(prev));
  return decisionIds(next).filter((id) => !known.has(id));
}

/**
 * Only an orchestrator session may report, and only under its own key: its role id, else its row
 * id (AC-3). `senderRef` is the session the CLI runs in (row id, transcript uuid or pane id).
 */
export function authorizeReporter(orchestratorId, senderRef, sessions, settings) {
  if (!senderRef)
    return { ok: false, status: 400, error: 'Unknown sender: run `orkumo report` inside an agent' };
  const session = findSessionByRef(sessions, senderRef);
  if (!session || !isOrchestratorSession(session, settings.orchestrators))
    return { ok: false, status: 403, error: 'Only an orchestrator session may report' };
  const own = sessionRole(session, settings.orchestratorRoles) ?? session.id;
  if (orchestratorId !== own)
    return {
      ok: false,
      status: 403,
      error: `This session reports as "${own}", not "${orchestratorId}"`,
    };
  return { ok: true, session };
}

/** A roleless orchestrator's report leaves the view this long after its last report */
export const HIDE_ROLELESS_AFTER_MS = 24 * 60 * 60_000;
const ENDED = new Set(['done', 'failed', 'stopped']);

/**
 * Hidden from GET: a roleless orchestrator (key = its agent id, no `roles/<id>.md`) whose session
 * is gone or finished and that sent nothing for 24 h. Its report file and change log stay.
 */
export function isHiddenReport(state, { roleIds, sessions, now = Date.now() }) {
  const { id, agentId } = state.report.orchestrator;
  if (roleIds.has(id)) return false;
  const session =
    findSessionByRef(sessions, id) ?? (agentId && findSessionByRef(sessions, agentId));
  if (session && !ENDED.has(session.state)) return false;
  return now - ms(state.receivedAt) >= HIDE_ROLELESS_AFTER_MS;
}

const taskStates = (report) =>
  new Map(
    (report?.projects || []).flatMap((p) =>
      p.tasks.map((t) => [`${p.id}\u0000${t.id}`, { project: p.id, task: t.id, state: t.state }])
    )
  );

function diff(prev, next) {
  const before = new Set((prev?.inbox || []).map((e) => e.id));
  const after = new Set(next.inbox.map((e) => e.id));
  const old = taskStates(prev);
  const tasks = [...taskStates(next)]
    .filter(([key, t]) => old.get(key)?.state !== t.state)
    .map(([key, t]) => ({
      project: t.project,
      task: t.task,
      from: old.get(key)?.state ?? null,
      to: t.state,
    }));
  return {
    opened: [...after].filter((id) => !before.has(id)),
    closed: [...before].filter((id) => !after.has(id)),
    tasks,
    notify: newDecisionIds(prev, next),
  };
}

export function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Chat context key → what counts as a change of that item (inbox entries and tasks) */
const contextItems = (report) =>
  new Map([
    ...(report?.inbox || []).map((e) => [
      `inbox:${e.id}`,
      JSON.stringify([e.title, e.detail, e.description, e.options, e.pr]),
    ]),
    ...(report?.projects || []).flatMap((p) =>
      p.tasks.map((t) => [
        `task:${p.id}:${t.id}`,
        JSON.stringify([t.title, t.note, t.description, t.state]),
      ])
    ),
  ]);

/**
 * New or changed items wait for the orchestrator's next answer (`pending[key] = since`); items
 * still pending keep their time, every item still present keeps its context, gone items drop both
 */
function contextState(prev, report, receivedAt) {
  const before = contextItems(prev?.report);
  const pending = {};
  const contexts = {};
  for (const [key, sig] of contextItems(report)) {
    if (before.get(key) !== sig) pending[key] = receivedAt;
    else if (prev?.pending?.[key]) pending[key] = prev.pending[key];
    if (prev?.contexts?.[key]) contexts[key] = prev.contexts[key];
  }
  return { pending, contexts };
}

export function createReportStore(dir) {
  const reportsDir = path.join(dir, 'reports');
  const logFile = path.join(dir, 'changes.jsonl');
  const fileOf = (id) => path.join(reportsDir, `${id}.json`);
  const read = (id) => {
    try {
      return JSON.parse(fs.readFileSync(fileOf(id), 'utf8'));
    } catch {
      return null;
    }
  };
  const save = (state) => {
    fs.mkdirSync(reportsDir, { recursive: true });
    writeAtomic(fileOf(state.report.orchestrator.id), state);
  };

  return {
    get: read,
    list() {
      if (!fs.existsSync(reportsDir)) return [];
      return fs
        .readdirSync(reportsDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => read(f.slice(0, -5)))
        .filter(Boolean);
    },
    /**
     * The report of a roleless orchestrator is keyed by its row id; a new session in its pane
     * (omp `/new`) has a new row id: the report moves to it (its `agentId` too, when given). An
     * existing newer report of `to` wins; the old file is gone. false: nothing to move
     */
    rekey(from, to, { agentId } = {}) {
      const state = read(from);
      if (from === to || !state) return false;
      const target = read(to);
      if (!target || ms(target.receivedAt) < ms(state.receivedAt)) {
        state.report.orchestrator = {
          ...state.report.orchestrator,
          id: to,
          ...(agentId ? { agentId } : {}),
        };
        save(state);
      }
      fs.rmSync(fileOf(from), { force: true });
      return true;
    },
    /** Stores a parsed report; returns the new state and its change-log entry */
    submit(report, { now = Date.now(), watch = {} } = {}) {
      const id = report.orchestrator.id;
      const prev = read(id);
      const open = new Set(report.inbox.map((e) => e.id));
      // An answer stays until the orchestrator drops the entry from its report (AC-4)
      const answers = Object.fromEntries(
        Object.entries(prev?.answers || {}).filter(([entry]) => open.has(entry))
      );
      const receivedAt = new Date(now).toISOString();
      const state = {
        report,
        receivedAt,
        answers,
        watch,
        ...contextState(prev, report, receivedAt),
      };
      save(state);
      const change = { at: state.receivedAt, orchestrator: id, ...diff(prev?.report, report) };
      fs.appendFileSync(logFile, `${JSON.stringify(change)}\n`);
      return { state, change };
    },
    answer(orchestratorId, entryId, answer, { now = Date.now() } = {}) {
      const state = read(orchestratorId);
      if (!state) throw httpError(404, `No report from "${orchestratorId}"`);
      if (!state.report.inbox.some((e) => e.id === entryId))
        throw httpError(404, `No open entry "${entryId}"`);
      state.answers[entryId] = { ...answer, at: new Date(now).toISOString() };
      save(state);
      return state;
    },
    /** Persists what the stale check observed (first-seen times) */
    setWatch(orchestratorId, watch) {
      const state = read(orchestratorId);
      if (!state) return;
      state.watch = watch;
      save(state);
    },
    /**
     * Applies `update(state)` → `{ pending, contexts }` to the stored state read fresh, so a report
     * that came in meanwhile is never overwritten with an older one; returns the stored state
     */
    updateContexts(orchestratorId, update) {
      const state = read(orchestratorId);
      if (!state) return null;
      const next = update(state);
      const same = (a, b) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
      if (same(next.pending, state.pending) && same(next.contexts, state.contexts)) return state;
      Object.assign(state, next);
      save(state);
      return state;
    },
    changes() {
      if (!fs.existsSync(logFile)) return [];
      return fs
        .readFileSync(logFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
          // A line cut off by a crash must not take the whole view down
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        });
    },
  };
}

const refAgents = (report) => [
  ...new Set(
    [...report.projects.flatMap((p) => p.tasks), ...report.inbox].flatMap(
      (x) => x.refs?.agents || []
    )
  ),
];

/**
 * Events in a report's area after it was sent, from the overview agents (AC-5):
 * - a referenced worker that is no longer busy and was active after the report (worker finished)
 * - a PR of a referenced worker that turned ready (green, mergeable) after the report, first seen
 * - the orchestrator itself went idle, then was active again and is idle again (own turn ended);
 *   the turn that sent the report does not count, it was running when the report came in
 * The first event after the report is latched in `watch.firstEventAt`: activity times move on
 * when an agent runs again, the 30 minutes must not restart. A new report resets `watch`.
 * shortcut: merged PRs are invisible here (the overview drops them) and a turn that started and
 *   ended while the server was down is missed; upgrade by reading PR state from the board.
 * @returns {{ events: number[], watch: object }} event times and the updated observations
 */
export function reportEvents(state, agents, now = Date.now()) {
  const { report } = state;
  const reportedAt = ms(state.receivedAt);
  // a copy: the caller compares it with state.watch to decide whether to persist
  const watch = { ...state.watch, prReady: { ...state.watch?.prReady } };
  const events = [];
  const byRef = (ref) => findSessionByRef(agents, ref);

  for (const agent of refAgents(report).map(byRef).filter(Boolean)) {
    const active = ms(agent.lastActivity);
    if (!BUSY.has(agent.displayState) && active > reportedAt) events.push(active);
    for (const pr of agent.prs || []) {
      if (pr.state !== 'ready') continue;
      watch.prReady[pr.url] ??= now;
      events.push(watch.prReady[pr.url]);
    }
  }

  const self = agents.find(
    (a) => a.role === report.orchestrator.id || a.id === report.orchestrator.id
  );
  if (self && !BUSY.has(self.displayState)) {
    const active = ms(self.lastActivity) || 0;
    if (watch.idleActivity === undefined) watch.idleActivity = active;
    else if (active > watch.idleActivity) events.push(active);
  }
  const after = events.filter((t) => t > reportedAt);
  if (after.length) watch.firstEventAt = Math.min(watch.firstEventAt ?? Infinity, ...after);
  return { events, watch };
}

/** Stale flag of a stored report from its latched first event; `watch` to persist when changed */
export function evaluateReport(state, agents, now = Date.now()) {
  const { watch } = reportEvents(state, agents, now);
  const events = watch.firstEventAt === undefined ? [] : [watch.firstEventAt];
  return {
    watch,
    changed: JSON.stringify(watch) !== JSON.stringify(state.watch ?? {}),
    stale: isStale({ reportedAt: ms(state.receivedAt), events, now }),
    firstEventAt: events.length ? new Date(events[0]).toISOString() : null,
  };
}

/** Pending chat context without an answer for this long is dropped */
export const CONTEXT_PENDING_MS = 2 * 60 * 60_000;
export const CONTEXT_MAX_CHARS = 20_000;
export const isBusyAgent = (agent) => BUSY.has(agent?.displayState);
// Claude transcripts render a tool call without text as `[tool: <name>]`: not an answer
const isToolOnly = (text) => text.split('\n').every((l) => /^\[tool: [^\]]*\]$/.test(l.trim()));
const timeOf = (t) => (t == null ? NaN : new Date(t).getTime());

/**
 * Chat context of pending items (AC-13): once the orchestrator is not busy, its last assistant
 * text at or after an item's `since` becomes `contexts[key] = { text, at }`; pending older than
 * CONTEXT_PENDING_MS is dropped. `entries`: the orchestrator's transcript tail, oldest first.
 * @returns {{ pending: object, contexts: object }}
 */
export function captureContext(state, { busy, entries = [], now = Date.now() }) {
  const pending = { ...state.pending };
  const contexts = { ...state.contexts };
  const last = busy
    ? null
    : entries.findLast((e) => e.role === 'assistant' && e.text && !isToolOnly(e.text));
  const at = timeOf(last?.timestamp);
  for (const [key, since] of Object.entries(pending)) {
    if (at >= timeOf(since)) {
      contexts[key] = {
        text: last.text.slice(0, CONTEXT_MAX_CHARS),
        at: new Date(at).toISOString(),
      };
      delete pending[key];
    } else if (now - timeOf(since) >= CONTEXT_PENDING_MS) delete pending[key];
  }
  return { pending, contexts };
}

/**
 * The live session of orchestrator `id`: the role's current session (a resumed pane has new ids,
 * the report's agentId may be old), else the session the report's agentId names; null when none
 */
export function orchestratorSessionOf(id, agentId, sessions, { orchestrators, orchestratorRoles }) {
  const own = (s) => isOrchestratorSession(s, orchestrators);
  return (
    sessions.find((s) => own(s) && (sessionRole(s, orchestratorRoles) ?? s.id) === id) ??
    [findSessionByRef(sessions, agentId)].find((s) => s && own(s)) ??
    null
  );
}

/**
 * How an answer reaches the orchestrator, the same way `orkumo send` picks it (sendRoute):
 * a background job by reply, else the pane it runs in; null when it cannot be reached
 */
export function answerTarget(session) {
  if (!session) return null;
  if (session.kind === 'background') return { via: 'reply', id: session.id };
  if (session.paneId) return { via: 'pane', paneId: session.paneId };
  return null;
}

/**
 * Types `text` into the orchestrator over `route` (answerTarget); null when delivered, else the
 * refusal as `{ status, error }`
 */
export async function deliverText(route, text, { typeIntoPanePty, replySession }) {
  if (route.via === 'pane') {
    if (!typeIntoPanePty(route.paneId, text))
      return { status: 409, error: 'The orchestrator pane is not running' };
  } else {
    await replySession(route.id, text, { mode: 'auto' });
  }
  return null;
}

/** Attachments of an instruction lie in the upload routes' dirs (`agent-images`, `agent-files`) */
export function attachmentsAllowed(attachments, dirs) {
  const roots = dirs.map((d) => path.resolve(d) + path.sep);
  return attachments.every(
    (a) =>
      path.isAbsolute(a.path) &&
      // each attachment is one typed line: no line breaks or other control characters
      // eslint-disable-next-line no-control-regex
      !/[\x00-\x1f\x7f]/.test(a.path) &&
      roots.some((r) => path.resolve(a.path).startsWith(r))
  );
}

/**
 * The message typed into the orchestrator for an instruction from the Status view, built from the
 * stored report (never from the client); null when the entry or task is not in it
 * @param {{ entry?: string, task?: { project: string, task: string } }} target
 */
export function instructText(report, target, text, attachments = []) {
  const projectOf = (pid) => report.projects.find((p) => p.id === pid);
  let item;
  let project;
  let label;
  if (target.entry) {
    item = report.inbox.find((e) => e.id === target.entry);
    // reports from before projectId was required: the project of its task
    project =
      projectOf(item?.projectId) ??
      report.projects.find((p) => p.tasks.some((t) => t.id === item?.taskId));
    label = `entry ${target.entry}`;
  } else {
    project = projectOf(target.task.project);
    item = project?.tasks.find((t) => t.id === target.task.task);
    label = `task ${target.task.task}`;
  }
  if (!item) return null;
  const refs = [...new Set([item.pr, ...(item.refs?.prs || []), ...(item.refs?.issues || [])])]
    .filter(Boolean)
    .join(' ');
  return [
    `[Status] ${project?.name ?? 'No project'} · ${item.title} (${label}${refs ? `, refs ${refs}` : ''})`,
    '',
    text,
    ...attachments.map((a) => `[${a.kind === 'image' ? 'Image' : 'File'}: ${a.path}]`),
  ].join('\n');
}

/** The message typed into the orchestrator for an answer from the Status view */
export function answerText(entry, option, text) {
  return [
    `[Status answer] ${entry.title} (entry ${entry.id})`,
    option && `Choice: ${option.label} (${option.id})`,
    text,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Baseline at submit: PRs already ready when the report came in are not events */
export function submitWatch(report, agents, now = Date.now()) {
  const prReady = {};
  for (const agent of refAgents(report)
    .map((ref) => findSessionByRef(agents, ref))
    .filter(Boolean))
    for (const pr of agent.prs || []) if (pr.state === 'ready') prReady[pr.url] = now;
  return { prReady };
}

/** macOS notification without a shell; title and text go in as arguments, never as script */
export function notifyDesktop(title, text, run = execFile) {
  if (process.platform !== 'darwin') return;
  run(
    'osascript',
    [
      '-e',
      'on run argv',
      '-e',
      'display notification (item 2 of argv) with title (item 1 of argv)',
      '-e',
      'end run',
      title,
      text,
    ],
    () => {}
  );
}
