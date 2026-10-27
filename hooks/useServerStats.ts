import { useEffect, useState } from 'react';
import type { AgentServerStats } from '../types';
import { fetchServerStats } from '../services/agentsApi';

const POLL_MS = 5_000;
// Matches the server limit (processStatsService MAX_PIDS)
const MAX_PIDS = 50;
/** Failed refreshes in a row after which the last values are dropped instead of shown as stale */
export const MAX_STALE_FAILURES = 3;

export interface ServerStatsState {
  /** Last successful result, keyed by pid */
  stats: Record<number, AgentServerStats>;
  /** Pids asked in the last successful poll: asked but missing from `stats` means the process exited */
  checked: Set<number>;
  /** Time of the last successful poll (ms), null before the first one */
  updatedAt: number | null;
  /** Failed refreshes since the last success */
  failures: number;
}

const EMPTY: ServerStatsState = { stats: {}, checked: new Set(), updatedAt: null, failures: 0 };

/**
 * CPU/memory per server pid. Polls every 5s only while `enabled` (panel open) and the tab is
 * visible; a failed refresh keeps the last data and counts up `failures` so the UI can mark it stale.
 */
export function useServerStats(pids: number[], enabled: boolean): ServerStatsState {
  const [state, setState] = useState<ServerStatsState>(EMPTY);
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
        .then((list) => {
          if (own.signal.aborted) return;
          setState({
            stats: Object.fromEntries(list.map((s) => [s.pid, s])),
            checked: new Set(wanted),
            updatedAt: Date.now(),
            failures: 0,
          });
        })
        .catch(() => {
          if (!own.signal.aborted) setState((s) => ({ ...s, failures: s.failures + 1 }));
        });
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

  return state;
}
