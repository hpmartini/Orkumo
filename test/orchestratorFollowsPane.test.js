// An orchestrator's identity follows its pane through /clear, /new and /resume (C4)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createPaneFollower } from '../server/services/orchestratorService.js';
import { createThreadStore } from '../server/services/orchestratorThreads.js';
import { createReportStore } from '../server/services/orchestratorReports.js';

let dir;
let settings;
let threads;
let reports;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'follow-'));
  settings = { orchestrators: [], orchestratorRoles: {} };
  threads = createThreadStore(dir);
  reports = createReportStore(dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const follower = () =>
  createPaneFollower({
    file: path.join(dir, 'panes.json'),
    getSettings: () => settings,
    setSettings: (partial) => {
      settings = { ...settings, ...partial };
    },
    threads,
    reports,
  });

const claudeRow = (paneId, sessionId, pid, extra = {}) => ({
  id: `interactive-${pid}`,
  sessionId,
  kind: 'interactive',
  paneId,
  pid,
  cwd: '/ws',
  state: null,
  ...extra,
});
const ompRow = (paneId, sessionId, pid, extra = {}) => ({
  id: `omp-${sessionId}`,
  sessionId,
  kind: 'interactive',
  paneId,
  pid,
  cwd: '/ws',
  state: null,
  ...extra,
});

const thread = (owner, task) =>
  threads.create(owner, { name: { project: 'Shop', task }, agents: ['worker-1'] });
const report = (id, agentId) => ({
  version: 1,
  orchestrator: { id, agentId, name: id },
  summary: 's',
  projects: [],
  inbox: [],
});
const submit = (id, agentId) => reports.submit(report(id, agentId));

describe('pane P: session A -> session B', () => {
  it('Claude /clear: mark, role, threads and role report move to the new session', () => {
    settings = { orchestrators: ['uuid-A', 'uuid-Q'], orchestratorRoles: { 'uuid-A': 'ceo' } };
    thread('uuid-A', 'Launch');
    thread('uuid-Q', 'Other');
    submit('ceo', 'uuid-A');
    const f = follower();
    f.observe([claudeRow('P', 'uuid-A', 7), claudeRow('Q', 'uuid-Q', 8)], new Set(['P', 'Q']));

    // /clear: same process, same row id, new transcript uuid
    f.observe([claudeRow('P', 'uuid-B', 7), claudeRow('Q', 'uuid-Q', 8)], new Set(['P', 'Q']));

    expect(settings.orchestrators).toContain('uuid-B');
    expect(settings.orchestrators).not.toContain('uuid-A');
    expect(settings.orchestratorRoles).toEqual({ 'uuid-B': 'ceo' });
    expect(threads.list('uuid-B').map((t) => t.name.task)).toEqual(['Launch']);
    expect(fs.existsSync(path.join(dir, 'threads', 'uuid-A.json'))).toBe(false);
    // the report is keyed by the role: it stays and still finds the session
    expect(reports.get('ceo')).not.toBeNull();
    // the other pane is untouched
    expect(settings.orchestrators).toContain('uuid-Q');
    expect(threads.list('uuid-Q').map((t) => t.name.task)).toEqual(['Other']);
  });

  it('omp /new: a roleless row-keyed report and the threads follow the new row id', () => {
    settings = { orchestrators: ['omp-A'], orchestratorRoles: {} };
    thread('omp-A', 'Plan');
    submit('omp-A', 'omp-A');
    const f = follower();
    f.observe([ompRow('P', 'A', 55)], new Set(['P']));
    f.observe([ompRow('P', 'B', 55)], new Set(['P']));

    expect(reports.get('omp-A')).toBeNull();
    const moved = reports.get('omp-B');
    expect(moved.report.orchestrator).toMatchObject({ id: 'omp-B', agentId: 'omp-B' });
    expect(threads.list('omp-B')).toHaveLength(1);
    expect(threads.list('omp-A')).toHaveLength(0);
    expect(settings.orchestrators).toEqual(['B']);
  });

  it('merges into threads the new session already has; none is lost or doubled', () => {
    settings = { orchestrators: ['uuid-A'], orchestratorRoles: {} };
    thread('uuid-A', 'Old');
    thread('uuid-B', 'New');
    const f = follower();
    f.observe([claudeRow('P', 'uuid-A', 7)], new Set(['P']));
    f.observe([claudeRow('P', 'uuid-B', 7)], new Set(['P']));
    expect(
      threads
        .list('uuid-B')
        .map((t) => t.name.task)
        .sort()
    ).toEqual(['New', 'Old']);
    expect(fs.existsSync(path.join(dir, 'threads', 'uuid-A.json'))).toBe(false);
  });

  it('a mark keyed by the pane id keeps working and is not rewritten', () => {
    settings = { orchestrators: ['P'], orchestratorRoles: { P: 'ceo' } };
    const f = follower();
    f.observe([claudeRow('P', 'uuid-A', 7)], new Set(['P']));
    f.observe([claudeRow('P', 'uuid-B', 7)], new Set(['P']));
    expect(settings.orchestrators).toEqual(['P']);
    expect(settings.orchestratorRoles).toEqual({ P: 'ceo' });
  });

  it('a gap with no row (omp has not written the new session yet) moves nothing, then follows', () => {
    settings = { orchestrators: ['A'], orchestratorRoles: {} };
    const f = follower();
    f.observe([ompRow('P', 'A', 55)], new Set(['P']));
    f.observe([], new Set(['P']));
    expect(settings.orchestrators).toEqual(['A']);
    f.observe([ompRow('P', 'B', 55)], new Set(['P']));
    expect(settings.orchestrators).toEqual(['B']);
  });

  it('seen again after a server restart: the file carries the last known session', () => {
    settings = { orchestrators: ['uuid-A'], orchestratorRoles: { 'uuid-A': 'ceo' } };
    thread('uuid-A', 'Launch');
    follower().observe([claudeRow('P', 'uuid-A', 7)], new Set(['P']));
    // the agent kept running in its holder while the server was down and cleared meanwhile
    follower().observe([claudeRow('P', 'uuid-B', 7)], new Set(['P']));
    expect(settings.orchestratorRoles).toEqual({ 'uuid-B': 'ceo' });
    expect(threads.list('uuid-B')).toHaveLength(1);
  });
});

describe('nothing moves for an unrelated session', () => {
  const setup = () => {
    settings = { orchestrators: ['uuid-A'], orchestratorRoles: { 'uuid-A': 'ceo' } };
    thread('uuid-A', 'Launch');
    return follower();
  };
  const untouched = () => {
    expect(settings.orchestrators).toEqual(['uuid-A']);
    expect(settings.orchestratorRoles).toEqual({ 'uuid-A': 'ceo' });
    expect(threads.list('uuid-A')).toHaveLength(1);
    expect(threads.list('uuid-Z')).toHaveLength(0);
  };

  it('pane closed, its id reused by a new process in the same refresh gap', () => {
    const f = setup();
    f.observe([claudeRow('P', 'uuid-A', 7)], new Set(['P']));
    f.observe([claudeRow('P', 'uuid-Z', 99)], new Set(['P'])); // other pid: other process
    untouched();
  });

  it('pane closed (no PTY), later reused', () => {
    const f = setup();
    f.observe([claudeRow('P', 'uuid-A', 7)], new Set(['P']));
    f.observe([], new Set()); // closed
    f.observe([claudeRow('P', 'uuid-Z', 7)], new Set(['P'])); // even the same pid number
    untouched();
  });

  it('an unmarked session in a pane is never tracked', () => {
    const f = setup();
    f.observe([claudeRow('R', 'uuid-X', 5)], new Set(['R']));
    f.observe([claudeRow('R', 'uuid-Z', 5)], new Set(['R']));
    untouched();
  });

  it('a finished row of the pane is no switch', () => {
    const f = setup();
    f.observe([claudeRow('P', 'uuid-A', 7)], new Set(['P']));
    f.observe([claudeRow('P', 'uuid-Z', 7, { state: 'done' })], new Set(['P']));
    untouched();
  });
});
