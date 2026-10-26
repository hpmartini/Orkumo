import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MAX_STALE_FAILURES, useServerStats, type ServerStatsState } from './useServerStats';
import { serverLoad } from '../components/AgentsView/ServersPanel';
import { fetchServerStats } from '../services/agentsApi';

vi.mock('../services/agentsApi', () => ({ fetchServerStats: vi.fn() }));
const fetchMock = vi.mocked(fetchServerStats);

// Let resolved fetch promises run their .then inside act
const flush = () => act(async () => {});

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('useServerStats', () => {
  it('polls every 5s while enabled and stops on unmount', async () => {
    fetchMock.mockResolvedValue([{ pid: 1, cpu: 2.5, memMb: 100 }]);
    const { result, unmount } = renderHook(() => useServerStats([1], true));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.stats[1]).toEqual({ pid: 1, cpu: 2.5, memMb: 100 });

    await act(async () => vi.advanceTimersByTime(5_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    unmount();
    await act(async () => vi.advanceTimersByTime(20_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not poll while disabled or without pids', async () => {
    renderHook(() => useServerStats([1], false));
    renderHook(() => useServerStats([], true));
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts the running request on unmount', async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((_pids, s) => {
      signal = s;
      return new Promise(() => {});
    });
    const { unmount } = renderHook(() => useServerStats([1], true));
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('keeps the last values on failure and counts failures, drops exited pids', async () => {
    fetchMock.mockResolvedValueOnce([
      { pid: 1, cpu: 1, memMb: 10 },
      { pid: 2, cpu: 2, memMb: 20 },
    ]);
    const { result } = renderHook(() => useServerStats([1, 2], true));
    await flush();

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(result.current.failures).toBe(1);
    expect(result.current.stats[1]).toBeDefined();

    fetchMock.mockResolvedValueOnce([{ pid: 1, cpu: 1, memMb: 10 }]);
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(result.current.failures).toBe(0);
    expect(result.current.stats[2]).toBeUndefined();
    expect(result.current.checked.has(2)).toBe(true);
  });
});

describe('serverLoad', () => {
  const base: ServerStatsState = {
    stats: { 1: { pid: 1, cpu: 1, memMb: 10 } },
    checked: new Set([1, 2]),
    updatedAt: 0,
    failures: 0,
  };

  it('shows fresh values', () => {
    expect(serverLoad(base, 1)).toEqual({ stats: base.stats[1], stale: false });
  });
  it('explains a missing pid, an exited process and a not yet loaded one', () => {
    expect(serverLoad(base, undefined).note).toBe('No PID known');
    expect(serverLoad(base, 2).note).toBe('Process exited');
    expect(serverLoad(base, 3)).toEqual({ stats: undefined, stale: false });
  });
  it('marks values stale after a failure and drops them after repeated failures', () => {
    const stale = serverLoad({ ...base, failures: 1 }, 1);
    expect(stale.stale).toBe(true);
    expect(stale.note).toMatch(/refresh failed/);
    const gone = serverLoad({ ...base, failures: MAX_STALE_FAILURES }, 1);
    expect(gone.stats).toBeUndefined();
    expect(gone.note).toBe('Load unavailable');
  });
});
