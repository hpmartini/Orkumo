/**
 * Filter, cluster and sort the open PRs of the /pulls view (#191). Pure; the state lives in
 * the URL search params, so every value read from there is checked against the known options.
 */
import type { AgentPullRequest } from '../types';
import type { PullRequestRow } from './agentSessions';

export type CiKey = AgentPullRequest['ci'];
export type MergeKey = 'ready' | 'blocked' | 'checking' | 'conflicts';
export type ReviewKey = 'approved' | 'changes' | 'required' | 'none';
export type YesNo = 'yes' | 'no';
export type GroupKey = 'none' | 'repo' | 'merge' | 'ci' | 'review' | 'author' | 'agent';
export type SortKey = 'updated' | 'ready' | 'number' | 'title' | 'repo';
export type SortDir = 'asc' | 'desc';

export interface PullQuery {
  /** Free text: title, number, head branch, author */
  q: string;
  repo: string | null;
  ci: CiKey | null;
  merge: MergeKey | null;
  review: ReviewKey | null;
  draft: YesNo | null;
  author: string | null;
  base: string | null;
  /** PR has (yes) or lacks (no) an agent on its head branch */
  agent: YesNo | null;
  group: GroupKey;
  sort: SortKey;
  dir: SortDir;
}

export const CI_LABELS: Record<CiKey, string> = {
  success: 'Passing',
  failure: 'Failing',
  pending: 'Running',
  none: 'No checks',
};
export const MERGE_LABELS: Record<MergeKey, string> = {
  ready: 'Ready to merge',
  blocked: 'Blocked',
  checking: 'Checking',
  conflicts: 'Conflicts',
};
export const REVIEW_LABELS: Record<ReviewKey, string> = {
  approved: 'Approved',
  changes: 'Changes requested',
  required: 'Review required',
  none: 'No review',
};
export const GROUP_LABELS: Record<GroupKey, string> = {
  none: 'No grouping',
  repo: 'Repository',
  merge: 'Merge state',
  ci: 'CI',
  review: 'Review',
  author: 'Author',
  agent: 'Agent',
};
export const SORT_LABELS: Record<SortKey, string> = {
  updated: 'Last updated',
  ready: 'Ready to merge first',
  number: 'Number',
  title: 'Title',
  repo: 'Repository',
};

export const DEFAULT_QUERY: PullQuery = {
  q: '',
  repo: null,
  ci: null,
  merge: null,
  review: null,
  draft: null,
  author: null,
  base: null,
  agent: null,
  group: 'none',
  sort: 'updated',
  dir: 'desc',
};

export function mergeKey(pr: AgentPullRequest): MergeKey {
  if (pr.mergeable === 'CONFLICTING') return 'conflicts';
  if (pr.mergeReady) return 'ready';
  if (pr.mergeable === 'UNKNOWN') return 'checking';
  return 'blocked';
}

export function reviewKey(pr: AgentPullRequest): ReviewKey {
  if (pr.reviewDecision === 'APPROVED') return 'approved';
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes';
  if (pr.reviewDecision === 'REVIEW_REQUIRED') return 'required';
  return 'none';
}

const pick = <T extends string>(value: string | null, allowed: Record<T, unknown>): T | null =>
  value !== null && Object.hasOwn(allowed, value) ? (value as T) : null;
const YES_NO = { yes: 1, no: 1 };

/** URL params -> query; unknown or invalid values fall back to the defaults */
export function parsePullQuery(params: URLSearchParams): PullQuery {
  return {
    q: params.get('q') ?? '',
    repo: params.get('repo') || null,
    ci: pick(params.get('ci'), CI_LABELS),
    merge: pick(params.get('merge'), MERGE_LABELS),
    review: pick(params.get('review'), REVIEW_LABELS),
    draft: pick(params.get('draft'), YES_NO),
    author: params.get('author') || null,
    base: params.get('base') || null,
    agent: pick(params.get('agent'), YES_NO),
    group: pick(params.get('group'), GROUP_LABELS) ?? DEFAULT_QUERY.group,
    sort: pick(params.get('sort'), SORT_LABELS) ?? DEFAULT_QUERY.sort,
    dir: pick(params.get('dir'), { asc: 1, desc: 1 }) ?? DEFAULT_QUERY.dir,
  };
}

/** Writes `patch` into a copy of `params`; defaults are removed, other params are kept */
export function patchPullParams(
  params: URLSearchParams,
  patch: Partial<PullQuery>
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(patch) as [keyof PullQuery, string | null][]) {
    if (value === null || value === '' || value === DEFAULT_QUERY[key]) next.delete(key);
    else next.set(key, value);
  }
  return next;
}

/** True when any filter (not grouping or sorting) is set */
export const hasFilters = (q: PullQuery) =>
  !!(
    q.q.trim() ||
    q.repo ||
    q.ci ||
    q.merge ||
    q.review ||
    q.draft ||
    q.author ||
    q.base ||
    q.agent
  );

