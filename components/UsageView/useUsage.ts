import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchUsage } from '../../services/api';
import type { UsageDays, UsageResponse } from './types';

const REFRESH_MS = 60_000;

/** Fetches /api/usage while enabled and refreshes every 60 s; keeps the last data during reloads */
export function useUsage(days: UsageDays, enabled: boolean) {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const res = await fetchUsage(days);
      if (id !== requestId.current) return;
      setData(res);
      setError(null);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      clearInterval(timer);
      requestId.current++; // drop in-flight responses after disable / days change
    };
  }, [enabled, refresh]);

  return { data, error, loading, refresh };
}
