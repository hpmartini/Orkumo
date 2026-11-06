import React, { useEffect, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { fetchChatStatus, type ChatStatus } from '../../../services/agentsApi';
import { cacheCountdown, formatTokens } from '../../../utils/agentCache';
import { CacheBadge } from '../CacheBadge';
import { LimitBar } from '../../UsageView/LimitBar';

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

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400">
      {git?.branch && (
        <span
          className="flex items-center gap-1 font-mono"
          title={`${git.untracked} untracked, ${git.changed} uncommitted changes${git.ahead || git.behind ? `, ${git.ahead} ahead, ${git.behind} behind` : ''}`}
        >
          <GitBranch size={11} aria-hidden className="text-gray-500" />
          <span className="text-gray-200">{git.branch}</span>
          {git.untracked > 0 && <span className="text-amber-300">?{git.untracked}</span>}
          {git.changed > 0 && <span className="text-sky-300">±{git.changed}</span>}
          {git.ahead > 0 && <span className="text-emerald-300">↑{git.ahead}</span>}
          {git.behind > 0 && <span className="text-red-300">↓{git.behind}</span>}
          {!git.untracked && !git.changed && <span className="text-emerald-400">✓</span>}
        </span>
      )}
      {cache &&
        (cold ? (
          <span
            className="tabular-nums"
            title="Prompt cache expired: the next turn writes it again"
          >
            cache cold · {formatTokens(cache.cachedTokens)} ·{' '}
            {Math.round((cache.cachedTokens / cache.contextWindow) * 100)}% context
          </span>
        ) : (
          <CacheBadge cache={cache} />
        ))}
      {limits && (
        <span className="flex items-center gap-3">
          {limits.fiveHour && (
            <span className="w-20">
              <LimitBar label="5h" window={limits.fiveHour} compact unknownText="–" />
            </span>
          )}
          <span className="w-20">
            <LimitBar label="7d" window={limits.weekly} compact unknownText="–" />
          </span>
        </span>
      )}
    </div>
  );
};
