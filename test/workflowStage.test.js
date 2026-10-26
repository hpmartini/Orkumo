import { describe, it, expect } from 'vitest';
import {
  deriveWorkflowState,
  isWorkflowItem,
  parseMwMarkers,
  phaseGroup,
  sameGo,
  workflowMode,
} from '../utils/workflowStage.js';

const SID = 'b9696574-1525-436d-b809-9d7ebb737e8e';
const comment = (body, createdAt = '2026-10-25T10:00:00Z') => ({ body, createdAt });
const startC = (mode = 'default') =>
  comment(`Abgeholt\n\n<!-- mw-board:start session=${SID} mode=${mode} dynamic=on -->`);
const briefedC = comment(
  'Briefing\n<!-- mw-board:briefed path=briefings/2026-10-25-x.md -->',
  '2026-10-25T11:00:00Z'
);
const goalC = comment('Umsetzung\n\n<!-- mw-board:goal -->', '2026-10-25T12:00:00Z');
const askC = comment('**Rückfrage**\n\n<!-- mw-board:ask -->', '2026-10-25T10:30:00Z');

const item = ({ comments = [], labels = ['mw:go'], state = 'OPEN', prs = [] } = {}) => ({
  state,
  closedAt: state === 'OPEN' ? null : '2026-10-26T09:00:00Z',
  labels: labels.map((name) => ({ name })),
  mwMarkers: parseMwMarkers(comments),
  pullRequests: prs.map((s) => ({ state: s })),
});
const run = (over = {}) => ({
  runId: 'orch-1',
  repoPath: '/repo',
  mode: 'orchestrate',
  phases: [],
  pendingApproval: null,
  ...over,
});

describe('parseMwMarkers', () => {
  it('reads kind, attributes and comment time in order', () => {
    expect(parseMwMarkers([startC(), briefedC])).toEqual([
      {
        kind: 'start',
        attrs: { session: SID, mode: 'default', dynamic: 'on' },
        at: '2026-10-25T10:00:00Z',
      },
      { kind: 'briefed', attrs: { path: 'briefings/2026-10-25-x.md' }, at: '2026-10-25T11:00:00Z' },
    ]);
  });

  it('ignores marker-like text that is no HTML comment', () => {
    expect(parseMwMarkers([comment('see `mw-board:start`-Marker')])).toEqual([]);
  });
});

describe('isWorkflowItem / workflowMode', () => {
  it('released or marked items belong to a workflow', () => {
    expect(isWorkflowItem(item())).toBe(true);
    expect(isWorkflowItem(item({ labels: [], comments: [startC()] }))).toBe(true);
    expect(isWorkflowItem(item({ labels: ['bug'] }))).toBe(false);
  });

  it('mode comes from the start marker, else labels, else the run', () => {
    expect(workflowMode(item({ comments: [startC('pipeline')] }))).toBe('pipeline');
    expect(workflowMode(item({ labels: ['mw:go', 'mw:orchestrate'] }))).toBe('orchestrate');
    expect(workflowMode(item(), run({ mode: 'pipeline' }))).toBe('pipeline');
    expect(workflowMode(item())).toBe('default');
  });
});

