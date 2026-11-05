import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useSearchParams } from 'react-router-dom';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, GitPullRequest, RotateCcw } from 'lucide-react';
import type { AgentPullRequest } from '../../types';
import { BrowserPane } from './AgentWorkspace';
import { PullRequestList, type PullRequestListProps } from './PullRequestsPanel';
import { getLinkTarget, openLink } from '../../utils/links';
import {
  CI_LABELS,
  FILTER_RESET,
  GROUP_LABELS,
  MERGE_LABELS,
  REVIEW_LABELS,
  SORT_LABELS,
  hasFilters,
  parsePullQuery,
  patchPullParams,
  pullOptions,
  queryPulls,
  type PullQuery,
} from '../../utils/pullRequestQuery';

/** Filters, grouping and sorting live in the URL of /pulls (#191), not in these props */
export type PullRequestsPageProps = Omit<
  PullRequestListProps,
  'onOpenPr' | 'openUrl' | 'onDone' | 'repoFilter' | 'groups'
>;

/** PR data and handlers, provided by AgentsView around the main area of the other routes */
export const PullRequestsDataContext = createContext<PullRequestsPageProps | null>(null);

/** /pulls container in App.tsx: reads the PR data AgentsView already holds (no second data path) */
export const ConnectedPullRequestsPage: React.FC = () => {
  const data = useContext(PullRequestsDataContext);
  return data ? <PullRequestsPage {...data} /> : null;
};

const noop = () => {};

const SELECT_CLS =
  'bg-gray-850 border border-gray-700 rounded px-2 py-1 text-gray-200 text-xs max-w-[12rem] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor';
const ICON_BTN =
  'flex items-center gap-1 px-1.5 py-1 rounded text-xs text-gray-300 hover:text-white hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor';

type Options = Record<string, string>;
const asOptions = (values: string[]): Options => Object.fromEntries(values.map((v) => [v, v]));
const YES_NO: Options = { yes: 'Yes', no: 'No' };

/** One select filter; the empty option means "any" */
const Filter: React.FC<{
  label: string;
  value: string | null;
  options: Options;
  onChange: (value: string | null) => void;
}> = ({ label, value, options, onChange }) => (
  <select
    aria-label={label}
    value={value ?? ''}
    onChange={(e) => onChange(e.target.value || null)}
    className={`${SELECT_CLS} ${value ? 'border-blue-500/70 text-white' : ''}`}
  >
    <option value="">{label}: any</option>
    {Object.entries(options).map(([key, text]) => (
      <option key={key} value={key}>
        {text}
      </option>
    ))}
    {/* A value from the URL that no PR has (any more) stays visible and clearable */}
    {value && !Object.hasOwn(options, value) && <option value={value}>{value}</option>}
  </select>
);

/** Select over a fixed set of keys; the setter receives the key typed like the query field */
function keyed<K extends keyof PullQuery>(
  update: (patch: Partial<PullQuery>) => void,
  key: K
): (value: string | null) => void {
  return (value) => update({ [key]: value } as Partial<PullQuery>);
}

/**
 * Full view of the open PRs (route /pulls) with filters, clusters and sorting in the URL.
 * A PR opens in one split pane to the right; the next PR replaces it.
 * Without Electron GitHub refuses to be framed, so PRs open in a tab.
 */
