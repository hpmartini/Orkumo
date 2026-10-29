import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAgentWorkspace, STORAGE_KEY } from '../hooks/useAgentWorkspace';

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
