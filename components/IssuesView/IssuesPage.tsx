import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  CircleDot,
  Milestone,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  User,
} from 'lucide-react';
import type { AgentSession, IssueListResponse, RepoIssue } from '../../types';
import { fetchIssues } from '../../services/issuesApi';
import { formatAge } from '../../utils/agentSessions';
import { issueKey, shortRepo } from '../../utils/board';
import {
  BOARD_LABELS,
  FILTER_RESET,
  GROUP_LABELS,
  SORT_LABELS,
  STATE_LABELS,
  hasFilters,
  issueOptions,
  parseIssueQuery,
  patchIssueParams,
  queryIssues,
  type IssueQuery,
} from '../../utils/issueQuery';
import {
  Filter,
  ICON_BTN,
  PullRequestsDataContext,
  SELECT_CLS,
  asOptions,
} from '../AgentsView/PullRequestsPage';
import { IssueModal } from '../BoardView/IssueModal';
import { LabelChip } from '../BoardView/BoardCard';

const POLL_MS = 60_000;
const NO_SESSIONS: AgentSession[] = [];

export interface IssuesPageProps {
  /** Visible; polls only then */
  active: boolean;
  /** Project context whose repos are listed; undefined = the server's active context */
  contextId?: string;
  /** Agent sessions for the issue modal's agent links */
  sessions: AgentSession[];
}

/** /issues container in App.tsx: the sessions come from AgentsView's PR data, if provided */
export const ConnectedIssuesPage: React.FC<Omit<IssuesPageProps, 'sessions'>> = (props) => {
  const data = useContext(PullRequestsDataContext);
  return <IssuesPage {...props} sessions={data?.sessions ?? NO_SESSIONS} />;
};

