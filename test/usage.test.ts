import { describe, it, expect } from 'vitest';
import {
  aggregateProviders,
  cacheHitRate,
  formatResetIn,
  formatTokens,
  limitStatus,
  modelTable,
  seriesByModel,
  seriesByProvider,
  tokensOn,
  usageKpis,
  windowDates,
} from '../utils/usage';
import type { UsageDaily, UsageProvider } from '../components/UsageView/types';

const row = (
  date: string,
  model: string,
  input: number,
  output = 0,
  cacheRead = 0,
  cacheWrite = 0
): UsageDaily => ({
  date,
  model,
  input,
  output,
  cacheRead,
  cacheWrite,
});

const provider = (id: string, daily: UsageDaily[]): UsageProvider => {
  const t = daily.reduce(
    (a, d) => ({
      input: a.input + d.input,
      output: a.output + d.output,
      cacheRead: a.cacheRead + d.cacheRead,
      cacheWrite: a.cacheWrite + d.cacheWrite,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  );
  return {
    id,
    label: id.toUpperCase(),
    kind: 'claude',
    available: true,
    limits: null,
    totals: { ...t, total: t.input + t.output + t.cacheRead + t.cacheWrite },
    cacheHitRate: null,
    daily,
  };
};

// 2026-10-29 15:00 local
const NOW = new Date(2026, 9, 29, 15, 0, 0).getTime();

describe('windowDates', () => {
  it('returns `days` local dates ending today, oldest first', () => {
    expect(windowDates(3, NOW)).toEqual(['2026-10-27', '2026-10-28', '2026-10-29']);
    expect(windowDates(30, NOW)).toHaveLength(30);
  });

  it('crosses month boundaries and DST without gaps', () => {
    const dates = windowDates(7, new Date(2026, 10, 1, 1, 0).getTime());
    expect(dates).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
  });
});

describe('aggregateProviders', () => {
  it('sums totals and merges daily per date+model', () => {
    const a = provider('a', [
      row('2026-10-28', 'opus', 10, 5, 80, 5),
      row('2026-10-29', 'opus', 1),
    ]);
    const b = provider('b', [row('2026-10-28', 'opus', 20), row('2026-10-28', 'gpt-5', 7)]);
    const all = aggregateProviders([a, b]);
    expect(all.id).toBe('all');
    expect(all.limits).toBeNull();
    expect(all.totals).toEqual({ input: 38, output: 5, cacheRead: 80, cacheWrite: 5, total: 128 });
    expect(all.daily).toHaveLength(3);
    expect(all.daily.find((d) => d.date === '2026-10-28' && d.model === 'opus')).toMatchObject({
      input: 30,
      cacheRead: 80,
    });
    expect(all.cacheHitRate).toBeCloseTo(80 / 123);
  });

  it('empty input gives zero totals and null hit rate', () => {
    const all = aggregateProviders([]);
    expect(all.totals.total).toBe(0);
    expect(all.cacheHitRate).toBeNull();
    expect(all.available).toBe(false);
  });
});

describe('cacheHitRate', () => {
  it('is null without prompt tokens', () => {
    expect(cacheHitRate({ input: 0, output: 9, cacheRead: 0, cacheWrite: 0 })).toBeNull();
  });
});

describe('stacked series', () => {
  const dates = ['2026-10-27', '2026-10-28', '2026-10-29'];

  it('fills missing days with zeros per model, keys sorted by volume', () => {
    const s = seriesByModel(
      [
        row('2026-10-28', 'opus', 10),
        row('2026-10-29', 'sonnet', 50),
        row('2026-10-29', 'opus', 5),
      ],
      dates
    );
    expect(s.keys).toEqual(['sonnet', 'opus']);
    expect(s.data).toEqual([
      { date: '2026-10-27', sonnet: 0, opus: 0 },
      { date: '2026-10-28', sonnet: 0, opus: 10 },
      { date: '2026-10-29', sonnet: 50, opus: 5 },
    ]);
  });

  it('stacks by provider label in "Alle" mode', () => {
    const s = seriesByProvider(
      [
        provider('a', [row('2026-10-29', 'opus', 3)]),
        provider('b', [row('2026-10-29', 'x', 4), row('2026-10-29', 'y', 4)]),
      ],
      dates
    );
    expect(s.keys).toEqual(['B', 'A']);
    expect(s.data[2]).toEqual({ date: '2026-10-29', A: 3, B: 8 });
  });
});

describe('modelTable / usageKpis / tokensOn', () => {
  const daily = [
    row('2026-10-28', 'opus', 10, 2, 3, 1),
    row('2026-10-29', 'opus', 100),
    row('2026-10-29', 'gpt', 1),
    row('2026-09-01', 'old', 999),
  ];
  const dates = ['2026-10-27', '2026-10-28', '2026-10-29'];

  it('sums per model sorted by total', () => {
    const t = modelTable(daily.slice(0, 3));
    expect(t.map((r) => r.model)).toEqual(['opus', 'gpt']);
    expect(t[0]).toEqual({
      model: 'opus',
      input: 110,
      output: 2,
      cacheRead: 3,
      cacheWrite: 1,
      total: 116,
    });
  });

  it('computes KPIs over the window only', () => {
    expect(usageKpis(daily, dates)).toEqual({
      total: 117,
      dailyAverage: 39,
      peak: { date: '2026-10-29', total: 101 },
      activeDays: 2,
    });
    expect(usageKpis([], dates)).toEqual({ total: 0, dailyAverage: 0, peak: null, activeDays: 0 });
  });

  it('tokensOn sums a single date', () => {
    expect(tokensOn(daily, '2026-10-29')).toBe(101);
  });
});

describe('formatTokens', () => {
  it.each([
    [1_540_000_000, '1.54B'],
    [219_400_000, '219.4M'],
    [13_500, '13.5K'],
    [950, '950'],
    [0, '0'],
  ])('%d -> %s', (n, s) => expect(formatTokens(n)).toBe(s));
});

describe('formatResetIn', () => {
  const min = 60_000;
  it.each([
    [(2 * 60 + 53) * min, 'in 2 h 53 min'],
    [(4 * 1440 + 6 * 60 + 10) * min, 'in 4 T 6 h'],
    [12 * min + 30_000, 'in 12 min'],
    [-5 * min, 'jetzt'],
  ])('%d ms -> %s', (delta, s) => expect(formatResetIn(NOW + delta, NOW)).toBe(s));
});

describe('limitStatus', () => {
  it('is unknown without limits or with null usedPercent', () => {
    expect(limitStatus(null)).toBe('unknown');
    expect(limitStatus(undefined)).toBe('unknown');
    expect(limitStatus({ usedPercent: null, resetsAt: NOW })).toBe('unknown');
  });

  it('grades by percentage', () => {
    expect(limitStatus({ usedPercent: 0, resetsAt: NOW })).toBe('ok');
    expect(limitStatus({ usedPercent: 70, resetsAt: NOW })).toBe('warn');
    expect(limitStatus({ usedPercent: 95, resetsAt: NOW })).toBe('critical');
  });
});
