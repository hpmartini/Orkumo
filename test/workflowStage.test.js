import { describe, it, expect } from 'vitest';
import {
  ERROR_MARKERS,
  deriveWorkflowState,
  isWorkflowItem,
  parseMwMarkers,
  sameGo,
  workflowMode,
  workflowSwitches,
} from '../utils/workflowStage.js';
import { deriveNode } from '../utils/workflowGraph.js';

const SID = 'b9696574-1525-436d-b809-9d7ebb737e8e';
const comment = (body, createdAt = '2026-10-25T10:00:00Z', login = 'hpmartini') => ({
  body,
  createdAt,
  author: { login },
});
const TRUSTED = ['hpmartini'];
// marker lines as mw 7.0.2 board.py writes them (cf. hpmartini/DevHub#136)
const startC = (mode = 'default', sw = 'dynamic=on delegate=off review=off') =>
  comment(`Abgeholt\n\n<!-- mw-board:start session=${SID} mode=${mode} ${sw} -->`);
const briefedC = comment(
  'Briefing\n<!-- mw-board:briefed path=briefings/2026-10-25-x.md -->',
  '2026-10-25T11:00:00Z'
);
const goalC = comment(
  'Umsetzung mit /goal gestartet.\n\n<!-- mw-board:goal -->',
  '2026-10-25T12:00:00Z'
);
const askC = comment('**Rückfrage**\n\n<!-- mw-board:ask -->', '2026-10-25T10:30:00Z');
const T = (h) => `2026-10-25T${h}:00:00Z`;
const at = (kind, time, text = 'x', attrs = '') =>
  comment(`${text}\n\n<!-- mw-board:${kind}${attrs ? ` ${attrs}` : ''} -->`, time);

const item = ({ comments = [], labels = ['mw:go'], state = 'OPEN', prs = [], subs = 0 } = {}) => ({
  state,
  closedAt: state === 'OPEN' ? null : '2026-10-26T09:00:00Z',
  labels: labels.map((name) => ({ name })),
  mwMarkers: parseMwMarkers(comments, TRUSTED),
  pullRequests: prs.map((s) => ({ state: s })),
  subIssues: { total: subs, completed: 0 },
});

describe('parseMwMarkers', () => {
  it('reads kind, attributes and comment time in order', () => {
    expect(parseMwMarkers([startC(), briefedC], TRUSTED)).toEqual([
      {
        kind: 'start',
        attrs: { session: SID, mode: 'default', dynamic: 'on', delegate: 'off', review: 'off' },
        at: '2026-10-25T10:00:00Z',
      },
      { kind: 'briefed', attrs: { path: 'briefings/2026-10-25-x.md' }, at: '2026-10-25T11:00:00Z' },
    ]);
  });

  it('ignores marker-like text that is no HTML comment', () => {
    expect(parseMwMarkers([comment('see `mw-board:start`-Marker')], TRUSTED)).toEqual([]);
  });

  it('ignores markers written by anyone but the trusted authors', () => {
    const forged = comment(startC().body, '2026-10-25T10:00:00Z', 'mallory');
    expect(parseMwMarkers([forged], TRUSTED)).toEqual([]);
  });

  it('error markers keep the comment text as note', () => {
    const [m] = parseMwMarkers([at('noclone', T(10), 'Kein Klon von o/r')], TRUSTED);
    expect(m).toMatchObject({ kind: 'noclone', note: 'Kein Klon von o/r' });
  });
});

describe('isWorkflowItem / workflowMode / workflowSwitches', () => {
  it('released or marked items belong to a workflow', () => {
    expect(isWorkflowItem(item())).toBe(true);
    expect(isWorkflowItem(item({ labels: [], comments: [startC()] }))).toBe(true);
    expect(isWorkflowItem(item({ labels: ['bug'] }))).toBe(false);
  });

  it('a parent with sub-issues is no run of its own', () => {
    expect(isWorkflowItem(item({ subs: 2 }))).toBe(false);
  });

  it('mode: image from the start marker or the label, everything else default', () => {
    expect(workflowMode(item({ comments: [startC('image')] }))).toBe('image');
    expect(workflowMode(item({ labels: ['mw:go', 'mw:image'] }))).toBe('image');
    expect(workflowMode(item())).toBe('default');
    // legacy mw 6 runs follow the default track (#136)
    expect(workflowMode(item({ comments: [startC('pipeline')] }))).toBe('default');
    expect(workflowMode(item({ labels: ['mw:go', 'mw:orchestrate'] }))).toBe('default');
  });

  it('switches: start marker wins, else labels; dynamic is on by default', () => {
    const started = item({ comments: [startC('default', 'dynamic=off delegate=on review=on')] });
    expect(workflowSwitches(started)).toEqual({
      dynamic: false,
      delegate: true,
      review: true,
      model: null,
      effort: null,
    });
    expect(
      workflowSwitches(item({ labels: ['mw:go', 'mw:review', 'model:sonnet', 'effort:high'] }))
    ).toEqual({ dynamic: true, delegate: false, review: true, model: 'sonnet', effort: 'high' });
  });
});

