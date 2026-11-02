import type {
  UsageDaily,
  UsageProvider,
  UsageTokens,
  UsageTotals,
  UsageWindow,
} from '../components/UsageView/types';

export const ALL_PROVIDERS_ID = 'all';

const DAY_MS = 86_400_000;

export const tokenSum = (t: UsageTokens): number => t.input + t.output + t.cacheRead + t.cacheWrite;

const addTokens = <T extends UsageTokens>(into: T, t: UsageTokens): T => {
  into.input += t.input;
  into.output += t.output;
  into.cacheRead += t.cacheRead;
  into.cacheWrite += t.cacheWrite;
  return into;
};

/** Cache hits as share of all prompt-side tokens; null when there is no prompt traffic */
export function cacheHitRate(t: UsageTokens): number | null {
  const prompt = t.input + t.cacheRead + t.cacheWrite;
  return prompt > 0 ? t.cacheRead / prompt : null;
}

/** "Alle": sums totals and merges daily rows per date+model across providers */
export function aggregateProviders(providers: UsageProvider[]): UsageProvider {
  const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const merged = new Map<string, UsageDaily>();
  for (const p of providers) {
    addTokens(totals, p.totals);
    totals.total += p.totals.total;
    for (const d of p.daily) {
      const key = `${d.date}\u0000${d.model}`;
      const row = merged.get(key) ?? {
        date: d.date,
        model: d.model,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      };
      merged.set(key, addTokens(row, d));
    }
  }
  return {
    id: ALL_PROVIDERS_ID,
    label: 'Alle',
    kind: 'all',
    available: providers.some((p) => p.available),
    limits: null,
    totals,
    cacheHitRate: cacheHitRate(totals),
    daily: [...merged.values()],
  };
}

const localDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The `days` local dates (YYYY-MM-DD) ending today, oldest first */
export function windowDates(days: number, now = Date.now()): string[] {
  const out: string[] = [];
  // noon anchor keeps DST shifts from skipping or doubling a date
  const noon = new Date(now);
  noon.setHours(12, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) out.push(localDate(noon.getTime() - i * DAY_MS));
  return out;
}

export const todayKey = (now = Date.now()): string => localDate(now);

export interface StackedSeries {
  /** One row per date, every key present (missing days are 0) */
  data: Array<Record<string, number | string> & { date: string }>;
  /** Series keys, largest total first */
  keys: string[];
}

function stack(
  rows: Array<{ key: string; date: string; tokens: number }>,
  dates: string[]
): StackedSeries {
  const sums = new Map<string, number>();
  const byDate = new Map<string, Map<string, number>>();
  for (const r of rows) {
    sums.set(r.key, (sums.get(r.key) ?? 0) + r.tokens);
    const day = byDate.get(r.date) ?? new Map<string, number>();
    day.set(r.key, (day.get(r.key) ?? 0) + r.tokens);
    byDate.set(r.date, day);
  }
  const keys = [...sums.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const data = dates.map((date) => {
    const row: Record<string, number | string> & { date: string } = { date };
    for (const k of keys) row[k] = byDate.get(date)?.get(k) ?? 0;
    return row;
  });
  return { keys, data };
}

/** Recharts rows stacked per model */
export const seriesByModel = (daily: UsageDaily[], dates: string[]): StackedSeries =>
  stack(
    daily.map((d) => ({ key: d.model, date: d.date, tokens: tokenSum(d) })),
    dates
  );

/** Recharts rows stacked per provider (for "Alle") */
export const seriesByProvider = (providers: UsageProvider[], dates: string[]): StackedSeries =>
  stack(
    providers.flatMap((p) =>
      p.daily.map((d) => ({ key: p.label, date: d.date, tokens: tokenSum(d) }))
    ),
    dates
  );

export interface ModelRow extends UsageTotals {
  model: string;
}

/** Per-model sums, largest first */
export function modelTable(daily: UsageDaily[]): ModelRow[] {
  const map = new Map<string, ModelRow>();
  for (const d of daily) {
    const row = map.get(d.model) ?? {
      model: d.model,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    };
    addTokens(row, d);
    row.total += tokenSum(d);
    map.set(d.model, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export interface UsageKpis {
  total: number;
  dailyAverage: number;
  peak: { date: string; total: number } | null;
  activeDays: number;
}

/** KPIs over the window; days outside `dates` are ignored */
export function usageKpis(daily: UsageDaily[], dates: string[]): UsageKpis {
  const perDay = new Map<string, number>(dates.map((d) => [d, 0]));
  for (const d of daily)
    if (perDay.has(d.date)) perDay.set(d.date, perDay.get(d.date)! + tokenSum(d));
  let total = 0;
  let activeDays = 0;
  let peak: UsageKpis['peak'] = null;
  for (const [date, t] of perDay) {
    total += t;
    if (t > 0) activeDays++;
    if (t > 0 && (!peak || t > peak.total)) peak = { date, total: t };
  }
  return { total, dailyAverage: dates.length ? total / dates.length : 0, peak, activeDays };
}

/** Tokens of one local date */
export const tokensOn = (daily: UsageDaily[], date: string): number =>
  daily.reduce((s, d) => (d.date === date ? s + tokenSum(d) : s), 0);

/** 1.54B, 219.4M, 13.5K, 950 */
export function formatTokens(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

/** "in 2 h 53 min", "in 4 T 6 h", "in 12 min", "jetzt" */
export function formatResetIn(resetsAt: number, now = Date.now()): string {
  const min = Math.floor((resetsAt - now) / 60_000);
  if (min <= 0) return 'jetzt';
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `in ${d} T ${h} h`;
  if (h > 0) return `in ${h} h ${m} min`;
  return `in ${m} min`;
}

export type LimitStatus = 'unknown' | 'ok' | 'warn' | 'critical';

export function limitStatus(window: UsageWindow | null | undefined): LimitStatus {
  if (!window || window.usedPercent == null) return 'unknown';
  if (window.usedPercent >= 90) return 'critical';
  if (window.usedPercent >= 70) return 'warn';
  return 'ok';
}

export function formatPercent(rate: number | null): string {
  return rate == null ? '–' : `${(rate * 100).toFixed(1)} %`;
}
