import React, { useEffect, useRef } from 'react';
import {
  CheckCircle2,
  CircleDashed,
  Code2,
  ExternalLink,
  GitPullRequest,
  Maximize2,
  X,
  XCircle,
} from 'lucide-react';
import type { AgentContext, AgentPullRequest, AgentSession } from '../../types';
import { formatAge, type PullRequestRow } from '../../utils/agentSessions';
import {
  MERGE_LABELS,
  mergeKey,
  type MergeKey,
  type PullGroup,
} from '../../utils/pullRequestQuery';

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

const MERGE_TONE: Record<MergeKey, string> = {
  ready: 'text-emerald-400',
  blocked: 'text-yellow-400',
  checking: 'text-gray-400',
  conflicts: 'text-red-300',
};

function mergeState(pr: AgentPullRequest): { label: string; tone: string } {
  const key = mergeKey(pr);
  return { label: MERGE_LABELS[key], tone: MERGE_TONE[key] };
}

const REVIEW: Record<string, string> = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  REVIEW_REQUIRED: 'Review required',
};

export const filterPullRows = (rows: PullRequestRow[], repoFilter: string | null) =>
  repoFilter ? rows.filter((r) => r.pr.repoSlug === repoFilter) : rows;

export interface PullRequestListProps {
  rows: PullRequestRow[];
  sessions: AgentSession[];
  contexts: Record<string, AgentContext | undefined>;
  /** Only show this repo ("owner/repo") */
  repoFilter: string | null;
  onSelectAgent: (id: string) => void;
  /** Opens the Code mode in the PR branch's worktree (or the repo) */
  onOpenCode: (row: PullRequestRow) => void;
  /** Set: the PR title opens in the app and only the icon links out */
  onOpenPr?: (pr: AgentPullRequest) => void;
  /** URL of the PR open next to the list, highlighted */
  openUrl?: string | null;
  /** Called after an action that leaves the list (agent, code) */
  onDone?: () => void;
  /** Set (full view): render these clusters instead of `rows`, already filtered and sorted */
  groups?: PullGroup[];
}

