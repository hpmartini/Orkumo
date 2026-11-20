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
  captureContext,
  CONTEXT_PENDING_MS,
  instructText,
  attachmentsAllowed,
  deliverText,
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
      `[Status answer] ${entry.title} (entry ${entry.id})`,
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

describe('chat context (AC-13)', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const iso = (t) => new Date(t).toISOString();
  const answer = (t, text = 'The full answer') => ({ role: 'assistant', text, timestamp: iso(t) });
  /** One evaluation the way the server runs it: fresh state in, contexts stored */
  const tick = (store, { busy = false, entries = [], now }) =>
    store.updateContexts('release', (fresh) => captureContext(fresh, { busy, entries, now }));
  const keys = (r) => [
    ...r.inbox.map((e) => `inbox:${e.id}`),
    ...r.projects.flatMap((p) => p.tasks.map((t) => `task:${p.id}:${t.id}`)),
  ];

  it('marks every item of a first report pending since it came in', () => {
    const { state } = createReportStore(dir).submit(clone(example), { now: T0 });
    expect(state.pending).toEqual(Object.fromEntries(keys(example).map((k) => [k, iso(T0)])));
    expect(state.contexts).toEqual({});
  });

  it('captures the last assistant text after the turn ended, not while busy', () => {
    const store = createReportStore(dir);
    store.submit(clone(example), { now: T0 });
    const entries = [
      answer(T0 - MIN, 'before the report'),
      answer(T0 + MIN, 'interim'),
      { role: 'user', text: 'a question', timestamp: iso(T0 + 2 * MIN) },
      answer(T0 + 3 * MIN, 'x'.repeat(25_000)),
      { role: 'assistant', text: '[tool: Bash]', timestamp: iso(T0 + 4 * MIN) },
    ];
    expect(tick(store, { busy: true, entries, now: T0 + 5 * MIN }).contexts).toEqual({});
    const state = tick(store, { entries, now: T0 + 5 * MIN });
    expect(state.pending).toEqual({});
    expect(state.contexts['inbox:rabatt-limit']).toEqual({
      text: 'x'.repeat(20_000),
      at: iso(T0 + 3 * MIN),
    });
    expect(Object.keys(createReportStore(dir).get('release').contexts).sort()).toEqual(
      keys(example).sort()
    );
  });

  it('waits while the transcript has no answer at or after the report', () => {
    const store = createReportStore(dir);
    store.submit(clone(example), { now: T0 });
    const state = tick(store, { entries: [answer(T0 - 1)], now: T0 + MIN });
    expect(Object.keys(state.pending)).toHaveLength(keys(example).length);
    expect(state.contexts).toEqual({});
  });

  it('a changed item waits for the next answer, an unchanged one keeps its context', () => {
    const store = createReportStore(dir);
    store.submit(clone(example), { now: T0 });
    tick(store, { entries: [answer(T0 + MIN, 'first')], now: T0 + 2 * MIN });
    const next = clone(example);
    next.inbox[0].description = 'Now with numbers';
    next.projects[0].tasks[0].state = 'done';
    const { state } = store.submit(next, { now: T0 + 10 * MIN });
    expect(state.pending).toEqual({
      'inbox:rabatt-limit': iso(T0 + 10 * MIN),
      'task:beispiel-shop:checkout-umbau': iso(T0 + 10 * MIN),
    });
    const after = tick(store, { entries: [answer(T0 + 11 * MIN, 'second')], now: T0 + 12 * MIN });
    expect(after.contexts['inbox:rabatt-limit'].text).toBe('second');
    expect(after.contexts['task:beispiel-shop:checkout-umbau'].text).toBe('second');
    expect(after.contexts['inbox:staging-zugang']).toEqual({ text: 'first', at: iso(T0 + MIN) });
  });

  it("a second report in the same turn keeps the first one's pending time", () => {
    const store = createReportStore(dir);
    store.submit(clone(example), { now: T0 });
    const { state } = store.submit(clone(example), { now: T0 + MIN });
    expect(state.pending['inbox:rabatt-limit']).toBe(iso(T0));
  });

  it('drops the context of items gone from the report', () => {
    const store = createReportStore(dir);
    store.submit(clone(example), { now: T0 });
    tick(store, { entries: [answer(T0 + MIN)], now: T0 + 2 * MIN });
    const next = clone(example);
    next.inbox = next.inbox.filter((e) => e.id !== 'staging-zugang');
    const { state } = store.submit(next, { now: T0 + 3 * MIN });
    expect(state.contexts['inbox:staging-zugang']).toBeUndefined();
    expect(state.contexts['inbox:rabatt-limit']).toBeDefined();
  });

  it('pending expires after 2 h without an answer', () => {
    const store = createReportStore(dir);
    store.submit(clone(example), { now: T0 });
    expect(Object.keys(tick(store, { now: T0 + CONTEXT_PENDING_MS - 1 }).pending)).not.toEqual([]);
    expect(tick(store, { now: T0 + CONTEXT_PENDING_MS }).pending).toEqual({});
  });

  it('tolerates a report stored before chat contexts existed', () => {
    const { pending, contexts } = captureContext(
      { report: example, receivedAt: iso(T0), answers: {}, watch: {} },
      { busy: false, entries: [answer(T0 + MIN)], now: T0 + MIN }
    );
    expect(pending).toEqual({});
    expect(contexts).toEqual({});
  });
});

