import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  STALE_AFTER_MS,
  authorizeReporter,
  createReportStore,
  isStale,
  newDecisionIds,
  reportEvents,
  evaluateReport,
  answerTarget,
  answerText,
  submitWatch,
  isHiddenReport,
} from '../server/services/orchestratorReports.js';
import example from '../server/orchestrator/report.example.json';

const clone = (o) => JSON.parse(JSON.stringify(o));
const T0 = Date.parse('2026-11-20T10:00:00Z');
const MIN = 60_000;

describe('isStale (AC-5)', () => {
  const reportedAt = T0;
  it('never stale without an event, however long', () => {
    expect(isStale({ reportedAt, events: [], now: T0 + 12 * 60 * MIN })).toBe(false);
  });
  it('not stale 29:59 after the first event', () => {
    const events = [T0 + 5 * MIN];
    expect(isStale({ reportedAt, events, now: T0 + 5 * MIN + 30 * MIN - 1000 })).toBe(false);
  });
  it('stale exactly 30:00 after the first event', () => {
    const events = [T0 + 5 * MIN];
    expect(isStale({ reportedAt, events, now: T0 + 5 * MIN + STALE_AFTER_MS })).toBe(true);
  });
  it('counts from the first event after the report', () => {
    const events = [T0 + 40 * MIN, T0 + 5 * MIN];
    expect(isStale({ reportedAt, events, now: T0 + 35 * MIN })).toBe(true);
  });
  it('ignores events before the report', () => {
    expect(isStale({ reportedAt, events: [T0 - MIN], now: T0 + 12 * 60 * MIN })).toBe(false);
  });
});

describe('newDecisionIds (AC-6)', () => {
  const base = clone(example);
  it('a new decision triggers', () => {
    expect(newDecisionIds(null, base)).toEqual(['rabatt-limit']);
  });
  it('the same decision reported again does not', () => {
    expect(newDecisionIds(base, clone(base))).toEqual([]);
  });
  it('a new todo or approval or a task change does not', () => {
    const next = clone(base);
    next.inbox.push(
      { id: 'n-todo', kind: 'todo', title: 'x', createdAt: base.reportedAt },
      {
        id: 'n-appr',
        kind: 'approval',
        title: 'y',
        createdAt: base.reportedAt,
        pr: 'https://github.com/example-org/a/pull/1',
      }
    );
    next.projects[0].tasks[0].state = 'done';
    expect(newDecisionIds(base, next)).toEqual([]);
  });
});