export const PullRequestsPage: React.FC<PullRequestsPageProps> = (props) => {
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  const canEmbed = typeof window !== 'undefined' && !!window.electronAPI?.browserView;
  const viewRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parsePullQuery(params), [params]);
  const { shown, groups } = useMemo(() => queryPulls(props.rows, query), [props.rows, query]);
  const options = useMemo(() => pullOptions(props.rows), [props.rows]);
  const filtered = hasFilters(query);
  // Typing replaces the history entry; every other change is one Back step
  const update = (patch: Partial<PullQuery>, replace = false) =>
    setParams((prev) => patchPullParams(prev, patch), { replace });

  // Arriving from the popover: its trigger is hidden here, so focus lands on the view
  useEffect(() => viewRef.current?.focus(), []);

  const openPr = (pr: AgentPullRequest) => {
    if (!pr.url.startsWith('https://')) return;
    // Only GitHub pages load in the embedded browser; narrow windows (md breakpoint) and other hosts open externally
    if (
      canEmbed &&
      getLinkTarget() === 'builtin' &&
      pr.url.startsWith('https://github.com/') &&
      window.innerWidth >= 768
    ) {
      setOpenUrl(pr.url);
    } else openLink(pr.url);
  };

  return (
    <div
      ref={viewRef}
      tabIndex={-1}
      aria-label="Open pull requests"
      className="absolute inset-0 flex flex-col min-h-0 bg-gray-900 outline-none"
      data-pulls-view
    >
      {/* The list panel stays mounted when the pane opens or closes, so scroll and focus survive */}
      <Group orientation="horizontal" className="h-full w-full">
        {/* v4: plain numbers are pixels, so sizes are given in percent */}
        <Panel id="pulls-list" minSize="20%" defaultSize="40%" className="min-h-0 min-w-0">
          <div className="h-full flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-gray-800 shrink-0 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <GitPullRequest size={14} className="text-gray-400" aria-hidden />
                <span className="font-medium">Open pull requests</span>
                <span className="text-gray-500 tabular-nums text-xs" data-testid="pulls-count">
                  {filtered ? `${shown.length} of ${props.rows.length}` : props.rows.length}
                </span>
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
              </div>
              <div
                role="toolbar"
                aria-label="Filter, group and sort pull requests"
                className="flex flex-wrap items-center gap-1.5"
              >
                <input
                  ref={searchRef}
                  type="search"
                  aria-label="Search pull requests"
                  placeholder="Title, #number, branch, author"
                  value={query.q}
                  onChange={(e) => update({ q: e.target.value }, true)}
                  className={`${SELECT_CLS} w-56 placeholder:text-gray-500`}
                />
                <Filter
                  label="Repo"
                  value={query.repo}
                  options={asOptions(options.repos)}
                  onChange={keyed(update, 'repo')}
                />
                <Filter
                  label="CI"
                  value={query.ci}
                  options={CI_LABELS}
                  onChange={keyed(update, 'ci')}
                />
                <Filter
                  label="Merge"
                  value={query.merge}
                  options={MERGE_LABELS}
                  onChange={keyed(update, 'merge')}
                />
                <Filter
                  label="Review"
                  value={query.review}
                  options={REVIEW_LABELS}
                  onChange={keyed(update, 'review')}
                />
                <Filter
                  label="Draft"
                  value={query.draft}
                  options={YES_NO}
                  onChange={keyed(update, 'draft')}
                />
                <Filter
                  label="Author"
                  value={query.author}
                  options={asOptions(options.authors)}
                  onChange={keyed(update, 'author')}
                />
                <Filter
                  label="Base"
                  value={query.base}
                  options={asOptions(options.bases)}
                  onChange={keyed(update, 'base')}
                />
                <Filter
                  label="Has agent"
                  value={query.agent}
                  options={YES_NO}
                  onChange={keyed(update, 'agent')}
                />
                <span className="w-px h-4 bg-gray-700 mx-1" aria-hidden />
                <select
                  aria-label="Group by"
                  value={query.group}
                  onChange={(e) => keyed(update, 'group')(e.target.value)}
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
                  onChange={(e) => keyed(update, 'sort')(e.target.value)}
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
            <div className="flex-1 overflow-y-auto min-h-0">
              <PullRequestList
                {...props}
                repoFilter={query.repo}
                groups={groups}
                onOpenPr={openPr}
                openUrl={openUrl}
              />
            </div>
          </div>
        </Panel>
        {openUrl && (
          <>
            <Separator className="w-1 cursor-col-resize bg-gray-800 hover:bg-blue-500/50 transition-colors" />
            <Panel id="pulls-pr" minSize="20%" className="min-h-0 min-w-0 p-1">
              <BrowserPane url={openUrl} active onFocus={noop} onClose={() => setOpenUrl(null)} />
            </Panel>
          </>
        )}
      </Group>
    </div>
  );
};
