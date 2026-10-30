import React from 'react';
import { BarChart3, ChevronRight, RefreshCw } from 'lucide-react';
import { useUsage } from './useUsage';
import { LimitBar } from './LimitBar';
import { formatTokens, todayKey, tokensOn } from '../../utils/usage';

interface UsageCardProps {
  onOpen: () => void;
}

/** Compact dashboard card: per provider 5h/weekly limit bars and today's tokens */
export const UsageCard: React.FC<UsageCardProps> = ({ onOpen }) => {
  const { data, error, loading, refresh } = useUsage(7, true);
  const now = data?.generatedAt ?? Date.now();
  const today = todayKey(now);

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800 p-4">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 size={16} className="text-blue-400" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-gray-200 mr-auto">Nutzung</h3>
        <button
          onClick={refresh}
          disabled={loading}
          aria-label="Nutzung aktualisieren"
          className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-700 disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={onOpen}
          aria-label="Nutzungsdetails öffnen"
          className="flex items-center gap-0.5 px-2 py-1 rounded text-xs text-blue-300 hover:bg-gray-700"
        >
          Details <ChevronRight size={12} aria-hidden="true" />
        </button>
      </div>

      {error && !data && (
        <div role="alert" className="text-xs text-red-300">
          Nicht geladen.{' '}
          <button
            onClick={refresh}
            aria-label="Laden erneut versuchen"
            className="underline hover:text-red-200"
          >
            Erneut versuchen
          </button>
        </div>
      )}
      {!data && !error && (
        <div className="space-y-2 animate-pulse" aria-busy="true" aria-label="Nutzung wird geladen">
          <div className="h-8 rounded bg-gray-700/60" />
          <div className="h-8 rounded bg-gray-700/60" />
        </div>
      )}
      {data && data.providers.length === 0 && (
        <p className="text-xs text-gray-500">Keine Anbieter gefunden.</p>
      )}

      {data && data.providers.length > 0 && (
        <ul className="divide-y divide-gray-700/70">
          {data.providers.map((p) => (
            <li
              key={p.id}
              className="py-2 first:pt-0 last:pb-0 grid grid-cols-[minmax(0,7rem)_1fr_1fr_auto] items-center gap-3"
            >
              <span className="text-xs text-gray-300 truncate" title={p.label}>
                {p.label}
              </span>
              {p.available ? (
                <>
                  <LimitBar
                    label="5 h"
                    window={p.limits?.fiveHour}
                    unknownText="unbekannt"
                    compact
                    now={now}
                  />
                  <LimitBar
                    label="Woche"
                    window={p.limits?.weekly}
                    unknownText="unbekannt"
                    compact
                    now={now}
                  />
                </>
              ) : (
                <span className="col-span-2 text-[11px] text-gray-500">nicht verfügbar</span>
              )}
              <span className="text-right text-xs tabular-nums text-gray-200" title="Tokens heute">
                {formatTokens(tokensOn(p.daily, today))}
                <span className="block text-[10px] text-gray-500">heute</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
