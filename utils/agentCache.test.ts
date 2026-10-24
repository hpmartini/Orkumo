import { describe, expect, it } from 'vitest';
import { cacheCountdown, formatCountdown, formatTokens, isCacheWarning } from './agentCache';

const cache = {
  lastActivityAt: 0,
  ttlMs: 60 * 60_000,
  cachedTokens: 142_000,
  contextWindow: 200_000,
  hits: 3,
  turns: 4,
  hitRatio: 0.9,
};

describe('cacheCountdown', () => {
  it('counts down from the last turn', () => {
    expect(cacheCountdown(cache, 20 * 60_000)).toEqual({
      remainingMs: 40 * 60_000,
      expired: false,
      warning: false,
    });
  });
  it('warns within the last 10 minutes', () => {
    expect(cacheCountdown(cache, 50 * 60_000).warning).toBe(true);
    expect(isCacheWarning(cache, 59 * 60_000)).toBe(true);
  });
  it('expires without warning', () => {
    expect(cacheCountdown(cache, 61 * 60_000)).toEqual({
      remainingMs: 0,
      expired: true,
      warning: false,
    });
    expect(isCacheWarning(null, 0)).toBe(false);
  });
});

describe('formatters', () => {
  it('formats mm:ss rounding up', () => {
    expect(formatCountdown(60 * 60_000)).toBe('60:00');
    expect(formatCountdown(9 * 60_000 + 500)).toBe('9:01');
    expect(formatCountdown(0)).toBe('0:00');
  });
  it('formats tokens', () => {
    expect(formatTokens(142_400)).toBe('142k');
    expect(formatTokens(1_000_000)).toBe('1M');
    expect(formatTokens(950)).toBe('950');
  });
});
