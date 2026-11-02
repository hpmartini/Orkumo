import { describe, it, expect } from 'vitest';
import {
  GRAPH_MODES,
  deriveNode,
  graphPath,
  edgeGeometry,
  layoutGraph,
} from '../utils/workflowGraph.js';

const state = (over) => ({ stage: 'building', mode: 'default', go: null, ...over });

describe('layoutGraph', () => {
  it('#136 AC-3: lanes Standard and Bild only, shared start and end, edges join nodes', () => {
    const g = layoutGraph('all');
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(GRAPH_MODES).toEqual(['default', 'image']);
    expect(new Set(g.nodes.map((n) => n.lane))).toEqual(new Set(['shared', 'default', 'image']));
    expect(g.edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true);
    expect(ids.size).toBe(g.nodes.length);
  });

  it('#136 AC-3: mw 7 stations and loops of the default track', () => {
    const g = layoutGraph('default');
    expect(g.nodes.map((n) => n.id).sort()).toEqual(
      [
        'go',
        'picked',
        'default.interview',
        'default.contract',
        'default.go_build',
        'default.impl',
        'pr',
        'to_review',
        'merge',
        'deploy',
        'wrapup',
        'ended',
      ].sort()
    );
    expect(g.edges.filter((e) => e.back).map((e) => [e.from, e.to, e.label])).toEqual([
      ['default.interview', 'default.interview', 'Rückfrage'],
      ['default.go_build', 'default.contract', 'Rückmeldung'],
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
    expect(graphPath(edges, 'default.contract', 'default.impl').map((e) => e.id)).toEqual([
      'default.contract>default.go_build',
      'default.go_build>default.impl',
    ]);
    expect(graphPath(edges, 'default.impl', 'default.contract')).toEqual([]);
  });
});

describe('deriveNode', () => {
  it('shared start and end, Abschluss inside Fertig', () => {
    expect(deriveNode({}, state({ stage: 'released' })).id).toBe('go');
    expect(deriveNode({}, state({ stage: 'review' })).id).toBe('to_review');
    expect(deriveNode({}, state({ stage: 'done' })).id).toBe('deploy');
    const wrap = { mwMarkers: [{ kind: 'wrap' }] };
    expect(deriveNode(wrap, state({ stage: 'done' })).id).toBe('wrapup');
    const removed = { mwMarkers: [{ kind: 'wrap' }, { kind: 'removed' }] };
    expect(deriveNode(removed, state({ stage: 'done' })).id).toBe('ended');
  });

  it('default: interview counts Rückfragen, then GO, then Umsetzung', () => {
    const item = { mwMarkers: [{ kind: 'ask' }, { kind: 'ask' }] };
    expect(deriveNode(item, state({ stage: 'briefing' }))).toEqual({
      id: 'default.interview',
      round: 'Rückfrage 2',
    });
    expect(deriveNode({}, state({ stage: 'awaiting' })).id).toBe('default.go_build');
    expect(deriveNode({}, state({ stage: 'building' })).id).toBe('default.impl');
  });

  it('image has one station', () => {
    expect(deriveNode({}, state({ mode: 'image' })).id).toBe('image.images');
  });
});