describe('authorizeReporter (AC-3)', () => {
  const settings = {
    orchestrators: ['agent-a', 'agent-b'],
    orchestratorRoles: { 'agent-a': 'release' },
  };
  const sessions = [
    { id: 'agent-a', sessionId: 's-a', paneId: 'p-a' },
    { id: 'agent-b', sessionId: 's-b', paneId: 'p-b' },
    { id: 'agent-c', sessionId: 's-c', paneId: 'p-c' },
  ];
  it('accepts its own role id', () => {
    expect(authorizeReporter('release', 'agent-a', sessions, settings)).toEqual({
      ok: true,
      session: sessions[0],
    });
  });
  it('accepts the agent id when the session has no role', () => {
    expect(authorizeReporter('agent-b', 's-b', sessions, settings).ok).toBe(true);
  });
  it('rejects a foreign orchestrator id', () => {
    expect(authorizeReporter('release', 'agent-b', sessions, settings)).toMatchObject({
      ok: false,
      status: 403,
    });
  });
  it('rejects a session that is not an orchestrator', () => {
    expect(authorizeReporter('agent-c', 'agent-c', sessions, settings)).toMatchObject({
      ok: false,
      status: 403,
    });
  });
  it('rejects an unknown or missing sender', () => {
    expect(authorizeReporter('release', 'nope', sessions, settings)).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(authorizeReporter('release', null, sessions, settings)).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});

describe('report store', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('keeps the latest report per orchestrator across instances and logs changes', () => {
    const a = createReportStore(dir);
    const first = a.submit(clone(example), { now: T0 });
    expect(first.change).toMatchObject({ orchestrator: 'release', notify: ['rabatt-limit'] });
    const next = clone(example);
    next.inbox = next.inbox.filter((e) => e.id !== 'merge-offline-cache');
    next.projects[0].tasks[0].state = 'done';
    a.submit(next, { now: T0 + MIN });

    const b = createReportStore(dir); // a fresh instance reads what the first one wrote
    const [state] = b.list();
    expect(state.report.inbox.map((e) => e.id)).not.toContain('merge-offline-cache');
    const log = b.changes();
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({ closed: ['merge-offline-cache'], notify: [] });
    expect(log[1].tasks).toEqual([
      {
        project: next.projects[0].id,
        task: next.projects[0].tasks[0].id,
        from: example.projects[0].tasks[0].state,
        to: 'done',
      },
    ]);
  });

  it('skips a change log line cut off by a crash', () => {
    const s = createReportStore(dir);
    s.submit(clone(example), { now: T0 });
    fs.appendFileSync(path.join(dir, 'changes.jsonl'), '{"at":"2026-');
    expect(s.changes()).toHaveLength(1);
  });

  it('an answer stays until the next report drops the entry (AC-4)', () => {
    const s = createReportStore(dir);
    s.submit(clone(example), { now: T0 });
    s.answer(
      'release',
      'rabatt-limit',
      { text: 'Once per customer', option: 'once' },
      { now: T0 + MIN }
    );
    s.submit(clone(example), { now: T0 + 2 * MIN });
    expect(createReportStore(dir).list()[0].answers['rabatt-limit']).toMatchObject({
      text: 'Once per customer',
    });
    const closing = clone(example);
    closing.inbox = closing.inbox.filter((e) => e.id !== 'rabatt-limit');
    s.submit(closing, { now: T0 + 3 * MIN });
    expect(createReportStore(dir).list()[0].answers).toEqual({});
  });

  it('refuses an answer to an unknown entry', () => {
    const s = createReportStore(dir);
    s.submit(clone(example), { now: T0 });
    expect(() => s.answer('release', 'nope', { text: 'x' })).toThrow(/No open entry/);
    expect(() => s.answer('other', 'rabatt-limit', { text: 'x' })).toThrow(/No report/);
  });
});

describe('reportEvents (AC-5 adapter)', () => {
  const iso = (t) => new Date(t).toISOString();
  const report = {
    orchestrator: { id: 'release' },
    projects: [
      {
        id: 'p',
        name: 'P',
        tasks: [{ id: 't', title: 'T', state: 'running', refs: { agents: ['w1'] } }],
      },
    ],
    inbox: [],
  };
  const state = (watch = {}) => ({ report, receivedAt: iso(T0), watch });
  const worker = (displayState, at, prs = []) => ({
    id: 'w1',
    displayState,
    lastActivity: iso(at),
    prs,
  });
  const self = (displayState, at) => ({
    id: 'o1',
    role: 'release',
    displayState,
    lastActivity: iso(at),
  });

  it('a referenced worker that finished after the report is an event', () => {
    const { events } = reportEvents(state(), [worker('idle', T0 + 5 * MIN)], T0 + 6 * MIN);
    expect(events).toEqual([T0 + 5 * MIN]);
  });
  it('a worker still busy or idle since before the report is none', () => {
    expect(reportEvents(state(), [worker('working', T0 + 5 * MIN)]).events).toEqual([]);
    expect(reportEvents(state(), [worker('idle', T0 - MIN)]).events).toEqual([]);
  });
  it('a PR turning ready counts from when it was first seen; ready at submit does not', () => {
    const pr = [{ url: 'https://github.com/example-org/a/pull/1', state: 'ready' }];
    const seen = reportEvents(state(), [worker('working', T0, pr)], T0 + 7 * MIN);
    expect(seen.events).toEqual([T0 + 7 * MIN]);
    expect(
      reportEvents(state(seen.watch), [worker('working', T0, pr)], T0 + 9 * MIN).events
    ).toEqual([T0 + 7 * MIN]);
    const base = submitWatch(report, [worker('working', T0, pr)], T0);
    expect(reportEvents(state(base), [worker('working', T0, pr)], T0 + 9 * MIN).events).toEqual([
      T0,
    ]);
  });
  it('the reporting turn ending is no event, a later turn ending is', () => {
    const first = reportEvents(state(), [self('idle', T0 + MIN)], T0 + 2 * MIN);
    expect(first.events).toEqual([]);
    expect(
      reportEvents(state(first.watch), [self('idle', T0 + MIN)], T0 + 50 * MIN).events
    ).toEqual([]);
    expect(reportEvents(state(first.watch), [self('working', T0 + 20 * MIN)]).events).toEqual([]);
    expect(reportEvents(state(first.watch), [self('idle', T0 + 22 * MIN)]).events).toEqual([
      T0 + 22 * MIN,
    ]);
  });
});

describe('evaluateReport (latch and persistence)', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const iso = (t) => new Date(t).toISOString();
  const report = () => {
    const r = clone(example);
    r.projects[0].tasks[0].refs = { agents: ['w1'] };
    return r;
  };
  /** One evaluation the way the server runs it: read, evaluate, persist when changed */
  const tick = (store, agents, now) => {
    const state = store.list()[0];
    const result = evaluateReport(state, agents, now);
    if (result.changed) store.setWatch(state.report.orchestrator.id, result.watch);
    return result;
  };

  it('a PR turning ready keeps its first-seen time across evaluations', () => {
    const store = createReportStore(dir);
    store.submit(report(), { now: T0 });
    const pr = [{ url: 'https://github.com/example-org/a/pull/1', state: 'ready' }];
    const agents = [{ id: 'w1', displayState: 'working', lastActivity: iso(T0), prs: pr }];
    expect(tick(store, agents, T0 + 5 * MIN).stale).toBe(false);
    expect(tick(store, agents, T0 + 20 * MIN).stale).toBe(false);
    expect(tick(store, agents, T0 + 35 * MIN)).toMatchObject({
      stale: true,
      firstEventAt: iso(T0 + 5 * MIN),
    });
  });

  it('the 30 minutes do not restart when the worker runs again', () => {
    const store = createReportStore(dir);
    store.submit(report(), { now: T0 });
    tick(
      store,
      [{ id: 'w1', displayState: 'idle', lastActivity: iso(T0 + 5 * MIN) }],
      T0 + 6 * MIN
    );
    tick(
      store,
      [{ id: 'w1', displayState: 'working', lastActivity: iso(T0 + 20 * MIN) }],
      T0 + 20 * MIN
    );
    const late = tick(
      store,
      [{ id: 'w1', displayState: 'idle', lastActivity: iso(T0 + 30 * MIN) }],
      T0 + 35 * MIN
    );
    expect(late).toMatchObject({ stale: true, firstEventAt: iso(T0 + 5 * MIN) });
  });

  it('a new report resets the clock', () => {
    const store = createReportStore(dir);
    store.submit(report(), { now: T0 });
    tick(
      store,
      [{ id: 'w1', displayState: 'idle', lastActivity: iso(T0 + 5 * MIN) }],
      T0 + 6 * MIN
    );
    store.submit(report(), { now: T0 + 10 * MIN });
    expect(
      tick(
        store,
        [{ id: 'w1', displayState: 'idle', lastActivity: iso(T0 + 5 * MIN) }],
        T0 + 50 * MIN
      ).stale
    ).toBe(false);
  });
});