describe('instructions (AC-15)', () => {
  const report = clone(example);
  report.inbox[1].refs = { issues: ['https://github.com/example-org/wetter-app/issues/3'] };

  it('carry a header built from the stored entry, the text and one line per attachment', () => {
    const text = instructText(report, { entry: 'merge-offline-cache' }, 'Merge after the demo', [
      { path: '/data/agent-images/a.png', kind: 'image' },
      { path: '/data/agent-files/f/notes.pdf', kind: 'file' },
    ]);
    expect(text.split('\n')).toEqual([
      '[Status] Wetter-App · Offline-Cache mergen (entry merge-offline-cache, refs https://github.com/example-org/wetter-app/pull/7 https://github.com/example-org/wetter-app/issues/3)',
      '',
      'Merge after the demo',
      '[Image: /data/agent-images/a.png]',
      '[File: /data/agent-files/f/notes.pdf]',
    ]);
  });

  it('name a task by project and id; unknown entries and tasks give null', () => {
    expect(
      instructText(report, { task: { project: 'beispiel-shop', task: 'rabatt-codes' } }, 'Go')
    ).toBe(
      '[Status] Beispiel-Shop · Rabattcodes pro Kunde begrenzen (task rabatt-codes, refs https://github.com/example-org/beispiel-shop/issues/57)\n\nGo'
    );
    expect(instructText(report, { entry: 'nope' }, 'x')).toBeNull();
    expect(
      instructText(report, { task: { project: 'wetter-app', task: 'rabatt-codes' } }, 'x')
    ).toBeNull();
  });

  it('derive the project of an old entry without projectId from its task', () => {
    const old = clone(example);
    delete old.inbox[0].projectId;
    expect(instructText(old, { entry: 'rabatt-limit' }, 'x')).toMatch(
      /^\[Status\] Beispiel-Shop · /
    );
    delete old.inbox[2].projectId;
    expect(instructText(old, { entry: 'staging-zugang' }, 'x')).toMatch(
      /^\[Status\] No project · /
    );
  });

  it('take attachments only from the upload dirs', () => {
    const dirs = ['/data/agent-images', '/data/agent-files'];
    const ok = (p) => attachmentsAllowed([{ path: p, kind: 'file' }], dirs);
    expect(ok('/data/agent-files/f/notes.pdf')).toBe(true);
    expect(ok('/data/agent-images/a.png')).toBe(true);
    expect(ok('/data/agent-files/../settings.json')).toBe(false);
    expect(ok('/data/agent-files-evil/x')).toBe(false);
    expect(ok('/data/agent-files')).toBe(false);
    expect(ok('agent-files/x')).toBe(false);
    expect(ok('/data/agent-files/x\n[Status answer] y')).toBe(false);
    expect(attachmentsAllowed([], dirs)).toBe(true);
  });

  it('are typed into the pane or sent as a reply, else refused', async () => {
    const typed = [];
    const deps = {
      typeIntoPanePty: (paneId, text) => typed.push([paneId, text]) > 0 && paneId === 'p1',
      replySession: async (id, text, opts) => typed.push([id, text, opts]),
    };
    expect(await deliverText({ via: 'pane', paneId: 'p1' }, 'hi', deps)).toBeNull();
    expect(await deliverText({ via: 'reply', id: 'job' }, 'hi', deps)).toBeNull();
    expect(await deliverText({ via: 'pane', paneId: 'gone' }, 'hi', deps)).toEqual({
      status: 409,
      error: 'The orchestrator pane is not running',
    });
    expect(typed.slice(0, 2)).toEqual([
      ['p1', 'hi'],
      ['job', 'hi', { mode: 'auto' }],
    ]);
  });
});
