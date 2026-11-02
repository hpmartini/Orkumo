import React, { useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, RefreshCw } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { UsageDays, UsageLimitSource, UsageProvider } from './types';
import { useUsage } from './useUsage';
import { LimitBar } from './LimitBar';
import {
  ALL_PROVIDERS_ID,
  aggregateProviders,
  formatPercent,
  formatTokens,
  modelTable,
  seriesByModel,
  seriesByProvider,
  usageKpis,
  windowDates,
} from '../../utils/usage';

const SERIES_COLORS = [
  '#3b82f6',
  '#a855f7',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#6366f1',
  '#64748b',
];

const SOURCE_LABEL: Record<UsageLimitSource, string> = {
  statusline: 'Statusline',
  'claude-cache': 'Claude-Cache',
  rollout: 'Codex-Rollout',
};

const formatStand = (ms: number) =>
  new Date(ms).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const formatDay = (date: string) => {
  const [, m, d] = date.split('-');
  return `${d}.${m}.`;
};

const card = 'rounded-lg border border-gray-700 bg-gray-850';

/** Plan limits (5h + weekly) of one provider, or an honest "unknown"/"not available" */
const ProviderLimits: React.FC<{ provider: UsageProvider; compact?: boolean; now: number }> = ({
  provider,
  compact,
  now,
}) => {
  if (!provider.available) return <p className="text-xs text-gray-500">nicht verfügbar</p>;
  const { limits } = provider;
  if (!limits)
    return <p className="text-xs text-gray-500">Limit unbekannt – keine Quelle für Plan-Limits</p>;
  return (
    <div className="space-y-3">
      <div className={`grid gap-4 ${compact ? 'grid-cols-1' : 'sm:grid-cols-2'}`}>
        <LimitBar label="5 Stunden" window={limits.fiveHour} compact={compact} now={now} />
        <LimitBar label="Woche" window={limits.weekly} compact={compact} now={now} />
      </div>
      <p className="text-[11px] text-gray-500">
        Quelle: {SOURCE_LABEL[limits.source] ?? limits.source} · Stand {formatStand(limits.asOf)}
        {limits.plan && ` · Plan ${limits.plan}`}
      </p>
    </div>
  );
};

const Kpi: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => (
  <div className={`${card} px-4 py-3 min-w-0`}>
    <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
    <div className="mt-1 text-xl font-semibold text-gray-100 tabular-nums truncate">{value}</div>
    {hint && <div className="text-[11px] text-gray-500 tabular-nums">{hint}</div>}
  </div>
);

const Skeleton: React.FC = () => (
  <div className="space-y-4 animate-pulse" aria-busy="true" aria-label="Nutzung wird geladen">
    <div className="h-24 rounded-lg bg-gray-800" />
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="h-16 rounded-lg bg-gray-800" />
      ))}
    </div>
    <div className="h-72 rounded-lg bg-gray-800" />
  </div>
);

interface UsageViewProps {
  active: boolean;
}

