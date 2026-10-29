import React from 'react';
import type { UsageWindow } from './types';
import { formatResetIn, limitStatus, type LimitStatus } from '../../utils/usage';

const BAR_TONE: Record<LimitStatus, string> = {
  unknown: 'bg-gray-600',
  ok: 'bg-emerald-500',
  warn: 'bg-yellow-500',
  critical: 'bg-red-500',
};

const TEXT_TONE: Record<LimitStatus, string> = {
  unknown: 'text-gray-500',
  ok: 'text-gray-200',
  warn: 'text-yellow-300',
  critical: 'text-red-300',
};

interface LimitBarProps {
  label: string;
  window: UsageWindow | null | undefined;
  /** Text shown instead of a number when the value is unknown */
  unknownText?: string;
  compact?: boolean;
  now?: number;
}

/** One plan-limit window: % used + reset countdown. Never shows a number it does not have. */
export const LimitBar: React.FC<LimitBarProps> = ({
  label,
  window,
  unknownText = 'Limit unbekannt',
  compact = false,
  now = Date.now(),
}) => {
  const status = limitStatus(window);
  const pct = status === 'unknown' ? null : Math.min(100, Math.max(0, window!.usedPercent!));
  const height = compact ? 'h-1' : 'h-2';

  return (
    <div className="min-w-0">
      <div
        className={`flex items-baseline justify-between gap-2 ${compact ? 'text-[11px]' : 'text-xs'}`}
      >
        <span className="text-gray-400">{label}</span>
        <span className={`tabular-nums ${TEXT_TONE[status]}`}>
          {pct == null ? unknownText : `${Math.round(pct)} %`}
        </span>
      </div>
      {pct == null ? (
        <div
          className={`mt-1 ${height} rounded-full bg-gray-800 border border-dashed border-gray-700`}
          aria-hidden="true"
        />
      ) : (
        <div
          role="progressbar"
          aria-label={`${label} genutzt`}
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          className={`mt-1 ${height} rounded-full bg-gray-800 overflow-hidden`}
        >
          <div className={`h-full rounded-full ${BAR_TONE[status]}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      {!compact && window && (
        <div className="mt-1 text-[11px] text-gray-500 tabular-nums">
          Reset {formatResetIn(window.resetsAt, now)}
        </div>
      )}
    </div>
  );
};
