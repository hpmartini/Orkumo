import React, { useEffect, useRef } from 'react';
import {
  CheckCircle2,
  CircleDashed,
  Code2,
  ExternalLink,
  GitPullRequest,
  X,
  XCircle,
} from 'lucide-react';
import type { AgentContext, AgentPullRequest, AgentSession } from '../../types';
import { formatAge, type PullRequestRow } from '../../utils/agentSessions';

/**
 * Popover behaviour shared by the summary-bar panels: focus moves in, Esc and
 * outside clicks close, focus returns to the trigger unless the user moved it elsewhere
 * (e.g. attached an agent). Non-modal on purpose: Tab may leave the panel.
 */
export function usePopover(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // activeElement is body in Safari/Firefox after a click, so find the trigger by its state
    const trigger = document.querySelector<HTMLElement>(
      '[data-popover-trigger][aria-expanded="true"]'
    );
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onClose();
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Triggers toggle the panel themselves
      if (ref.current?.contains(target) || target.closest('[data-popover-trigger]')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
      const focus = document.activeElement;
      if (!focus || focus === document.body || ref.current?.contains(focus)) trigger?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}

const CI: Record<AgentPullRequest['ci'], { label: string; icon: React.ReactNode; tone: string }> = {
  success: { label: 'Passing', icon: <CheckCircle2 size={12} />, tone: 'text-emerald-400' },
  failure: { label: 'Failing', icon: <XCircle size={12} />, tone: 'text-red-300' },
  pending: { label: 'Running', icon: <CircleDashed size={12} />, tone: 'text-yellow-400' },
  none: { label: 'No checks', icon: <CircleDashed size={12} />, tone: 'text-gray-500' },
};

function mergeState(pr: AgentPullRequest): { label: string; tone: string } {
  if (pr.mergeable === 'CONFLICTING') return { label: 'Conflicts', tone: 'text-red-300' };
  if (pr.mergeReady) return { label: 'Ready to merge', tone: 'text-emerald-400' };
  if (pr.mergeable === 'UNKNOWN') return { label: 'Checking', tone: 'text-gray-400' };
  return { label: 'Blocked', tone: 'text-yellow-400' };
}

const REVIEW: Record<string, string> = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  REVIEW_REQUIRED: 'Review required',
};

interface PullRequestsPanelProps {
  rows: PullRequestRow[];
  sessions: AgentSession[];
  contexts: Record<string, AgentContext | undefined>;
  /** Only show this repo ("owner/repo") */
  repoFilter: string | null;
  onClearRepo: () => void;
  onSelectAgent: (id: string) => void;
  /** Opens the Code mode in the PR branch's worktree (or the repo) */
  onOpenCode: (row: PullRequestRow) => void;
  onClose: () => void;
}

export const PullRequestsPanel: React.FC<PullRequestsPanelProps> = ({
  rows,
  sessions,
  contexts,
  repoFilter,
  onClearRepo,
  onSelectAgent,
  onOpenCode,
  onClose,
}) => {
  const ref = usePopover(onClose);
  const loading = Object.keys(contexts).length === 0;
  const shown = repoFilter ? rows.filter((r) => r.pr.repoSlug === repoFilter) : rows;
  // pulls === null means gh could not answer for that repo; never show it as 0
  const unavailable = [
    ...new Set(
      sessions
        .map((s) => contexts[s.id])
        .filter((c): c is AgentContext => !!c?.repo?.slug && c.pulls === null)
        .map((c) => c.repo!.slug!)
    ),
  ].filter((name) => !repoFilter || name === repoFilter);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label="Open pull requests"
      className="absolute right-4 top-full mt-1 z-40 w-[min(900px,calc(100vw-2rem))] max-h-[70vh] flex flex-col bg-gray-900 border border-gray-700 rounded-lg shadow-2xl outline-none"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 shrink-0 text-sm">
        <GitPullRequest size={14} className="text-gray-400" />
        <span className="font-medium">Open pull requests</span>
        <span className="text-gray-500 tabular-nums text-xs">{shown.length}</span>
        {repoFilter && (
          <button
            onClick={onClearRepo}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-blue-300 hover:text-white hover:bg-gray-800"
            title="Show all repositories"
          >
            {repoFilter} <X size={10} />
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={onClose}
          aria-label="Close"
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800"
        >
          <X size={14} />
        </button>
      </div>
      <div className="overflow-y-auto min-h-0">
        {loading ? (
          <p className="px-3 py-4 text-xs text-gray-500">Loading pull requests…</p>
        ) : shown.length === 0 ? (
          <p className="px-3 py-4 text-xs text-gray-500">
            No open pull requests{repoFilter ? ` in ${repoFilter}` : ''}.
          </p>
        ) : (
          <ul className="divide-y divide-gray-800">
            {shown.map((row) => {
              const { pr, agents } = row;
              const ci = CI[pr.ci];
              const merge = mergeState(pr);
              return (
                <li key={`${pr.repoSlug}#${pr.number}`} className="px-3 py-2 text-xs space-y-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-gray-500 shrink-0">{pr.repoSlug}</span>
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 min-w-0 text-gray-100 hover:text-blue-300 hover:underline"
                    >
                      <span className="font-mono shrink-0">#{pr.number}</span>
                      <span className="truncate">{pr.title}</span>
                      <ExternalLink size={10} className="shrink-0" />
                    </a>
                    {pr.isDraft && (
                      <span className="px-1 rounded border border-gray-600 text-gray-400 shrink-0">
                        Draft
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-gray-400">
                    <span className={`flex items-center gap-1 ${ci.tone}`}>
                      {ci.icon}
                      {ci.label}
                      {pr.ci !== 'none' && (
                        <span className="tabular-nums text-gray-500">
                          {pr.ciPassed} passed, {pr.ciFailed} failed, {pr.ciPending} pending
                        </span>
                      )}
                    </span>
                    <span className={merge.tone}>{merge.label}</span>
                    {pr.reviewDecision && <span>{REVIEW[pr.reviewDecision]}</span>}
                    {pr.author && <span>by {pr.author}</span>}
                    <span className="tabular-nums" title={pr.updatedAt}>
                      updated {formatAge(Date.now() - Date.parse(pr.updatedAt))} ago
                    </span>
                    <span className="font-mono text-gray-500 truncate max-w-[16rem]">
                      {pr.headRef} to {pr.baseRef}
                    </span>
                    {agents.map((agent) => (
                      <button
                        key={agent.id}
                        onClick={() => {
                          onSelectAgent(agent.id);
                          onClose();
                        }}
                        className="px-1.5 rounded text-blue-300 hover:text-white hover:bg-gray-800"
                        title="Select this agent"
                      >
                        {agent.name}
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        onOpenCode(row);
                        onClose();
                      }}
                      className="flex items-center gap-1 px-1.5 rounded text-gray-300 hover:text-white hover:bg-gray-800"
                      title="Open the branch in Code mode (agent worktree, else the repo)"
                    >
                      <Code2 size={11} /> Code
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {unavailable.length > 0 && (
          <p className="px-3 py-2 text-[11px] text-yellow-400/90 border-t border-gray-800">
            Pull requests unavailable (gh missing, not signed in or no access):{' '}
            {unavailable.join(', ')}
          </p>
        )}
      </div>
    </div>
  );
};