/** PR rows shared by the summary-bar popover and the full /pulls view */
export const PullRequestList: React.FC<PullRequestListProps> = ({
  rows,
  sessions,
  contexts,
  repoFilter,
  onSelectAgent,
  onOpenCode,
  onOpenPr,
  openUrl,
  onDone,
  groups,
}) => {
  const loading = Object.keys(contexts).length === 0;
  const shown = groups ? groups.flatMap((g) => g.rows) : filterPullRows(rows, repoFilter);
  // pulls === null means gh could not answer for that repo; never show it as 0
  const unavailable = [
    ...new Set(
      sessions
        .map((s) => contexts[s.id])
        .filter((c): c is AgentContext => !!c?.repo?.slug && c.pulls === null)
        .map((c) => c.repo!.slug!)
    ),
  ].filter((name) => !repoFilter || name.toLowerCase() === repoFilter.toLowerCase());

  const renderRow = (row: PullRequestRow, groupKey: string) => {
    const { pr, agents } = row;
    const ci = CI[pr.ci];
    const merge = mergeState(pr);
    const isOpen = !!openUrl && openUrl === pr.url;
    return (
      <li
        key={`${groupKey}:${pr.repoSlug}#${pr.number}`}
        className={`px-3 py-2 text-xs space-y-1 ${isOpen ? 'bg-gray-800/60' : ''}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-gray-500 shrink-0">{pr.repoSlug}</span>
          {onOpenPr ? (
            <>
              <button
                onClick={() => onOpenPr(pr)}
                aria-current={isOpen || undefined}
                className="flex items-center gap-1 min-w-0 text-left text-gray-100 hover:text-blue-300 hover:underline"
                title="Open next to the list"
              >
                <span className="font-mono shrink-0">#{pr.number}</span>
                <span className="truncate">{pr.title}</span>
              </button>
              <a
                href={pr.url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-gray-400 hover:text-blue-300"
                title="Open in browser"
                aria-label={`Open #${pr.number} in browser`}
              >
                <ExternalLink size={10} />
              </a>
            </>
          ) : (
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
          )}
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
                onDone?.();
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
              onDone?.();
            }}
            className="flex items-center gap-1 px-1.5 rounded text-gray-300 hover:text-white hover:bg-gray-800"
            title="Open the branch in Code mode (agent worktree, else the repo)"
          >
            <Code2 size={11} /> Code
          </button>
        </div>
      </li>
    );
  };
  const list = (items: PullRequestRow[], groupKey = '') => (
    <ul className="divide-y divide-gray-800">{items.map((row) => renderRow(row, groupKey))}</ul>
  );
  const clustered = !!groups && !(groups.length === 1 && groups[0].key === 'all');

  return (
    <>
      {loading ? (
        <p className="px-3 py-4 text-xs text-gray-500">Loading pull requests…</p>
      ) : shown.length === 0 ? (
        <p className="px-3 py-4 text-xs text-gray-500">
          {groups && rows.length > 0
            ? 'No pull requests match the filters.'
            : `No open pull requests${repoFilter ? ` in ${repoFilter}` : ''}.`}
        </p>
      ) : groups && clustered ? (
        groups.map((g) => (
          <section key={g.key || '-'} aria-label={`${g.label} (${g.rows.length})`}>
            <h3 className="sticky top-0 z-[1] flex items-center gap-2 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-400 bg-gray-850 border-y border-gray-800">
              {g.label}
              <span className="tabular-nums text-gray-500">{g.rows.length}</span>
            </h3>
            {list(g.rows, g.key)}
          </section>
        ))
      ) : (
        list(shown)
      )}
      {unavailable.length > 0 && (
        <p className="px-3 py-2 text-[11px] text-yellow-400/90 border-t border-gray-800">
          Pull requests unavailable (gh missing, not signed in or no access):{' '}
          {unavailable.join(', ')}
        </p>
      )}
    </>
  );
};

/** Title row with count and repo filter; children are the trailing buttons */
export const PullRequestsHeader: React.FC<{
  count: number;
  repoFilter: string | null;
  onClearRepo: () => void;
  children?: React.ReactNode;
}> = ({ count, repoFilter, onClearRepo, children }) => (
  <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 shrink-0 text-sm">
    <GitPullRequest size={14} className="text-gray-400" />
    <span className="font-medium">Open pull requests</span>
    <span className="text-gray-500 tabular-nums text-xs">{count}</span>
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
    {children}
  </div>
);

interface PullRequestsPanelProps extends Omit<
  PullRequestListProps,
  'onOpenPr' | 'openUrl' | 'onDone'
> {
  onClearRepo: () => void;
  /** Opens the list as its own view in the content panel */
  onMaximize: () => void;
  onClose: () => void;
}

export const PullRequestsPanel: React.FC<PullRequestsPanelProps> = ({
  onClearRepo,
  onMaximize,
  onClose,
  ...list
}) => {
  const ref = usePopover(onClose);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label="Open pull requests"
      className="absolute right-4 top-full mt-1 z-40 w-[min(900px,calc(100vw-2rem))] max-h-[70vh] flex flex-col bg-gray-900 border border-gray-700 rounded-lg shadow-2xl outline-none"
    >
      <PullRequestsHeader
        count={filterPullRows(list.rows, list.repoFilter).length}
        repoFilter={list.repoFilter}
        onClearRepo={onClearRepo}
      >
        <button
          onClick={() => {
            onMaximize();
            onClose();
          }}
          aria-label="Maximize pull requests"
          title="Open as full view"
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800"
        >
          <Maximize2 size={14} />
        </button>
        <button
          onClick={onClose}
          aria-label="Close"
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800"
        >
          <X size={14} />
        </button>
      </PullRequestsHeader>
      <div className="overflow-y-auto min-h-0">
        <PullRequestList {...list} onDone={onClose} />
      </div>
    </div>
  );
};
