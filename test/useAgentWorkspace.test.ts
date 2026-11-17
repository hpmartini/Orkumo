import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAgentWorkspace, STORAGE_KEY } from '../hooks/useAgentWorkspace';
import { hiddenTabIds } from '../utils/agentWorkspace';

describe('useAgentWorkspace context switch', () => {
  beforeEach(() => localStorage.clear());

  it('parks the left workspace and takes it back live on return', () => {
    const { result, rerender } = renderHook(({ ctx }) => useAgentWorkspace(ctx), {
      initialProps: { ctx: 'a' },
    });
    act(() => result.current.attach('s1'));
    const inA = result.current.workspace;

    // useProjectContexts swaps the stored workspace before the new context id arrives
    localStorage.removeItem(STORAGE_KEY);
    rerender({ ctx: 'b' });
    expect(result.current.workspace.tabs).toHaveLength(0);
    expect(result.current.parked).toEqual({ a: inA });

    act(() => result.current.attach('s2'));
    const inB = result.current.workspace;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(inA));
    rerender({ ctx: 'a' });
    expect(result.current.workspace).toEqual(inA);
    expect(result.current.parked).toEqual({ b: inB });
  });
});

describe('hiddenTabIds', () => {
  it('lists tabs cut off on either side of the strip', () => {
    const strip = { left: 100, right: 500 };
    const tabs = [
      { id: 'a', left: 40, right: 160 },
      { id: 'b', left: 160, right: 280 },
      { id: 'c', left: 280, right: 500.5 },
      { id: 'd', left: 500, right: 620 },
    ];
    expect(hiddenTabIds(strip, tabs)).toEqual(['a', 'd']);
  });
});
