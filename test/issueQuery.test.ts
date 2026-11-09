import { describe, it, expect } from 'vitest';
import type { RepoIssue } from '../types';
import {
  DEFAULT_QUERY,
  FILTER_RESET,
  filterIssues,
  groupIssues,
  hasFilters,
  issueOptions,
  parseIssueQuery,
  patchIssueParams,
  queryIssues,
  sortIssues,
} from '../utils/issueQuery';

const issue = (number: number, patch: Partial<RepoIssue> = {}): RepoIssue => ({
  id: `I_${number}`,
  repo: 'o/r',
  number,
  title: `Issue ${number}`,
  url: `https://github.com/o/r/issues/${number}`,
  state: 'open',
  createdAt: `2026-01-0${number}T00:00:00Z`,
  updatedAt: `2026-02-0${number}T00:00:00Z`,
  closedAt: null,
  author: 'hape',
  labels: [],
  assignees: [],
  milestone: null,
  comments: 0,
  onBoard: false,
  ...patch,
});

const issues = [
  issue(1, { labels: [{ name: 'bug', color: 'd73a4a' }], onBoard: true, comments: 5 }),
  issue(2, {
    repo: 'o/other',
    labels: [
      { name: 'bug', color: 'd73a4a' },
      { name: 'ui', color: '0075ca' },
    ],
    assignees: ['ana', 'bo'],
    milestone: 'v1',
    author: 'ana',
  }),
  issue(3, { title: 'Crash on start', milestone: 'v1', updatedAt: '2026-01-01T00:00:00Z' }),
];
const q = (patch: Partial<typeof DEFAULT_QUERY>) => ({ ...DEFAULT_QUERY, ...patch });
const numbers = (list: RepoIssue[]) => list.map((i) => i.number);

describe('issueQuery - URL state', () => {
  it('parses defaults from empty params and drops invalid values', () => {
    expect(parseIssueQuery(new URLSearchParams())).toEqual(DEFAULT_QUERY);
    expect(
      parseIssueQuery(new URLSearchParams('board=maybe&state=all&group=x&sort=y&dir=up'))
    ).toEqual(DEFAULT_QUERY);
  });

  it('round-trips through patch -> parse and omits defaults from the URL', () => {
    const patch = {
      q: 'crash',
      repo: 'o/r',
      label: 'bug',
      assignee: 'ana',
      milestone: 'v1',
      author: 'hape',
      board: 'off' as const,
      state: 'closed' as const,
      group: 'label' as const,
      sort: 'comments' as const,
      dir: 'asc' as const,
    };
    const params = patchIssueParams(new URLSearchParams('item=o%2Fr%2312'), patch);
    expect(parseIssueQuery(params)).toEqual(patch);
    expect(params.get('item')).toBe('o/r#12');

    const back = patchIssueParams(params, { ...FILTER_RESET, state: 'open', group: 'none' });
    expect(back.toString()).toBe('item=o%2Fr%2312&sort=comments&dir=asc');
  });

  it('hasFilters ignores state, grouping and sorting', () => {
    expect(hasFilters(q({ state: 'closed', group: 'repo', sort: 'number' }))).toBe(false);
    expect(hasFilters(q({ board: 'on' }))).toBe(true);
    expect(hasFilters(q({ q: '  ' }))).toBe(false);
  });
});

describe('issueQuery - filterIssues', () => {
  it.each([
    [{ q: '#2' }, [2]],
    [{ q: 'crash' }, [3]],
    [{ q: 'UI' }, [2]],
    [{ repo: 'O/Other' }, [2]],
    [{ label: 'bug' }, [1, 2]],
    [{ assignee: 'bo' }, [2]],
    [{ milestone: 'v1' }, [2, 3]],
    [{ author: 'hape' }, [1, 3]],
    [{ board: 'on' as const }, [1]],
    [{ board: 'off' as const }, [2, 3]],
    [{ label: 'bug', board: 'off' as const }, [2]],
  ])('%o -> %o', (patch, expected) => {
    expect(numbers(filterIssues(issues, q(patch)))).toEqual(expected);
  });
});

describe('issueQuery - sortIssues', () => {
  it.each([
    ['updated', 'desc', [2, 1, 3]],
    ['created', 'desc', [3, 2, 1]],
    ['number', 'asc', [1, 2, 3]],
    ['comments', 'desc', [1, 2, 3]],
  ] as const)('%s %s', (sort, dir, expected) => {
    expect(numbers(sortIssues(issues, sort, dir))).toEqual(expected);
  });
});

describe('issueQuery - groupIssues', () => {
  it('none is one cluster', () => {
    expect(groupIssues(issues, 'none')).toEqual([{ key: 'all', label: 'All', issues }]);
  });

  it('lists an issue under each label, the empty cluster last', () => {
    expect(groupIssues(issues, 'label').map((g) => [g.label, numbers(g.issues)])).toEqual([
      ['bug', [1, 2]],
      ['ui', [2]],
      ['No label', [3]],
    ]);
  });

  it.each([
    [
      'repo',
      [
        ['o/other', [2]],
        ['o/r', [1, 3]],
      ],
    ],
    [
      'milestone',
      [
        ['v1', [2, 3]],
        ['No milestone', [1]],
      ],
    ],
    [
      'assignee',
      [
        ['ana', [2]],
        ['bo', [2]],
        ['No assignee', [1, 3]],
      ],
    ],
  ] as const)('%s', (group, expected) => {
    expect(groupIssues(issues, group).map((g) => [g.label, numbers(g.issues)])).toEqual(expected);
  });
});

describe('issueQuery - options and pipeline', () => {
  it('collects distinct filter values from all issues', () => {
    expect(issueOptions(issues)).toEqual({
      repos: ['o/other', 'o/r'],
      labels: ['bug', 'ui'],
      assignees: ['ana', 'bo'],
      milestones: ['v1'],
      authors: ['ana', 'hape'],
    });
  });

  it('filters, sorts and groups as the view shows it', () => {
    const { shown, groups } = queryIssues(
      issues,
      q({ label: 'bug', group: 'repo', sort: 'number' })
    );
    expect(numbers(shown)).toEqual([2, 1]);
    expect(groups.map((g) => g.key)).toEqual(['o/other', 'o/r']);
  });
});
