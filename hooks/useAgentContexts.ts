import { useEffect, useRef, useState } from 'react';
import type { AgentContext, AgentSession } from '../types';
import { fetchAgentContexts } from '../services/agentsApi';
import { createThrottle, pollWhileVisible, type Throttle } from '../utils/visiblePoll';

/** Changes outside any session (PR merged, CI, an edit in the user's editor) */
const RECONCILE_MS = 120_000;
/** Session changes refetch at most this often (the server recomputes only the changed repos) */
const EVENT_GAP_MS = 10_000;

/**
 * What of the sessions can change their repo or PRs: state and turn status (an agent edits,
 * commits and pushes during a turn) and PR links. Not `detail`, which changes all through a turn.
 */
export function contextTriggerKey(sessions: AgentSession[]): string {
  return sessions
    .map((s) => `${s.id}:${s.state ?? ''}:${s.status ?? ''}:${s.displayState}:${s.links.length}`)
    .sort()
    .join('|');
}

/**
 * Git/PR/issue/sub-agent context per session id. Refetched when a session changes (`sessions`,
 * from the agents SSE), plus a slow reconcile; nothing while the page is hidden. Keeps the
 * previous data when a refresh fails.
 */
export function useAgentContexts(
  active: boolean,
  sessions: AgentSession[] = []
): Record<string, AgentContext> {
  const [contexts, setContexts] = useState<Record<string, AgentContext>>({});
  const onChange = useRef<Throttle | null>(null);
  const key = contextTriggerKey(sessions);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = (fresh: boolean) =>
      fetchAgentContexts({ fresh })
        .then((next) => !cancelled && setContexts(next))
        .catch(() => {});
    const throttle = createThrottle(() => load(true), EVENT_GAP_MS);
    onChange.current = throttle;
    const stop = pollWhileVisible(() => load(false), RECONCILE_MS);
    return () => {
      cancelled = true;
      stop();
      throttle.cancel();
      onChange.current = null;
    };
  }, [active]);

  // While hidden the return to the page reloads anyway
  useEffect(() => {
    if (key && !document.hidden) onChange.current?.call();
  }, [key]);

  return contexts;
}
