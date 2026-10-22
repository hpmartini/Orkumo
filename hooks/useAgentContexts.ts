import { useEffect, useState } from 'react';
import type { AgentContext } from '../types';
import { fetchAgentContexts } from '../services/agentsApi';

const POLL_MS = 30_000;

/**
 * Git/PR/issue/sub-agent context per session id; polls while active and keeps
 * the previous data when a refresh fails.
 */
export function useAgentContexts(active: boolean): Record<string, AgentContext> {
  const [contexts, setContexts] = useState<Record<string, AgentContext>>({});

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = () =>
      fetchAgentContexts()
        .then((next) => !cancelled && setContexts(next))
        .catch(() => {});
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active]);

  return contexts;
}
