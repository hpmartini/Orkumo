import type { AgentContext, AgentSession } from '../types';
import { cacheCountdown } from './agentCache';

/** Context fill at or above which a session should be compacted */
export const COMPACT_FILL = 0.8;

export interface AgentOverview {
  /** Alive sessions: working, waiting for input, idle, looping or interactive */
  running: number;
  needsInput: number;
  working: number;
  done: number;
  /** Not working and the prompt cache expires within CACHE_WARN_MS, soonest first */
  cacheExpiring: { session: AgentSession; remainingMs: number }[];
  /** Context fill >= COMPACT_FILL, fullest first */
  needsCompaction: { session: AgentSession; fill: number }[];
}

const ALIVE = new Set(['working', 'needs-input', 'idle', 'loop', 'interactive']);

/** The dashboard's agent situation: who needs attention, whose cache or context runs out */
export function summarizeAgents(
  sessions: AgentSession[],
  contexts: Record<string, AgentContext>,
  now: number
): AgentOverview {
  const overview: AgentOverview = {
    running: 0,
    needsInput: 0,
    working: 0,
    done: 0,
    cacheExpiring: [],
    needsCompaction: [],
  };
  for (const session of sessions) {
    const state = session.displayState;
    if (ALIVE.has(state)) overview.running += 1;
    if (state === 'needs-input') overview.needsInput += 1;
    else if (state === 'working') overview.working += 1;
    else if (state === 'completed') overview.done += 1;

    const cache = contexts[session.id]?.cache;
    if (!cache || !ALIVE.has(state)) continue;
    const { remainingMs, warning } = cacheCountdown(cache, now);
    if (warning && state !== 'working') overview.cacheExpiring.push({ session, remainingMs });
    const fill = cache.contextWindow > 0 ? cache.cachedTokens / cache.contextWindow : 0;
    if (fill >= COMPACT_FILL) overview.needsCompaction.push({ session, fill });
  }
  overview.cacheExpiring.sort((a, b) => a.remainingMs - b.remainingMs);
  overview.needsCompaction.sort((a, b) => b.fill - a.fill);
  return overview;
}
