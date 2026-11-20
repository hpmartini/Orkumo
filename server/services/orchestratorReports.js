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

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const httpError = (status, message) => Object.assign(new Error(message), { status });

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
    /** Stores a parsed report; returns the new state and its change-log entry */
    submit(report, { now = Date.now(), watch = {} } = {}) {
      const id = report.orchestrator.id;
      const prev = read(id);
      const open = new Set(report.inbox.map((e) => e.id));
      // An answer stays until the orchestrator drops the entry from its report (AC-4)
      const answers = Object.fromEntries(
        Object.entries(prev?.answers || {}).filter(([entry]) => open.has(entry))
      );
      const state = { report, receivedAt: new Date(now).toISOString(), answers, watch };
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
