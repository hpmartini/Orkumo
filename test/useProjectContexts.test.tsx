import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../services/contextsApi', () => ({
  fetchContexts: vi.fn(),
  activateContext: vi.fn(),
  createContext: vi.fn(),
  updateContext: vi.fn(),
  reorderContexts: vi.fn(),
  deleteContext: vi.fn(),
}));

import * as api from '../services/contextsApi';
import { useProjectContexts } from '../hooks/useProjectContexts';

const WORKSPACE = 'devOrbitAgentWorkspace.v2';
const RAIL = 'devOrbitAgentRail.v1';
const list = {
  contexts: [
    { id: 'all', name: 'Alle', appIds: null, boardFilter: [] },
    { id: 'epic', name: 'Epic', appIds: ['a'], boardFilter: [] },
  ],
  activeContextId: 'all',
};

describe('useProjectContexts', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.fetchContexts).mockResolvedValue(list);
  });

  it('adopts the local agent tabs for the active context on the first start', async () => {
    localStorage.setItem(WORKSPACE, 'tabs-of-before');
    const { result } = renderHook(() => useProjectContexts(vi.fn()));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.active?.id).toBe('all');
    expect(api.activateContext).not.toHaveBeenCalled();
    expect(localStorage.getItem(WORKSPACE)).toBe('tabs-of-before');
    expect(localStorage.getItem('devOrbitContextId')).toBe('all');
  });

  it('parks stale entries when another device switched meanwhile', async () => {
    localStorage.setItem('devOrbitContextId', 'epic');
    localStorage.setItem(WORKSPACE, 'epic-tabs');
    vi.mocked(api.activateContext).mockResolvedValue({
      activeContextId: 'all',
      ui: { [RAIL]: 'all-rail' },
    });
    const { result } = renderHook(() => useProjectContexts(vi.fn()));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(api.activateContext).toHaveBeenCalledWith(
      'all',
      expect.objectContaining({ [WORKSPACE]: 'epic-tabs' }),
      'epic'
    );
    expect(localStorage.getItem(WORKSPACE)).toBeNull();
    expect(localStorage.getItem(RAIL)).toBe('all-rail');
    expect(localStorage.getItem('devOrbitContextId')).toBe('all');
  });

  it('switches: sends the local entries, loads the target ones, reloads the apps', async () => {
    localStorage.setItem(WORKSPACE, 'all-tabs');
    const onSwitched = vi.fn();
    vi.mocked(api.activateContext).mockResolvedValue({
      activeContextId: 'epic',
      ui: { [WORKSPACE]: 'epic-tabs' },
    });
    const { result } = renderHook(() => useProjectContexts(onSwitched));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.switchTo('epic'));
    await waitFor(() => expect(result.current.active?.id).toBe('epic'));
    expect(api.activateContext).toHaveBeenCalledWith(
      'epic',
      expect.objectContaining({ [WORKSPACE]: 'all-tabs' }),
      'all'
    );
    expect(localStorage.getItem(WORKSPACE)).toBe('epic-tabs');
    expect(onSwitched).toHaveBeenCalledOnce();
  });
});
