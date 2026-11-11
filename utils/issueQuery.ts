/**
 * Filter, cluster and sort the issues of the Issues mode (/issues). Pure; the state lives in
 * the URL search params, so every value read from there is checked against the known options.
 */
import type { RepoIssue, RepoIssueState } from '../types';

export type BoardKey = 'on' | 'off';
export type GroupKey = 'none' | 'repo' | 'label' | 'milestone' | 'assignee';
export type SortKey = 'updated' | 'created' | 'number' | 'comments';
export type SortDir = 'asc' | 'desc';

export interface IssueQuery {
  /** Free text: title, #number, label names */
  q: string;
  repo: string | null;
  label: string | null;
  assignee: string | null;
  milestone: string | null;
  author: string | null;
  /** On the board's project (on) or not (off); null = all */
  board: BoardKey | null;
  /** Which issues are loaded; not a client-side filter */
  state: RepoIssueState;
  group: GroupKey;
  sort: SortKey;
  dir: SortDir;
}

export const BOARD_LABELS: Record<BoardKey, string> = {
  on: 'On board',
  off: 'Not on board',
};
export const STATE_LABELS: Record<RepoIssueState, string> = {
  open: 'Open',
  closed: 'Closed',
};
export const GROUP_LABELS: Record<GroupKey, string> = {
  none: 'No grouping',
  repo: 'Repository',
  label: 'Label',
  milestone: 'Milestone',
  assignee: 'Assignee',
};
export const SORT_LABELS: Record<SortKey, string> = {
  updated: 'Last updated',
  created: 'Created',
  number: 'Number',
  comments: 'Comments',
};

export const DEFAULT_QUERY: IssueQuery = {
  q: '',
  repo: null,
  label: null,
  assignee: null,
  milestone: null,
  author: null,
  board: null,
  state: 'open',
  group: 'none',
  sort: 'updated',
  dir: 'desc',
};

const pick = <T extends string>(value: string | null, allowed: Record<T, unknown>): T | null =>
  value !== null && Object.hasOwn(allowed, value) ? (value as T) : null;

/** URL params -> query; unknown or invalid values fall back to the defaults */
export function parseIssueQuery(params: URLSearchParams): IssueQuery {
  return {
    q: params.get('q') ?? '',
    repo: params.get('repo') || null,
    label: params.get('label') || null,
    assignee: params.get('assignee') || null,
    milestone: params.get('milestone') || null,
    author: params.get('author') || null,
    board: pick(params.get('board'), BOARD_LABELS),
    state: pick(params.get('state'), STATE_LABELS) ?? DEFAULT_QUERY.state,
    group: pick(params.get('group'), GROUP_LABELS) ?? DEFAULT_QUERY.group,
    sort: pick(params.get('sort'), SORT_LABELS) ?? DEFAULT_QUERY.sort,
    dir: pick(params.get('dir'), { asc: 1, desc: 1 }) ?? DEFAULT_QUERY.dir,
  };
}

/** Writes `patch` into a copy of `params`; defaults are removed, other params are kept */
export function patchIssueParams(
  params: URLSearchParams,
  patch: Partial<IssueQuery>
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(patch) as [keyof IssueQuery, string | null][]) {
    if (value === null || value === '' || value === DEFAULT_QUERY[key]) next.delete(key);
    else next.set(key, value);
  }
  return next;
}

/** True when any filter (not state, grouping or sorting) is set */
export const hasFilters = (q: IssueQuery) =>
  !!(q.q.trim() || q.repo || q.label || q.assignee || q.milestone || q.author || q.board);

/** Drops all filters, keeps state, grouping and sorting */
export const FILTER_RESET: Partial<IssueQuery> = {
  q: '',
  repo: null,
  label: null,
  assignee: null,
  milestone: null,
  author: null,
  board: null,
};