describe('deriveWorkflowState', () => {
  it('Todo without marker: released, waits for the poll', () => {
    const s = deriveWorkflowState(item(), 'Todo');
    expect(s).toMatchObject({ stage: 'released', waitingOn: 'poll', go: null });
  });

  it('picked up (start marker): briefing by the agent, session id kept', () => {
    const s = deriveWorkflowState(item({ comments: [startC()] }), 'In Progress');
    expect(s).toMatchObject({ stage: 'briefing', waitingOn: 'agent', sessionId: SID });
  });

  it('orchestrate before any trace: plan is being written', () => {
    const s = deriveWorkflowState(item({ comments: [startC('orchestrate')] }), 'In Progress');
    expect(s).toMatchObject({ stage: 'briefing', mode: 'orchestrate', reason: 'Plan entsteht' });
  });

  it('need-input: briefing, waits on Hape', () => {
    const s = deriveWorkflowState(
      item({ comments: [startC(), askC], labels: ['mw:go', 'need-input'] }),
      'In Progress'
    );
    expect(s).toMatchObject({ stage: 'briefing', waitingOn: 'hape', since: askC.createdAt });
  });

  it('briefed without mw:build: awaiting GO with the build action', () => {
    const s = deriveWorkflowState(item({ comments: [startC(), briefedC] }), 'In Progress');
    expect(s).toMatchObject({
      stage: 'awaiting',
      waitingOn: 'hape',
      go: { kind: 'build' },
      briefingPath: 'briefings/2026-10-25-x.md',
    });
  });

  it('briefed with mw:build set: GO given, waits for the poll, no second GO', () => {
    const s = deriveWorkflowState(
      item({ comments: [startC(), briefedC], labels: ['mw:go', 'mw:build'] }),
      'In Progress'
    );
    expect(s).toMatchObject({ stage: 'awaiting', waitingOn: 'poll', go: null });
  });

  it('goal after the briefing: building', () => {
    const s = deriveWorkflowState(item({ comments: [startC(), briefedC, goalC] }), 'In Progress');
    expect(s).toMatchObject({ stage: 'building', waitingOn: 'agent', since: goalC.createdAt });
  });

  it('a revised briefing after the goal waits for GO again', () => {
    const again = comment(briefedC.body, '2026-10-25T13:00:00Z');
    const s = deriveWorkflowState(
      item({ comments: [startC(), briefedC, goalC, again] }),
      'In Progress'
    );
    expect(s.stage).toBe('awaiting');
  });

  it('run trace: building with the abstract phase of the last trace line', () => {
    const r = run({
      phases: [
        { phase: 'plan', result: 'passed', at: '1' },
        { phase: 'gates', result: 'failed', at: '2' },
      ],
    });
    const s = deriveWorkflowState(item({ comments: [startC('orchestrate')] }), 'In Progress', r);
    expect(s).toMatchObject({ stage: 'building', phase: 'Gates', since: '2' });
  });

  it('pipeline with a pending plan approval: awaiting, GO approves that run', () => {
    const r = run({ mode: 'pipeline', pendingApproval: { stage: 'plan', sha: 'abc' } });
    const s = deriveWorkflowState(item(), 'In Progress', r);
    expect(s).toMatchObject({
      stage: 'awaiting',
      mode: 'pipeline',
      go: { kind: 'approve', runId: 'orch-1', stage: 'plan', sha: 'abc' },
    });
  });

  it('to Review: review; a pending pr approval is the GO', () => {
    expect(deriveWorkflowState(item({ prs: ['OPEN'] }), 'to Review')).toMatchObject({
      stage: 'review',
      go: null,
    });
    const r = run({ pendingApproval: { stage: 'pr', sha: 'def' } });
    expect(deriveWorkflowState(item(), 'to Review', r).go).toMatchObject({ stage: 'pr' });
  });

  it('closed, Done or to Deploy: done', () => {
    expect(deriveWorkflowState(item({ state: 'CLOSED', prs: ['MERGED'] }), 'Done')).toMatchObject({
      stage: 'done',
      reason: 'Gemerged',
      since: '2026-10-26T09:00:00Z',
    });
    expect(deriveWorkflowState(item(), 'to Deploy').reason).toBe('Wartet auf Deploy');
  });
});

describe('phaseGroup / sameGo', () => {
  it('groups trace phases', () => {
    expect(
      ['plan_approval', 'build', 'correction', 'delta_review', 'gates', 'document'].map(phaseGroup)
    ).toEqual(['Plan', 'Build', 'Build', 'Review', 'Gates', 'Doku']);
  });

  it('only the offered GO matches', () => {
    const offered = { kind: 'approve', runId: 'r', stage: 'plan', sha: 'a' };
    expect(sameGo(offered, { ...offered })).toBe(true);
    expect(sameGo(offered, { ...offered, sha: 'b' })).toBe(false);
    expect(sameGo(null, { kind: 'build' })).toBe(false);
    expect(sameGo({ kind: 'build' }, { kind: 'build' })).toBe(true);
  });
});