describe('deriveWorkflowState', () => {
  it('Todo without marker: released, waits for the poll, offers to start it now', () => {
    const s = deriveWorkflowState(item(), 'Todo');
    expect(s).toMatchObject({ stage: 'released', waitingOn: 'poll', go: { kind: 'poll' } });
  });

  it('picked up (start marker): briefing by the agent, session id kept', () => {
    const s = deriveWorkflowState(item({ comments: [startC()] }), 'In Progress');
    expect(s).toMatchObject({ stage: 'briefing', waitingOn: 'agent', sessionId: SID });
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

  it('briefed with mw:build set: GO given, waits for the poll, offers to start it now', () => {
    const s = deriveWorkflowState(
      item({ comments: [startC(), briefedC], labels: ['mw:go', 'mw:build'] }),
      'In Progress'
    );
    expect(s).toMatchObject({ stage: 'awaiting', waitingOn: 'poll', go: { kind: 'poll' } });
  });

  it('only states waiting on the poll offer the poll GO', () => {
    const others = [
      [item({ comments: [startC()] }), 'In Progress'],
      [item({ comments: [startC(), askC], labels: ['mw:go', 'need-input'] }), 'In Progress'],
      [item({ comments: [startC(), briefedC] }), 'In Progress'],
      [item({ comments: [startC(), briefedC, goalC] }), 'In Progress'],
      [item({ comments: [startC(), briefedC, goalC] }), 'to Review'],
      [item({ state: 'CLOSED' }), 'Done'],
    ];
    for (const [i, status] of others) {
      const s = deriveWorkflowState(i, status);
      expect(s.waitingOn).not.toBe('poll');
      expect(s.go?.kind).not.toBe('poll');
    }
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

  it('to Review: review, waits on Hape, no GO', () => {
    const s = deriveWorkflowState(
      item({ comments: [startC(), briefedC, goalC], prs: ['OPEN'] }),
      'to Review'
    );
    expect(s).toMatchObject({ stage: 'review', waitingOn: 'hape', go: null });
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

describe('sameGo', () => {
  it('only the offered GO matches', () => {
    expect(sameGo(null, { kind: 'build' })).toBe(false);
    expect(sameGo({ kind: 'build' }, { kind: 'build' })).toBe(true);
    expect(sameGo({ kind: 'poll' }, { kind: 'poll' })).toBe(true);
    expect(sameGo(null, { kind: 'poll' })).toBe(false);
    expect(sameGo({ kind: 'build' }, { kind: 'poll' })).toBe(false);
  });
});

// #136 AC-1: every mw 7 picture (column x markers x need-input/mw:build) -> one stage and station
describe('mw 7 stations (AC-1)', () => {
  const done = { prs: ['MERGED'], state: 'CLOSED' };
  const cases = [
    ['released', item(), 'Todo', 'released', 'go'],
    ['start', item({ comments: [startC()] }), 'In Progress', 'briefing', 'default.interview'],
    [
      'ask + need-input',
      item({ comments: [startC(), askC], labels: ['mw:go', 'need-input'] }),
      'In Progress',
      'briefing',
      'default.interview',
    ],
    [
      'ask answered (resumed)',
      item({ comments: [startC(), askC, at('resumed', T(10), 'Antwort', `upto=${T(10)}`)] }),
      'In Progress',
      'briefing',
      'default.interview',
    ],
    [
      'briefed without mw:build',
      item({ comments: [startC(), briefedC] }),
      'In Progress',
      'awaiting',
      'default.go_build',
    ],
    [
      'briefed with mw:build',
      item({ comments: [startC(), briefedC], labels: ['mw:go', 'mw:build'] }),
      'In Progress',
      'awaiting',
      'default.go_build',
    ],
    [
      'fed after briefed',
      item({ comments: [startC(), briefedC, at('fed', T(13), 'Rückmeldung', `upto=${T(13)}`)] }),
      'In Progress',
      'briefing',
      'default.contract',
    ],
    [
      'resumed after briefed',
      item({ comments: [startC(), briefedC, at('resumed', T(13), 'Antwort', `upto=${T(13)}`)] }),
      'In Progress',
      'briefing',
      'default.contract',
    ],
    [
      'fed, then a new briefing',
      item({
        comments: [startC(), briefedC, at('fed', T(13)), at('briefed', T(14), 'B2', 'path=b2.md')],
      }),
      'In Progress',
      'awaiting',
      'default.go_build',
    ],
    [
      'goal',
      item({ comments: [startC(), briefedC, goalC] }),
      'In Progress',
      'building',
      'default.impl',
    ],
    [
      'review / to Review',
      item({ comments: [startC(), briefedC, goalC, at('review', T(15))], prs: ['OPEN'] }),
      'to Review',
      'review',
      'to_review',
    ],
    [
      'merged, to Deploy',
      item({ comments: [startC(), briefedC, goalC], prs: ['MERGED'] }),
      'to Deploy',
      'done',
      'deploy',
    ],
    [
      'merged, Done',
      item({ comments: [startC(), briefedC, goalC], ...done }),
      'Done',
      'done',
      'deploy',
    ],
    [
      'wrap',
      item({ comments: [startC(), briefedC, goalC, at('wrap', T(16))], ...done }),
      'Done',
      'done',
      'wrapup',
    ],
    [
      'removed',
      item({
        comments: [startC(), briefedC, goalC, at('wrap', T(16)), at('removed', T(17))],
        ...done,
      }),
      'Done',
      'done',
      'ended',
    ],
    ['image', item({ comments: [startC('image')] }), 'In Progress', 'briefing', 'image.images'],
    [
      'legacy pipeline start',
      item({ comments: [startC('pipeline')] }),
      'In Progress',
      'briefing',
      'default.interview',
    ],
  ];
  it.each(cases)('%s', (_, i, status, stage, nodeId) => {
    const s = deriveWorkflowState(i, status);
    expect(s.stage).toBe(stage);
    expect(deriveNode(i, s).id).toBe(nodeId);
  });

  it('real #136 markers (start, ask, resumed, briefed, goal) land on Umsetzung', () => {
    const real = [
      comment(
        '<!-- mw-board:start session=2d42ba01-a1db-46fa-9608-bc757ead673a mode=default dynamic=on delegate=off review=off -->',
        '2026-10-28T19:28:26Z'
      ),
      comment('**Rückfrage**\n\n<!-- mw-board:ask -->', '2026-10-28T19:34:32Z'),
      comment('1', '2026-10-29T17:02:58Z'),
      comment(
        'Antwort an die Session übergeben.\n\n<!-- mw-board:resumed upto=2026-10-29T17:02:58Z -->',
        '2026-10-29T17:40:43Z'
      ),
      comment(
        '<!-- mw-board:briefed path=briefings/2026-10-29-workflow-mw7.md -->',
        '2026-10-29T17:43:42Z'
      ),
      comment('<!-- mw-board:goal -->', '2026-10-31T00:45:36Z'),
    ];
    const i = item({ comments: real, labels: ['mw:go', 'mw:build'] });
    const s = deriveWorkflowState(i, 'In Progress');
    expect(s).toMatchObject({
      stage: 'building',
      briefingPath: 'briefings/2026-10-29-workflow-mw7.md',
    });
    expect(deriveNode(i, s)).toEqual({ id: 'default.impl', round: null });
    // the same issue one step earlier: the contract waits for GO
    expect(deriveWorkflowState(item({ comments: real.slice(0, 5) }), 'In Progress').go).toEqual({
      kind: 'build',
    });
  });

  it('feedback rounds count on the contract station', () => {
    const i = item({
      comments: [
        startC(),
        briefedC,
        at('fed', T(13)),
        at('briefed', T(14), 'B', 'path=b.md'),
        at('fed', T(15)),
      ],
    });
    expect(deriveNode(i, deriveWorkflowState(i, 'In Progress'))).toEqual({
      id: 'default.contract',
      round: 'Runde 3',
    });
  });
});

// #136 AC-2: error markers are a visible error with mw's reason; only trusted authors count
describe('error markers (AC-2)', () => {
  it.each(Object.keys(ERROR_MARKERS))('%s: error state with label and reason, no GO', (kind) => {
    const reason = `mw board: ${kind} weil xyz`;
    const s = deriveWorkflowState(
      item({ comments: [startC(), at(kind, T(11), reason)] }),
      'In Progress'
    );
    expect(s.error).toEqual({ kind, label: ERROR_MARKERS[kind], note: reason, at: T(11) });
    expect(s).toMatchObject({ waitingOn: 'hape', reason: ERROR_MARKERS[kind], go: null });
  });

  it('invalid before any start (Todo) is shown, not offered as poll GO', () => {
    const bad = at('invalid', T('09'), 'mw:pipeline gibt es seit mw 7 nicht mehr');
    const s = deriveWorkflowState(item({ comments: [bad] }), 'Todo');
    expect(s).toMatchObject({ stage: 'released', go: null });
    expect(s.error?.note).toMatch(/mw:pipeline/);
  });

  it('a later marker clears the error (retry worked)', () => {
    const s = deriveWorkflowState(
      item({ comments: [at('fail', T('09')), startC()] }),
      'In Progress'
    );
    expect(s.error).toBeNull();
    expect(s.stage).toBe('briefing');
  });

  it('error markers by a foreign author are ignored', () => {
    const forged = comment('<!-- mw-board:fail -->', T(11), 'mallory');
    const s = deriveWorkflowState(item({ comments: [startC(), forged] }), 'In Progress');
    expect(s.error).toBeNull();
    expect(s.waitingOn).toBe('agent');
  });
});
