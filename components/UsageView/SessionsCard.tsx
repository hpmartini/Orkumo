import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import { fetchUsageSessions } from '../../services/api';
import type { UsageSessionsResponse } from './types';
import {
  formatDuration,
  formatTokens,
  rankSessions,
  sessionDuration,
  type SessionSort,
} from '../../utils/usage';
import { inProjectScope } from '../../utils/projectScope';

const DAYS = 7;
const TABS: { id: SessionSort; label: string }[] = [
  { id: 'recent', label: 'Neueste' },
  { id: 'tokens', label: 'Größte (Tokens)' },
  { id: 'duration', label: 'Längste (Dauer)' },
];

const formatWhen = (ms: number) =>
  new Date(ms).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const baseName = (p: string | null) => (p ? p.replace(/\/+$/, '').split('/').pop() : null);

interface SessionsCardProps {
  active: boolean;
  /** Context dashboard: only sessions whose cwd lies in these projects */
  projectPaths?: string[];
}

/** Dashboard card (#184): sessions of the last 7 days, by newest, most tokens or longest run */
export const SessionsCard: React.FC<SessionsCardProps> = ({ active, projectPaths }) => {
  const [tab, setTab] = useState<SessionSort>('recent');
  const [data, setData] = useState<UsageSessionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchUsageSessions(DAYS)
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const rows = useMemo(
    () =>
      data ? rankSessions(data.sessions, tab, (cwd) => inProjectScope(cwd, projectPaths)) : [],
    [data, tab, projectPaths]
  );

  return (
    <section className="rounded-xl border border-gray-700 bg-gray-800 p-4" aria-label="Sessions">
      <div className="flex items-center gap-2 mb-3">
        <History size={16} className="text-blue-400" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-gray-200 mr-auto">
          Sessions <span className="font-normal text-gray-500">· {DAYS} Tage</span>
        </h3>
        <button
          onClick={load}
          disabled={loading}
          aria-label="Sessions aktualisieren"
          className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-700 disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div role="tablist" aria-label="Sortierung" className="flex gap-1 mb-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-2 py-1 rounded text-xs transition-colors ${
              tab === t.id
                ? 'bg-sel text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {error && !data && (
          <p role="alert" className="text-xs text-red-300">
            Sessions nicht geladen.
          </p>
        )}
        {!data && !error && <p className="text-xs text-gray-500">Lädt…</p>}
        {data && rows.length === 0 && (
          <p className="text-xs text-gray-500">Keine Sessions in den letzten {DAYS} Tagen.</p>
        )}
        {rows.length > 0 && (
          <ol className="divide-y divide-gray-700/70">
            {rows.map((s) => {
              const name = s.title || baseName(s.cwd) || s.id;
              return (
                <li
                  key={s.id}
                  className="py-1.5 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 text-xs"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-gray-200" title={s.cwd ?? undefined}>
                      {name}
                    </span>
                    <span className="block truncate text-[11px] text-gray-500">
                      {s.provider}
                      {s.title && s.cwd && ` · ${baseName(s.cwd)}`}
                      {s.branch && ` · ${s.branch}`} · {formatWhen(s.lastMs)}
                    </span>
                  </span>
                  <span
                    className={`tabular-nums ${tab === 'tokens' ? 'text-white' : 'text-gray-400'}`}
                    title="Tokens der Session"
                  >
                    {formatTokens(s.tokens)}
                  </span>
                  <span
                    className={`tabular-nums w-20 text-right ${
                      tab === 'duration' ? 'text-white' : 'text-gray-400'
                    }`}
                    title="Dauer: erste bis letzte Antwort"
                  >
                    {formatDuration(sessionDuration(s))}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
};
