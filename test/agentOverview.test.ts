import { describe, expect, it } from 'vitest';
import type { AgentContext, AgentDisplayState, AgentSession } from '../types';
import { summarizeAgents } from '../utils/agentOverview';

const MIN = 60_000;
const session = (id: string, displayState: AgentDisplayState) =>
  ({ id, displayState, kind: 'background', cwd: '/x', name: id, startedAt: 0 }) as AgentSession;
const context = (lastActivityAt: number, cachedTokens: number) =>
  ({
    cache: {
      lastActivityAt,
      ttlMs: 60 * MIN,
      cachedTokens,
      contextWindow: 200_000,
      hits: 1,
      turns: 1,
      hitRatio: 1,
    },
  }) as AgentContext;

describe('summarizeAgents', () => {
  const now = 100 * MIN;
  const sessions = [
    session('a', 'needs-input'),
    session('b', 'working'),
    session('c', 'idle'),
    session('d', 'completed'),
    session('e', 'failed'),
    session('f', 'needs-input'),
  ];
  const contexts = {
    a: context(now - 55 * MIN, 50_000), // 5 min left
    b: context(now - 58 * MIN, 190_000), // working: no cache warning, but compaction
    c: context(now - 52 * MIN, 160_000), // 8 min left, exactly 80 %
    d: context(now - 59 * MIN, 199_000), // done: ignored
    f: context(now - 20 * MIN, 10_000), // 40 min left
  };

  it('counts states', () => {
    const o = summarizeAgents(sessions, contexts, now);
    expect([o.running, o.needsInput, o.working, o.done]).toEqual([4, 2, 1, 1]);
  });

  it('lists expiring caches of non-working sessions, soonest first', () => {
    const o = summarizeAgents(sessions, contexts, now);
    expect(o.cacheExpiring.map((e) => [e.session.id, e.remainingMs])).toEqual([
      ['a', 5 * MIN],
      ['c', 8 * MIN],
    ]);
  });

  it('lists alive sessions at >= 80 % context, fullest first', () => {
    const o = summarizeAgents(sessions, contexts, now);
    expect(o.needsCompaction.map((e) => e.session.id)).toEqual(['b', 'c']);
  });

  it('handles no sessions and missing caches', () => {
    expect(summarizeAgents([session('x', 'idle')], {}, now)).toMatchObject({
      running: 1,
      cacheExpiring: [],
      needsCompaction: [],
    });
  });
});
