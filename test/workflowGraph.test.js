import { describe, it, expect } from 'vitest';
import {
  deriveNode,
  graphPath,
  inChain,
  edgeGeometry,
  layoutGraph,
  pipelineType,
} from '../utils/workflowGraph.js';

const state = (over) => ({ stage: 'building', mode: 'default', go: null, ...over });
const run = (mode, ...phases) => ({
  runId: 'r1',
  repoPath: '/r',
  mode,
  pendingApproval: null,
  phases: phases.map((phase) => ({ phase, result: 'ok', at: '' })),
});
const node = (item, st, r = null, status = null) => deriveNode(item, st, r, status);

describe('layoutGraph', () => {
  it('all: four lanes, shared start and end, every edge joins existing nodes', () => {
    const g = layoutGraph('all');
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(new Set(g.nodes.map((n) => n.lane))).toEqual(
      new Set(['shared', 'default', 'orchestrate', 'pipeline', 'image'])
    );
    expect(g.edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true);
    expect(ids.size).toBe(g.nodes.length);
  });

  it('single mode drops the other lanes', () => {
    const g = layoutGraph('orchestrate');
    expect(g.nodes.filter((n) => n.lane !== 'shared' && n.lane !== 'orchestrate')).toEqual([]);
    expect(g.edges.filter((e) => e.back).map((e) => e.label)).toEqual([
      'Fix-Runde',
      'Goal-Schleife',
    ]);
  });
});

describe('edgeGeometry', () => {
  it('forward edges run top to bottom, loops bow out right of the lane', () => {
    const g = layoutGraph('all');
    const ids = new Map(g.nodes.map((n) => [n.id, n]));
    for (const e of g.edges) {
      const { pts } = edgeGeometry(e, ids);
      const [a, b] = [pts[0], pts.at(-1)];
      if (!e.back) expect(a[1]).toBeLessThanOrEqual(b[1]);
      else expect(Math.min(...pts.map((p) => p[0]))).toBeGreaterThanOrEqual(ids.get(e.from).x);
    }
    expect(Math.max(...g.nodes.map((n) => n.x))).toBeLessThan(g.width);
  });
});

describe('graphPath', () => {
  const { edges } = layoutGraph('all');
  it('follows forward edges only', () => {
    expect(graphPath(edges, 'orchestrate.plan', 'orchestrate.gates').map((e) => e.id)).toEqual([
      'orchestrate.plan>orchestrate.build',
      'orchestrate.build>orchestrate.gates',
    ]);
    expect(graphPath(edges, 'orchestrate.review', 'orchestrate.build')).toEqual([]);
  });
});

describe('pipeline types', () => {
  const g = layoutGraph('pipeline');
  const n = (id) => g.nodes.find((x) => x.id === `pipeline.${id}`);
  it('dims stations that are not in the type chain', () => {
    expect(inChain(n('red_repro'), 'bug')).toBe(true);
    expect(inChain(n('red_repro'), 'feature')).toBe(false);
    expect(inChain(n('short_plan'), 'feature')).toBe(false);
    expect(inChain(n('build'), 'chore')).toBe(true);
  });
  it('reads the type from labels, feature by default', () => {
    expect(pipelineType({ labels: [{ name: 'bug' }] })).toBe('bug');
    expect(pipelineType({ labels: [{ name: 'type:hotfix' }] })).toBe('hotfix');
    expect(pipelineType({ labels: [{ name: 'enhancement' }] })).toBe('feature');
  });
});

describe('deriveNode', () => {
  it('shared start and end', () => {
    expect(node({}, state({ stage: 'released' })).id).toBe('go');
    expect(node({}, state({ stage: 'review' })).id).toBe('to_review');
    expect(node({}, state({ stage: 'done' }), null, 'To Deploy').id).toBe('deploy');
    expect(node({}, state({ stage: 'done' }), null, 'Done').id).toBe('ended');
  });

  it('default: interview counts Rückfragen, then GO, then Umsetzung', () => {
    const item = { mwMarkers: [{ kind: 'ask' }, { kind: 'ask' }] };
    expect(node(item, state({ stage: 'briefing' }))).toEqual({
      id: 'default.interview',
      round: 'Rückfrage 2',
    });
    expect(node({}, state({ stage: 'awaiting' })).id).toBe('default.go_build');
    expect(node({}, state({ stage: 'building' })).id).toBe('default.impl');
  });

  it('orchestrate: station from the last trace phase, fix round after a second build', () => {
    const o = state({ mode: 'orchestrate' });
    expect(node({}, o, run('orchestrate', 'plan', 'build', 'gates')).id).toBe('orchestrate.gates');
    expect(node({}, o, run('orchestrate', 'plan', 'build', 'review', 'build', 'review'))).toEqual({
      id: 'orchestrate.review',
      round: 'Fix-Runde 1/2',
    });
    expect(node({}, state({ stage: 'briefing', mode: 'orchestrate' })).id).toBe('orchestrate.plan');
  });

  it('pipeline: pending approval wins, second gates run sits after document', () => {
    const p = state({
      mode: 'pipeline',
      stage: 'awaiting',
      go: { kind: 'approve', stage: 'plan' },
    });
    expect(node({}, p).id).toBe('pipeline.plan_approval');
    const b = state({ mode: 'pipeline' });
    expect(node({}, b, run('pipeline', 'discovery', 'plan', 'build', 'gates')).id).toBe(
      'pipeline.gates'
    );
    expect(node({}, b, run('pipeline', 'build', 'gates', 'document', 'gates')).id).toBe(
      'pipeline.gates2'
    );
    expect(node({}, b, run('pipeline', 'full_review', 'correction', 'delta_review')).id).toBe(
      'pipeline.delta_review'
    );
  });

  it('image has one station', () => {
    expect(node({}, state({ mode: 'image' })).id).toBe('image.images');
  });
});