function matchesText(issue: RepoIssue, text: string): boolean {
  const needle = text.trim().toLowerCase().replace(/^#/, '');
  if (!needle) return true;
  return [issue.title, String(issue.number), ...issue.labels.map((l) => l.name)].some((v) =>
    v.toLowerCase().includes(needle)
  );
}

/** All filters combine with AND */
export function filterIssues(issues: RepoIssue[], q: IssueQuery): RepoIssue[] {
  return issues.filter((issue) => {
    if (!matchesText(issue, q.q)) return false;
    if (q.repo && issue.repo.toLowerCase() !== q.repo.toLowerCase()) return false;
    if (q.label && !issue.labels.some((l) => l.name === q.label)) return false;
    if (q.assignee && !issue.assignees.includes(q.assignee)) return false;
    if (q.milestone && issue.milestone !== q.milestone) return false;
    if (q.author && issue.author !== q.author) return false;
    if (q.board && issue.onBoard !== (q.board === 'on')) return false;
    return true;
  });
}

const time = (value: string) => Date.parse(value) || 0;
const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

const COMPARE: Record<SortKey, (a: RepoIssue, b: RepoIssue) => number> = {
  updated: (a, b) => time(a.updatedAt) - time(b.updatedAt),
  created: (a, b) => time(a.createdAt) - time(b.createdAt),
  number: (a, b) => a.number - b.number || text(a.repo, b.repo),
  comments: (a, b) => a.comments - b.comments || time(a.updatedAt) - time(b.updatedAt),
};

export function sortIssues(issues: RepoIssue[], sort: SortKey, dir: SortDir): RepoIssue[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...issues].sort((a, b) => sign * COMPARE[sort](a, b));
}

export interface IssueGroup {
  key: string;
  label: string;
  issues: RepoIssue[];
}

const EMPTY_LABEL: Record<Exclude<GroupKey, 'none'>, string> = {
  repo: 'No repository',
  label: 'No label',
  milestone: 'No milestone',
  assignee: 'No assignee',
};

/** Values of `issue` for `group`; [] = the empty cluster */
function groupValues(issue: RepoIssue, group: Exclude<GroupKey, 'none'>): string[] {
  if (group === 'repo') return [issue.repo];
  if (group === 'label') return issue.labels.map((l) => l.name);
  if (group === 'milestone') return issue.milestone ? [issue.milestone] : [];
  return issue.assignees;
}

/**
 * Clusters already sorted issues, alphabetically with the empty cluster last; an issue with
 * several labels or assignees is listed under each of them.
 */
export function groupIssues(issues: RepoIssue[], group: GroupKey): IssueGroup[] {
  if (group === 'none') return [{ key: 'all', label: 'All', issues }];
  const groups = new Map<string, IssueGroup>();
  const add = (key: string, label: string, issue: RepoIssue) => {
    const g = groups.get(key) ?? { key, label, issues: [] };
    g.issues.push(issue);
    groups.set(key, g);
  };
  for (const issue of issues) {
    const values = groupValues(issue, group);
    if (values.length === 0) add('', EMPTY_LABEL[group], issue);
    else for (const value of new Set(values)) add(value, value, issue);
  }
  return [...groups.values()].sort(
    (a, b) => Number(a.key === '') - Number(b.key === '') || text(a.label, b.label)
  );
}

/** Distinct values for the select filters, from all issues (not only the filtered ones) */
export function issueOptions(issues: RepoIssue[]) {
  const uniq = (values: (string | null)[]) =>
    [...new Set(values.filter((v): v is string => !!v))].sort(text);
  return {
    repos: uniq(issues.map((i) => i.repo)),
    labels: uniq(issues.flatMap((i) => i.labels.map((l) => l.name))),
    assignees: uniq(issues.flatMap((i) => i.assignees)),
    milestones: uniq(issues.map((i) => i.milestone)),
    authors: uniq(issues.map((i) => i.author)),
  };
}

/** filter -> sort -> group, as the view shows it */
export function queryIssues(issues: RepoIssue[], q: IssueQuery) {
  const shown = sortIssues(filterIssues(issues, q), q.sort, q.dir);
  return { shown, groups: groupIssues(shown, q.group) };
}
