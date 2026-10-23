import { useEffect, useState } from 'react';
import type { AgentServerStats } from '../types';
import { fetchServerStats } from '../services/agentsApi';

const POLL_MS = 5_000;
// Matches the server limit (processStatsService MAX_PIDS)
const MAX_PIDS = 50;

/**
 * CPU/memory per server pid, keyed by pid. Polls every 5s only while `enabled` (panel open) and
 * the tab is visible; keeps the last data when a refresh fails, drops pids the server omits.
 */
export function useServerStats(pids: number[], enabled: boolean): Record<number, AgentServerStats> {
  const [stats, setStats] = useState<Record<number, AgentServerStats>>({});
  const pidKey = [...new Set(pids)]
    .sort((a, b) => a - b)
    .slice(0, MAX_PIDS)
    .join(',');

  useEffect(() => {
    if (!enabled || !pidKey) return;
    const wanted = pidKey.split(',').map(Number);
    let controller: AbortController | null = null;
    const load = () => {
      if (document.hidden) return;
      controller?.abort();
      const own = (controller = new AbortController());
      fetchServerStats(wanted, own.signal)
        .then(
          (list) => !own.signal.aborted && setStats(Object.fromEntries(list.map((s) => [s.pid, s])))
        )
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
      controller?.abort();
    };
  }, [enabled, pidKey]);

  return stats;
}
