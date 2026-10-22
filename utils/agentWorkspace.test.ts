import { describe, it, expect } from 'vitest';
import {
  insertPosition,
  dropZone,
  layoutForZone,
  positionForZone,
  reorderIndices,
  stepIndices,
} from './agentWorkspace';

const rect = { left: 100, top: 50, width: 200, height: 100 };

function apply(order: string[], move: { from: number; to: number } | null): string[] {
  if (!move) return order;
  const next = [...order];
  const [m] = next.splice(move.from, 1);
  next.splice(move.to, 0, m);
  return next;
}

describe('insertPosition', () => {
  it('uses the pointer half', () => {
    expect(insertPosition(rect, 120)).toBe('before');
    expect(insertPosition(rect, 250)).toBe('after');
  });
});

describe('dropZone', () => {
  it('picks the nearest edge', () => {
    expect(dropZone(rect, 105, 100)).toBe('left');
    expect(dropZone(rect, 295, 100)).toBe('right');
    expect(dropZone(rect, 200, 52)).toBe('top');
    expect(dropZone(rect, 200, 148)).toBe('bottom');
  });
  it('handles an empty rect', () => {
    expect(dropZone({ left: 0, top: 0, width: 0, height: 0 }, 0, 0)).toBeDefined();
  });
});

describe('layout / position for zone', () => {
  it('maps zones', () => {
    expect(layoutForZone('left')).toBe('columns');
    expect(layoutForZone('right')).toBe('columns');
    expect(layoutForZone('top')).toBe('rows');
    expect(layoutForZone('bottom')).toBe('rows');
    expect(positionForZone('left')).toBe('before');
    expect(positionForZone('top')).toBe('before');
    expect(positionForZone('right')).toBe('after');
    expect(positionForZone('bottom')).toBe('after');
  });
});

describe('reorderIndices', () => {
  const order = ['a', 'b', 'c', 'd'];
  it('moves before / after a target in both directions', () => {
    expect(apply(order, reorderIndices(order, 'a', 'c', 'before'))).toEqual(['b', 'a', 'c', 'd']);
    expect(apply(order, reorderIndices(order, 'a', 'c', 'after'))).toEqual(['b', 'c', 'a', 'd']);
    expect(apply(order, reorderIndices(order, 'd', 'b', 'before'))).toEqual(['a', 'd', 'b', 'c']);
    expect(apply(order, reorderIndices(order, 'd', 'b', 'after'))).toEqual(['a', 'b', 'd', 'c']);
  });
  it('supports the end of the strip', () => {
    expect(apply(order, reorderIndices(order, 'a', 'd', 'after'))).toEqual(['b', 'c', 'd', 'a']);
  });
  it('returns null for no-ops and unknown ids', () => {
    expect(reorderIndices(order, 'b', 'c', 'before')).toBeNull();
    expect(reorderIndices(order, 'c', 'b', 'after')).toBeNull();
    expect(reorderIndices(order, 'a', 'a', 'after')).toBeNull();
    expect(reorderIndices(order, 'x', 'a', 'after')).toBeNull();
  });
});

describe('stepIndices', () => {
  const order = ['a', 'b', 'c'];
  it('moves one slot', () => {
    expect(apply(order, stepIndices(order, 'b', -1))).toEqual(['b', 'a', 'c']);
    expect(apply(order, stepIndices(order, 'b', 1))).toEqual(['a', 'c', 'b']);
  });
  it('stops at the ends', () => {
    expect(stepIndices(order, 'a', -1)).toBeNull();
    expect(stepIndices(order, 'c', 1)).toBeNull();
  });
});
