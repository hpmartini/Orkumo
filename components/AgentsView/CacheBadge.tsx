import React, { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import type { AgentCacheInfo } from '../../types';
import { cacheCountdown, formatCountdown, formatTokens } from '../../utils/agentCache';

/** Prompt-cache countdown, context fill and hits of one session; ticks every second while warm */
export const CacheBadge: React.FC<{ cache: AgentCacheInfo }> = ({ cache }) => {
  const [now, setNow] = useState(Date.now());
  const { remainingMs, expired, warning } = cacheCountdown(cache, now);

  useEffect(() => {
    if (expired) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expired, cache]);

  const fill = Math.min(1, cache.cachedTokens / cache.contextWindow);
  const percent = Math.round(fill * 100);
  const title = [
    expired
      ? 'Prompt cache expired: the next turn re-reads the whole context'
      : `Prompt cache expires in ${formatCountdown(remainingMs)} (TTL ${cache.ttlMs / 60_000} min)`,
    `Context: ${formatTokens(cache.cachedTokens)} / ${formatTokens(cache.contextWindow)} tokens (${percent}%)`,
    `Cache hits: ${cache.hits} of ${cache.turns} turns, ${Math.round(cache.hitRatio * 100)}% of input tokens read from cache`,
  ].join('\n');

  return (
    <span
      className={`shrink-0 flex items-center gap-1 tabular-nums ${
        warning ? 'text-amber-300' : expired ? 'text-gray-500' : 'text-gray-400'
      }`}
      title={title}
    >
      <Timer size={10} aria-hidden="true" className="shrink-0" />
      <span className={warning ? 'font-semibold' : ''}>
        {expired ? 'expired' : formatCountdown(remainingMs)}
      </span>
      <span
        className="w-8 h-1 rounded-full bg-gray-700 overflow-hidden"
        role="meter"
        aria-label="Context window fill"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span
          className={`block h-full ${fill > 0.8 ? 'bg-red-400' : 'bg-sky-400'} transition-[width] duration-300 motion-reduce:transition-none`}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span>
        {formatTokens(cache.cachedTokens)} · {percent}%
      </span>
      <span className="text-gray-500">·</span>
      <span>{cache.hits} hits</span>
    </span>
  );
};