/** Drops all filters, keeps grouping and sorting */
export const FILTER_RESET: Partial<PullQuery> = {
  q: '',
  repo: null,
  ci: null,
  merge: null,
  review: null,
  draft: null,
  author: null,
  base: null,
  agent: null,
};

function matchesText(pr: AgentPullRequest, text: string): boolean {
  const needle = text.trim().toLowerCase().replace(/^#/, '');
  if (!needle) return true;
  return [pr.title, String(pr.number), pr.headRef, pr.author ?? ''].some((v) =>
    v.toLowerCase().includes(needle)
  );
}

/** All filters combine with AND */
export function filterPulls(rows: PullRequestRow[], q: PullQuery): PullRequestRow[] {
  return rows.filter(({ pr, agents }) => {
    if (!matchesText(pr, q.q)) return false;
    if (q.repo && pr.repoSlug.toLowerCase() !== q.repo.toLowerCase()) return false;
    if (q.ci && pr.ci !== q.ci) return false;
    if (q.merge && mergeKey(pr) !== q.merge) return false;
    if (q.review && reviewKey(pr) !== q.review) return false;
    if (q.draft && pr.isDraft !== (q.draft === 'yes')) return false;
    if (q.author && pr.author !== q.author) return false;
    if (q.base && pr.baseRef !== q.base) return false;
    if (q.agent && agents.length > 0 !== (q.agent === 'yes')) return false;
    return true;
  });
}

const time = (pr: AgentPullRequest) => Date.parse(pr.updatedAt) || 0;
const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

const COMPARE: Record<SortKey, (a: AgentPullRequest, b: AgentPullRequest) => number> = {
  updated: (a, b) => time(a) - time(b),
  // asc = blocked first; the default desc puts ready PRs on top, newest first within
  ready: (a, b) => Number(a.mergeReady) - Number(b.mergeReady) || time(a) - time(b),
  number: (a, b) => a.number - b.number || text(a.repoSlug, b.repoSlug),
  title: (a, b) => text(a.title, b.title),
  repo: (a, b) => text(a.repoSlug, b.repoSlug) || a.number - b.number,
};

export function sortPulls(rows: PullRequestRow[], sort: SortKey, dir: SortDir): PullRequestRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => sign * COMPARE[sort](a.pr, b.pr));
}

export interface PullGroup {
  key: string;
  label: string;
  rows: PullRequestRow[];
}

const NO_AUTHOR = 'No author';
const NO_AGENT = 'No agent';

/** Fixed order for the state clusters, alphabetical for the open-ended ones (empty last) */
const ORDER: Partial<Record<GroupKey, string[]>> = {
  merge: Object.keys(MERGE_LABELS),
  ci: ['failure', 'pending', 'success', 'none'],
  review: ['changes', 'required', 'approved', 'none'],
};

/** Clusters already sorted rows; a PR with several agents is listed under each of them */
export function groupPulls(rows: PullRequestRow[], group: GroupKey): PullGroup[] {
  if (group === 'none') return [{ key: 'all', label: 'All', rows }];
  const groups = new Map<string, PullGroup>();
  const add = (key: string, label: string, row: PullRequestRow) => {
    const g = groups.get(key) ?? { key, label, rows: [] };
    g.rows.push(row);
    groups.set(key, g);
  };
  for (const row of rows) {
    const { pr, agents } = row;
    if (group === 'repo') add(pr.repoSlug, pr.repoSlug, row);
    else if (group === 'merge') add(mergeKey(pr), MERGE_LABELS[mergeKey(pr)], row);
    else if (group === 'ci') add(pr.ci, CI_LABELS[pr.ci], row);
    else if (group === 'review') add(reviewKey(pr), REVIEW_LABELS[reviewKey(pr)], row);
    else if (group === 'author') add(pr.author ?? '', pr.author ?? NO_AUTHOR, row);
    else if (agents.length === 0) add('', NO_AGENT, row);
    else for (const a of agents) add(a.id, a.name || a.id, row);
  }
  const order = ORDER[group];
  return [...groups.values()].sort((a, b) =>
    order
      ? order.indexOf(a.key) - order.indexOf(b.key)
      : Number(a.key === '') - Number(b.key === '') || text(a.label, b.label)
  );
}

/** Distinct values for the select filters, from all rows (not only the filtered ones) */
export function pullOptions(rows: PullRequestRow[]) {
  const uniq = (values: (string | null)[]) =>
    [...new Set(values.filter((v): v is string => !!v))].sort(text);
  return {
    repos: uniq(rows.map((r) => r.pr.repoSlug)),
    authors: uniq(rows.map((r) => r.pr.author)),
    bases: uniq(rows.map((r) => r.pr.baseRef)),
  };
}

/** filter -> sort -> group, as the view shows it */
export function queryPulls(rows: PullRequestRow[], q: PullQuery) {
  const shown = sortPulls(filterPulls(rows, q), q.sort, q.dir);
  return { shown, groups: groupPulls(shown, q.group) };
}
