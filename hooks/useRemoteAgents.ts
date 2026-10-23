import { useEffect, useState } from 'react';
import type { RemoteAgentsResponse } from '../types';
import { fetchRemoteAgents } from '../services/agentsApi';

const POLL_MS = 15000;

/**
 * Sessions of the other Tailscale devices. Fetches nothing while disabled or hidden,
 * so the local agent list is unaffected when the switch is off.
 */
export function useRemoteAgents(enabled: boolean) {
  const [data, setData] = useState<RemoteAgentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const load = () =>
      fetchRemoteAgents()
        .then((result) => {
          if (cancelled) return;
          setData(result);
          setError(null);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load devices');
        });
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);

  return { data, error, loading: enabled && !data && !error };
}