describe('answers (AC-4)', () => {
  it('go the way orkumo send goes: job by reply, else pane, else nowhere', () => {
    expect(answerTarget({ id: 'j', kind: 'background', paneId: 'p' })).toEqual({
      via: 'reply',
      id: 'j',
    });
    expect(answerTarget({ id: 'i', kind: 'interactive', paneId: 'p' })).toEqual({
      via: 'pane',
      paneId: 'p',
    });
    expect(answerTarget({ id: 'i', kind: 'interactive', paneId: null })).toBeNull();
    expect(answerTarget(null)).toBeNull();
  });
  it('name the entry, the choice and the free text', () => {
    const entry = example.inbox.find((e) => e.kind === 'decision');
    const text = answerText(entry, entry.options[0], 'and ship it');
    expect(text.split('\n')).toEqual([
      `[Status answer from Hape] ${entry.title} (entry ${entry.id})`,
      `Choice: ${entry.options[0].label} (${entry.options[0].id})`,
      'and ship it',
    ]);
  });
});

describe('isHiddenReport (roleless orchestrators after their session)', () => {
  const H = 60 * MIN;
  const state = (id, receivedAt = T0) => ({
    report: { orchestrator: { id, agentId: id } },
    receivedAt: new Date(receivedAt).toISOString(),
  });
  const live = [{ id: 'omp-1', state: 'running' }];
  const ended = [{ id: 'omp-1', state: 'done' }];
  const roles = new Set(['release']);

  it('never hides a role orchestrator, however old', () => {
    expect(
      isHiddenReport(state('release'), { roleIds: roles, sessions: [], now: T0 + 48 * H })
    ).toBe(false);
  });
  it('keeps a roleless orchestrator while its session runs', () => {
    expect(
      isHiddenReport(state('omp-1'), { roleIds: roles, sessions: live, now: T0 + 48 * H })
    ).toBe(false);
  });
  it('hides it once the session ended and 24 h passed without a report', () => {
    const at = (now, sessions) => isHiddenReport(state('omp-1'), { roleIds: roles, sessions, now });
    expect(at(T0 + 24 * H - 1, ended)).toBe(false);
    expect(at(T0 + 24 * H, ended)).toBe(true);
    expect(at(T0 + 24 * H, [])).toBe(true);
  });
});
