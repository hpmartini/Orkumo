import type { AgentCacheInfo } from '../types';

/** Remaining cache time at or below which an agent and its project are highlighted */
export const CACHE_WARN_MS = 10 * 60_000;

export interface CacheCountdown {
  remainingMs: number;
  expired: boolean;
  warning: boolean;
}

export function cacheCountdown(cache: AgentCacheInfo, now: number): CacheCountdown {
  const remainingMs = Math.max(0, cache.lastActivityAt + cache.ttlMs - now);
  return {
    remainingMs,
    expired: remainingMs === 0,
    warning: remainingMs > 0 && remainingMs <= CACHE_WARN_MS,
  };
}

export function isCacheWarning(cache: AgentCacheInfo | null | undefined, now: number): boolean {
  return !!cache && cacheCountdown(cache, now).warning;
}

/** mm:ss, rounded up so "0:00" only shows once the cache is gone */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** 142000 -> "142k", 1000000 -> "1M" */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}