/** Full "Nutzung" page: plan limits, KPIs, daily chart and model table per provider */
export const UsageView: React.FC<UsageViewProps> = ({ active }) => {
  const [days, setDays] = useState<UsageDays>(7);
  const [selected, setSelected] = useState<string>(ALL_PROVIDERS_ID);
  const { data, error, loading, refresh } = useUsage(days, active);

  const providers = data?.providers ?? [];
  const isAll = selected === ALL_PROVIDERS_ID;
  const current = useMemo(
    // no aggregate before the first response, otherwise zero tiles render next to the skeleton
    () =>
      !data
        ? undefined
        : isAll
          ? aggregateProviders(providers)
          : providers.find((p) => p.id === selected),
    [data, isAll, providers, selected]
  );
  const dates = useMemo(() => windowDates(days), [days, data]); // data: re-anchor "today" on refresh
  const series = useMemo(
    () =>
      current
        ? isAll
          ? seriesByProvider(providers, dates)
          : seriesByModel(current.daily, dates)
        : null,
    [current, isAll, providers, dates]
  );
  const kpis = useMemo(() => (current ? usageKpis(current.daily, dates) : null), [current, dates]);
  const rows = useMemo(() => (current ? modelTable(current.daily) : []), [current]);
  const now = data?.generatedAt ?? Date.now();

  const tab = (id: string, label: string) => (
    <button
      key={id}
      onClick={() => setSelected(id)}
      aria-pressed={selected === id}
      aria-label={`Anbieter ${label} anzeigen`}
      className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
        selected === id
          ? 'bg-gray-700 text-white'
          : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="h-full overflow-y-auto bg-gray-900 text-gray-200">
      <div className="max-w-7xl mx-auto p-6 space-y-5">
        <header className="flex flex-wrap items-center gap-3">
          <BarChart3 size={20} className="text-blue-400" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-gray-100 mr-auto">Nutzung</h1>
          <div
            className="flex rounded-md border border-gray-700 bg-gray-850 p-0.5"
            role="group"
            aria-label="Zeitraum"
          >
            {([7, 30] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                aria-pressed={days === d}
                aria-label={`Letzte ${d} Tage`}
                className={`px-2.5 py-1 rounded text-xs tabular-nums transition-colors ${
                  days === d ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {d}T
              </button>
            ))}
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            aria-label="Nutzung aktualisieren"
            title="Aktualisieren"
            className="p-2 rounded-md border border-gray-700 text-gray-400 hover:text-gray-200 hover:bg-gray-800 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </header>

        {providers.length > 0 && (
          <nav className="flex flex-wrap gap-1 border-b border-gray-700 pb-2" aria-label="Anbieter">
            {tab(ALL_PROVIDERS_ID, 'Alle')}
            {providers.map((p) => tab(p.id, p.label))}
          </nav>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
          >
            <AlertTriangle size={16} aria-hidden="true" />
            <span className="mr-auto">Nutzung konnte nicht geladen werden: {error}</span>
            <button
              onClick={refresh}
              aria-label="Laden erneut versuchen"
              className="px-3 py-1 rounded-md bg-red-500/20 hover:bg-red-500/30 text-red-200"
            >
              Erneut versuchen
            </button>
          </div>
        )}

        {!data && !error && <Skeleton />}

        {data && providers.length === 0 && (
          <div className={`${card} p-10 text-center text-sm text-gray-500`}>
            Keine Anbieter mit Nutzungsdaten gefunden.
          </div>
        )}

        {data && providers.length > 0 && !current && (
          <div className={`${card} p-10 text-center text-sm text-gray-500`}>
            Anbieter nicht mehr vorhanden.
          </div>
        )}

        {current && kpis && series && (
          <>
            {isAll ? (
              <section
                aria-label="Anbieter im Vergleich"
                className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
              >
                {providers.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelected(p.id)}
                    aria-label={`Details zu ${p.label}`}
                    className={`${card} p-4 text-left hover:border-gray-500 transition-colors`}
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-3">
                      <span className="font-medium text-gray-100 truncate">{p.label}</span>
                      <span className="text-sm tabular-nums text-gray-300">
                        {formatTokens(p.totals.total)}
                      </span>
                    </div>
                    <ProviderLimits provider={p} compact now={now} />
                  </button>
                ))}
              </section>
            ) : (
              <section className={`${card} p-4`} aria-label="Plan-Limits">
                <h2 className="text-sm font-medium text-gray-300 mb-3">Plan-Limits</h2>
                <ProviderLimits provider={current} now={now} />
              </section>
            )}

            <section className="grid grid-cols-2 lg:grid-cols-5 gap-3" aria-label="Kennzahlen">
              <Kpi label="Tokens gesamt" value={formatTokens(kpis.total)} hint={`${days} Tage`} />
              <Kpi label="Ø pro Tag" value={formatTokens(kpis.dailyAverage)} />
              <Kpi
                label="Spitzentag"
                value={kpis.peak ? formatTokens(kpis.peak.total) : '–'}
                hint={kpis.peak ? formatDay(kpis.peak.date) : undefined}
              />
              <Kpi label="Aktive Tage" value={`${kpis.activeDays} / ${days}`} />
              <Kpi label="Cache-Trefferquote" value={formatPercent(current.cacheHitRate)} />
            </section>

            <section className={`${card} p-4`} aria-label="Tokens pro Tag">
              <h2 className="text-sm font-medium text-gray-300 mb-3">
                Tokens pro Tag {isAll ? 'nach Anbieter' : 'nach Modell'}
              </h2>
              {series.keys.length === 0 ? (
                <p className="py-16 text-center text-sm text-gray-500">
                  Keine Nutzung im Zeitraum.
                </p>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={series.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#374151" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickFormatter={formatDay}
                        stroke="#6b7280"
                        fontSize={11}
                        tickLine={false}
                      />
                      <YAxis
                        tickFormatter={(v: number) => formatTokens(v)}
                        stroke="#6b7280"
                        fontSize={11}
                        tickLine={false}
                        width={56}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                        contentStyle={{
                          background: '#1f2937',
                          border: '1px solid #374151',
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                        labelFormatter={(l) => formatDay(String(l))}
                        formatter={(v) => formatTokens(Number(v))}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {series.keys.map((k, i) => (
                        <Bar
                          key={k}
                          dataKey={k}
                          stackId="t"
                          fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            <section className={`${card} overflow-x-auto`} aria-label="Nutzung nach Modell">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-700">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">Modell</th>
                    <th className="text-right font-medium px-4 py-2">Input</th>
                    <th className="text-right font-medium px-4 py-2">Output</th>
                    <th className="text-right font-medium px-4 py-2">Cache Read</th>
                    <th className="text-right font-medium px-4 py-2">Cache Write</th>
                    <th className="text-right font-medium px-4 py-2">Gesamt</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                        Keine Modelle im Zeitraum.
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => (
                    <tr
                      key={r.model}
                      className="border-b border-gray-800 last:border-0 hover:bg-gray-800/50"
                    >
                      <td className="px-4 py-2 text-gray-200">{r.model}</td>
                      <td className="px-4 py-2 text-right">{formatTokens(r.input)}</td>
                      <td className="px-4 py-2 text-right">{formatTokens(r.output)}</td>
                      <td className="px-4 py-2 text-right">{formatTokens(r.cacheRead)}</td>
                      <td className="px-4 py-2 text-right">{formatTokens(r.cacheWrite)}</td>
                      <td className="px-4 py-2 text-right font-medium text-gray-100">
                        {formatTokens(r.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
    </div>
  );
};