const IssueRow: React.FC<{ issue: RepoIssue; onOpen: (issue: RepoIssue) => void }> = ({
  issue,
  onOpen,
}) => (
  <li>
    <button
      type="button"
      onClick={() => onOpen(issue)}
      aria-label={`${issue.repo}#${issue.number} ${issue.title}`}
      className="w-full text-left px-3 py-1.5 flex items-start gap-2 hover:bg-gray-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cursor"
      data-issue-row
    >
      <CircleDot
        size={13}
        aria-hidden
        className={`mt-0.5 shrink-0 ${issue.state === 'open' ? 'text-emerald-400' : 'text-purple-400'}`}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs text-gray-500 shrink-0" title={issue.repo}>
            {shortRepo(issue.repo)}
          </span>
          <span className="text-xs text-gray-500 tabular-nums shrink-0">#{issue.number}</span>
          <span className="text-sm text-gray-100 truncate">{issue.title}</span>
          {issue.onBoard && (
            <span
              className="shrink-0 px-1 rounded border border-blue-500/50 text-blue-300 text-[10px] leading-4"
              title="On the board"
            >
              Board
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-gray-500">
          {issue.labels.length > 0 && (
            <span className="flex flex-wrap gap-1">
              {issue.labels.map((l) => (
                <LabelChip key={l.name} label={l} />
              ))}
            </span>
          )}
          {issue.assignees.length > 0 && (
            <span className="flex items-center gap-0.5" title="Assignees">
              <User size={11} aria-hidden /> {issue.assignees.join(', ')}
            </span>
          )}
          {issue.milestone && (
            <span className="flex items-center gap-0.5" title="Milestone">
              <Milestone size={11} aria-hidden /> {issue.milestone}
            </span>
          )}
          {issue.comments > 0 && (
            <span className="flex items-center gap-0.5 tabular-nums" title="Comments">
              <MessageSquare size={11} aria-hidden /> {issue.comments}
            </span>
          )}
          <span className="tabular-nums" title={issue.updatedAt}>
            updated {formatAge(Date.now() - Date.parse(issue.updatedAt))} ago
          </span>
        </span>
      </span>
    </button>
  </li>
);

/**
 * Issues mode (route /issues): the issues of the active context's repos, straight from GitHub,
 * so issues outside the board's project show up too. Filters, grouping, sorting and the
 * open/closed state live in the URL. A row opens the issue modal.
 */
export const IssuesPage: React.FC<IssuesPageProps> = ({ active, contextId, sessions }) => {
  const viewRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseIssueQuery(params), [params]);
  const loadKey = `${contextId ?? ''}|${query.state}`;
  // The response with the context/state it was loaded for; another key's list is never shown
  const [loaded, setLoaded] = useState<{ key: string; data: IssueListResponse } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const latest = useRef(0);

  const data = loaded?.key === loadKey ? loaded.data : null;
  const issues = useMemo(() => data?.issues ?? [], [data]);
  const { shown, groups } = useMemo(() => queryIssues(issues, query), [issues, query]);
  const options = useMemo(() => issueOptions(issues), [issues]);
  const filtered = hasFilters(query);
  // Typing replaces the history entry; every other change is one Back step
  const update = (patch: Partial<IssueQuery>, replace = false) =>
    setParams((prev) => patchIssueParams(prev, patch), { replace });
  const select =
    <K extends keyof IssueQuery>(key: K) =>
    (value: string | null) =>
      update({ [key]: value } as Partial<IssueQuery>);

  const load = useCallback(
    (refresh = false) => {
      const id = ++latest.current;
      setLoading(true);
      fetchIssues(contextId, query.state, refresh)
        .then((next) => {
          if (id !== latest.current) return;
          setLoaded({ key: loadKey, data: next });
          setError(null);
        })
        .catch((err: unknown) => {
          if (id === latest.current) setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (id === latest.current) setLoading(false);
        });
    },
    [contextId, query.state, loadKey]
  );

  useEffect(() => {
    if (!active) return;
    load();
    const timer = setInterval(() => load(), POLL_MS);
    return () => clearInterval(timer);
  }, [active, load]);

  // Switching to the mode puts the keyboard on the view, like /pulls
  useEffect(() => {
    if (active) viewRef.current?.focus();
  }, [active]);

  const openIssue = (issue: RepoIssue) => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setOpenKey(issueKey(issue.repo, issue.number));
  };
  const closeIssue = () => {
    setOpenKey(null);
    returnFocus.current?.focus();
  };

  let body: React.ReactNode;
  if (!data && error) body = null;
  else if (!data) body = <p className="px-3 py-6 text-sm text-gray-500">Loading issues…</p>;
  else if (data.repos.length === 0)
    body = (
      <p className="px-3 py-6 text-sm text-gray-500">No GitHub repositories in this context.</p>
    );
  else if (shown.length === 0)
    body = <p className="px-3 py-6 text-sm text-gray-500">No issues match</p>;
  else
    body = groups.map((g) => (
      <section key={g.key} aria-label={query.group === 'none' ? 'Issues' : g.label}>
        {query.group !== 'none' && (
          <h3 className="sticky top-0 z-[1] px-3 py-1 text-xs font-medium text-gray-400 bg-gray-900/95 border-b border-gray-800 flex items-center gap-2">
            {g.label}
            <span className="text-gray-600 tabular-nums">{g.issues.length}</span>
          </h3>
        )}
        <ul className="divide-y divide-gray-800/70">
          {g.issues.map((issue) => (
            <IssueRow key={issue.id} issue={issue} onOpen={openIssue} />
          ))}
        </ul>
      </section>
    ));

  return (
    <div
      ref={viewRef}
      tabIndex={-1}
      aria-label="Issues"
      className="absolute inset-0 flex flex-col min-h-0 bg-gray-900 outline-none"
      data-issues-view
    >
      <div className="px-3 py-2 border-b border-gray-800 shrink-0 space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <CircleDot size={14} className="text-gray-400" aria-hidden />
          <span className="font-medium">Issues</span>
          <span className="text-gray-500 tabular-nums text-xs" data-testid="issues-count">
            {filtered ? `${shown.length} of ${issues.length}` : issues.length}
          </span>
          {data && (
            <span className="text-gray-600 text-xs">
              in {data.repos.length} {data.repos.length === 1 ? 'repo' : 'repos'}
            </span>
          )}
          <div className="flex-1" />
          {filtered && (
            <button
              onClick={() => {
                update(FILTER_RESET);
                // the button unmounts once no filter is left; keep focus in the toolbar
                searchRef.current?.focus();
              }}
              className={ICON_BTN}
            >
              <RotateCcw size={11} aria-hidden /> Reset filters
            </button>
          )}
          <button
            onClick={() => load(true)}
            disabled={loading}
            aria-label="Refresh issues"
            title="Refresh"
            className={`${ICON_BTN} disabled:opacity-60`}
          >
            <RefreshCw size={12} aria-hidden className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <div
          role="toolbar"
          aria-label="Filter, group and sort issues"
          className="flex flex-wrap items-center gap-1.5"
        >
          <input
            ref={searchRef}
            type="search"
            aria-label="Search issues"
            placeholder="Title, #number, label"
            value={query.q}
            onChange={(e) => update({ q: e.target.value }, true)}
            className={`${SELECT_CLS} w-56 placeholder:text-gray-500`}
          />
          <select
            aria-label="State"
            value={query.state}
            onChange={(e) => select('state')(e.target.value)}
            className={SELECT_CLS}
          >
            {Object.entries(STATE_LABELS).map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
          <Filter
            label="Repo"
            value={query.repo}
            options={asOptions(options.repos)}
            onChange={select('repo')}
          />
          <Filter
            label="Label"
            value={query.label}
            options={asOptions(options.labels)}
            onChange={select('label')}
          />
          <Filter
            label="Assignee"
            value={query.assignee}
            options={asOptions(options.assignees)}
            onChange={select('assignee')}
          />
          <Filter
            label="Milestone"
            value={query.milestone}
            options={asOptions(options.milestones)}
            onChange={select('milestone')}
          />
          <Filter
            label="Author"
            value={query.author}
            options={asOptions(options.authors)}
            onChange={select('author')}
          />
          <Filter
            label="Board"
            value={query.board}
            options={BOARD_LABELS}
            onChange={select('board')}
          />
          <span className="w-px h-4 bg-gray-700 mx-1" aria-hidden />
          <select
            aria-label="Group by"
            value={query.group}
            onChange={(e) => select('group')(e.target.value)}
            className={SELECT_CLS}
          >
            {Object.entries(GROUP_LABELS).map(([key, text]) => (
              <option key={key} value={key}>
                {key === 'none' ? text : `Group: ${text}`}
              </option>
            ))}
          </select>
          <select
            aria-label="Sort by"
            value={query.sort}
            onChange={(e) => select('sort')(e.target.value)}
            className={SELECT_CLS}
          >
            {Object.entries(SORT_LABELS).map(([key, text]) => (
              <option key={key} value={key}>
                Sort: {text}
              </option>
            ))}
          </select>
          <button
            onClick={() => update({ dir: query.dir === 'asc' ? 'desc' : 'asc' })}
            aria-label={query.dir === 'asc' ? 'Sort ascending' : 'Sort descending'}
            title={query.dir === 'asc' ? 'Ascending' : 'Descending'}
            className={ICON_BTN}
          >
            {query.dir === 'asc' ? (
              <ArrowUpNarrowWide size={13} aria-hidden />
            ) : (
              <ArrowDownWideNarrow size={13} aria-hidden />
            )}
          </button>
        </div>
      </div>
      {(error || (data?.errors.length ?? 0) > 0) && (
        <div
          role="alert"
          className="px-3 py-1.5 border-b border-gray-800 text-xs text-amber-300 space-y-0.5 shrink-0"
        >
          {error && (
            <p className="flex items-center gap-1.5">
              <AlertTriangle size={12} aria-hidden /> Could not load issues: {error}
            </p>
          )}
          {data?.errors.map((e) => (
            <p key={e.repo} className="flex items-center gap-1.5">
              <AlertTriangle size={12} aria-hidden /> {e.repo}: {e.message}
            </p>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-y-auto min-h-0">{body}</div>
      {openKey && <IssueModal issueKey={openKey} sessions={sessions} onClose={closeIssue} />}
    </div>
  );
};
