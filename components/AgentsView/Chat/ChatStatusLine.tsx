import React, { useEffect, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { fetchChatStatus, type ChatStatus } from '../../../services/agentsApi';
import { cacheCountdown, formatTokens } from '../../../utils/agentCache';
import { CacheBadge } from '../CacheBadge';
import { LimitBar } from '../../UsageView/LimitBar';
import { WEEK_TICKS, weekPace } from '../../../utils/usage';

const POLL_MS = 15_000;

/**
 * TUI-like status line: branch with untracked (?) / changed (±) counts, prompt cache and
 * context, 5h / 7d plan limits. Refreshes while visible and after each finished turn.
 */
export const ChatStatusLine: React.FC<{ chatId: string; turns: number; visible: boolean }> = ({
  chatId,
  turns,
  visible,
}) => {
  const [status, setStatus] = useState<ChatStatus | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const load = () =>
      fetchChatStatus(chatId)
        .then((s) => !cancelled && setStatus(s))
        .catch(() => {
          // keep the last status; the chat itself reports a gone session
        });
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [chatId, turns, visible]);

  if (!status) return null;
  const { git, cache, limits } = status;
  const cold = cache && cacheCountdown(cache, Date.now()).expired;
  const fill = cache ? Math.min(100, (cache.cachedTokens / cache.contextWindow) * 100) : 0;

  return (
    <div className="mt-2 grid grid-cols-2 sm:grid-cols-[auto_minmax(9rem,1fr)_minmax(6rem,0.6fr)_minmax(9rem,1fr)] items-end gap-x-4 gap-y-2 text-xs text-gray-300">
      {git?.branch ? (
        <span
          className="flex items-center gap-1.5 font-mono self-center"
          title={`${git.untracked} untracked, ${git.changed} uncommitted changes${git.ahead || git.behind ? `, ${git.ahead} ahead, ${git.behind} behind` : ''}`}
        >
          <GitBranch size={13} aria-hidden className="text-gray-400" />
          <span className="text-gray-100 font-medium">{git.branch}</span>
          {git.untracked > 0 && <span className="text-amber-300">?{git.untracked}</span>}
          {git.changed > 0 && <span className="text-sky-300">±{git.changed}</span>}
          {git.ahead > 0 && <span className="text-emerald-300">↑{git.ahead}</span>}
          {git.behind > 0 && <span className="text-red-300">↓{git.behind}</span>}
          {!git.untracked && !git.changed && <span className="text-emerald-400">✓</span>}
        </span>
      ) : (
        <span />
      )}
      {cache ? (
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-gray-400">Context</span>
            <span className="tabular-nums text-gray-100">
              {formatTokens(cache.cachedTokens)} / {formatTokens(cache.contextWindow)} ·{' '}
              {Math.round(fill)} %
            </span>
          </div>
          <div
            role="meter"
            aria-label="Context window fill"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(fill)}
            className="mt-1 h-2 rounded-full bg-gray-800 overflow-hidden"
          >
            <div
              className={`h-full rounded-full ${fill > 80 ? 'bg-red-500' : fill > 60 ? 'bg-yellow-500' : 'bg-sky-500'} transition-[width] duration-300 motion-reduce:transition-none`}
              style={{ width: `${fill}%` }}
            />
          </div>
          <div className="mt-1 text-[11px] text-gray-500">
            {cold ? (
              <span title="Prompt cache expired: the next turn writes it again">cache cold</span>
            ) : (
              <CacheBadge cache={cache} context={false} />
            )}
          </div>
        </div>
      ) : (
        <span />
      )}
      {limits ? (
        <>
          {limits.fiveHour ? (
            <LimitBar label="5h" window={limits.fiveHour} unknownText="–" />
          ) : (
            <span />
          )}
          <LimitBar
            label="7 Tage"
            window={limits.weekly}
            unknownText="–"
            ticks={WEEK_TICKS}
            marker={weekPace()}
            markerLabel="Heute"
          />
        </>
      ) : null}
    </div>
  );
};
