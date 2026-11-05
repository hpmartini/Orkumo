import { describe, it, expect } from 'vitest';
import type { AgentPullRequest, AgentSession } from '../types';
import type { PullRequestRow } from '../utils/agentSessions';
import {
  DEFAULT_QUERY,
  filterPulls,
  groupPulls,
  hasFilters,
  parsePullQuery,
  patchPullParams,
  pullOptions,
  queryPulls,
  sortPulls,
  type PullQuery,
} from '../utils/pullRequestQuery';

const pr = (n: number, over: Partial<AgentPullRequest> = {}): AgentPullRequest => ({
  number: n,
  title: `PR ${n}`,
  url: `https://github.com/o/r/pull/${n}`,
  author: 'hape',
  isDraft: false,
  headRef: `feat/${n}`,
  baseRef: 'main',
  updatedAt: `2026-11-0${n}T10:00:00Z`,
  reviewDecision: null,
  mergeable: 'MERGEABLE',
  ci: 'success',
  ciPassed: 1,
  ciFailed: 0,
  ciPending: 0,
  mergeReady: true,
  repoSlug: 'o/r',
  ...over,
});
const agent = (id: string, name = id) => ({ id, name }) as AgentSession;
const row = (p: AgentPullRequest, agents: AgentSession[] = []): PullRequestRow => ({
  pr: p,
  agents,
});

// One distinguishing value per filter dimension
const ROWS: PullRequestRow[] = [
  row(pr(1, { title: 'Fix login', author: 'alice' }), [agent('a1', 'Agent One')]),
  row(
    pr(2, {
      repoSlug: 'o/other',
      url: 'https://github.com/o/other/pull/2',
      headRef: 'bugfix/cache',
    })
  ),
  row(pr(3, { ci: 'failure', mergeReady: false, reviewDecision: 'CHANGES_REQUESTED' })),
  row(pr(4, { isDraft: true, mergeReady: false, ci: 'pending', baseRef: 'develop' })),
  row(
    pr(5, {
      mergeable: 'CONFLICTING',
      mergeReady: false,
      reviewDecision: 'APPROVED',
      author: null,
    }),
    [agent('a1', 'Agent One'), agent('a2', 'Agent Two')]
  ),
  row(
    pr(6, {
      mergeable: 'UNKNOWN',
      mergeReady: false,
      ci: 'none',
      reviewDecision: 'REVIEW_REQUIRED',
    })
  ),
];

const q = (over: Partial<PullQuery>): PullQuery => ({ ...DEFAULT_QUERY, ...over });
const nums = (rows: PullRequestRow[]) => rows.map((r) => r.pr.number);
const filter = (over: Partial<PullQuery>) => nums(filterPulls(ROWS, q(over))).sort();

describe('filterPulls (AC-2)', () => {
  it('no filter keeps all rows', () => expect(filter({})).toEqual([1, 2, 3, 4, 5, 6]));

  it.each([
    ['title', { q: 'login' }, [1]],
    ['number with #', { q: '#3' }, [3]],
    ['number without #', { q: '4' }, [4]],
    ['head branch', { q: 'bugfix/' }, [2]],
    ['author, case-insensitive', { q: 'ALICE' }, [1]],
    ['no text match', { q: 'nothing-like-this' }, []],
  ])('free text: %s', (_name, over, expected) => expect(filter(over)).toEqual(expected));

  it.each<[string, Partial<PullQuery>, number[]]>([
    ['repo', { repo: 'o/other' }, [2]],
    ['repo, case-insensitive', { repo: 'O/Other' }, [2]],
    ['ci failing', { ci: 'failure' }, [3]],
    ['ci running', { ci: 'pending' }, [4]],
    ['ci none', { ci: 'none' }, [6]],
    ['merge ready', { merge: 'ready' }, [1, 2]],
    ['merge blocked', { merge: 'blocked' }, [3, 4]],
    ['merge conflicts', { merge: 'conflicts' }, [5]],
    ['merge checking', { merge: 'checking' }, [6]],
    ['review approved', { review: 'approved' }, [5]],
    ['review changes', { review: 'changes' }, [3]],
    ['review required', { review: 'required' }, [6]],
    ['review none', { review: 'none' }, [1, 2, 4]],
    ['draft yes', { draft: 'yes' }, [4]],
    ['draft no', { draft: 'no' }, [1, 2, 3, 5, 6]],
    ['author', { author: 'alice' }, [1]],
    ['base', { base: 'develop' }, [4]],
    ['has agent yes', { agent: 'yes' }, [1, 5]],
    ['has agent no', { agent: 'no' }, [2, 3, 4, 6]],
  ])('%s', (_name, over, expected) => expect(filter(over)).toEqual(expected));

  it('filters combine with AND', () => {
    expect(filter({ agent: 'yes', merge: 'ready' })).toEqual([1]);
    expect(filter({ agent: 'yes', merge: 'ready', author: 'hape' })).toEqual([]);
    expect(filter({ repo: 'o/r', draft: 'no', ci: 'success' })).toEqual([1, 5]);
  });
});

describe('groupPulls (AC-3)', () => {
  const groups = (key: PullQuery['group']) =>
    groupPulls(ROWS, key).map((g) => [g.label, nums(g.rows)]);

  it('none: one group with all rows', () =>
    expect(groups('none')).toEqual([['All', [1, 2, 3, 4, 5, 6]]]));

  it('repo, alphabetical', () =>
    expect(groups('repo')).toEqual([
      ['o/other', [2]],
      ['o/r', [1, 3, 4, 5, 6]],
    ]));

  it('merge state in fixed order', () =>
    expect(groups('merge')).toEqual([
      ['Ready to merge', [1, 2]],
      ['Blocked', [3, 4]],
      ['Checking', [6]],
      ['Conflicts', [5]],
    ]));

  it('ci, failing first', () =>
    expect(groups('ci')).toEqual([
      ['Failing', [3]],
      ['Running', [4]],
      ['Passing', [1, 2, 5]],
      ['No checks', [6]],
    ]));

  it('review, changes requested first', () =>
    expect(groups('review')).toEqual([
      ['Changes requested', [3]],
      ['Review required', [6]],
      ['Approved', [5]],
      ['No review', [1, 2, 4]],
    ]));

  it('author, missing author last', () =>
    expect(groups('author')).toEqual([
      ['alice', [1]],
      ['hape', [2, 3, 4, 6]],
      ['No author', [5]],
    ]));

  it('agent: a PR with two agents is under each, PRs without agent in their own group', () =>
    expect(groups('agent')).toEqual([
      ['Agent One', [1, 5]],
      ['Agent Two', [5]],
      ['No agent', [2, 3, 4, 6]],
    ]));

  it('group counts add up to the rows (agent: more, because of shared PRs)', () => {
    for (const key of ['repo', 'merge', 'ci', 'review', 'author'] as const) {
      expect(groupPulls(ROWS, key).reduce((n, g) => n + g.rows.length, 0)).toBe(ROWS.length);
    }
  });
});

describe('sortPulls (AC-4)', () => {
  const sort = (key: PullQuery['sort'], dir: PullQuery['dir']) => nums(sortPulls(ROWS, key, dir));

  it('default is last updated, descending', () => {
    expect(DEFAULT_QUERY.sort).toBe('updated');
    expect(DEFAULT_QUERY.dir).toBe('desc');
    expect(nums(queryPulls(ROWS, DEFAULT_QUERY).shown)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it.each<[PullQuery['sort'], number[]]>([
    ['updated', [1, 2, 3, 4, 5, 6]],
    ['ready', [3, 4, 5, 6, 1, 2]],
    ['number', [1, 2, 3, 4, 5, 6]],
    ['title', [1, 2, 3, 4, 5, 6]],
    ['repo', [2, 1, 3, 4, 5, 6]],
  ])('%s ascending and descending', (key, asc) => {
    expect(sort(key, 'asc')).toEqual(asc);
    expect(sort(key, 'desc')).toEqual([...asc].reverse());
  });

  it('title is case-insensitive', () => {
    const rows = [row(pr(1, { title: 'beta' })), row(pr(2, { title: 'Alpha' }))];
    expect(nums(sortPulls(rows, 'title', 'asc'))).toEqual([2, 1]);
  });

  it('does not mutate the input', () => {
    const before = nums(ROWS);
    sortPulls(ROWS, 'number', 'desc');
    expect(nums(ROWS)).toEqual(before);
  });
});

describe('URL state (AC-6)', () => {
  it('round-trips every field and drops defaults', () => {
    const full: PullQuery = {
      q: 'fix',
      repo: 'o/r',
      ci: 'failure',
      merge: 'blocked',
      review: 'changes',
      draft: 'no',
      author: 'alice',
      base: 'main',
      agent: 'yes',
      group: 'repo',
      sort: 'title',
      dir: 'asc',
    };
    const params = patchPullParams(new URLSearchParams(), full);
    expect(parsePullQuery(params)).toEqual(full);
    expect(patchPullParams(params, DEFAULT_QUERY).toString()).toBe('');
  });

  it('ignores invalid values from the URL', () => {
    const parsed = parsePullQuery(
      new URLSearchParams('ci=evil&merge=x&review=1&draft=maybe&agent=&group=foo&sort=bar&dir=up')
    );
    expect(parsed).toEqual(DEFAULT_QUERY);
  });

  it('keeps params it does not own', () => {
    const params = patchPullParams(new URLSearchParams('ctx=abc'), { ci: 'failure' });
    expect(params.get('ctx')).toBe('abc');
    expect(params.get('ci')).toBe('failure');
  });

  it('hasFilters ignores grouping and sorting', () => {
    expect(hasFilters(q({ group: 'repo', sort: 'title', dir: 'asc' }))).toBe(false);
    expect(hasFilters(q({ q: '  ' }))).toBe(false);
    expect(hasFilters(q({ agent: 'no' }))).toBe(true);
  });
});

describe('pullOptions', () => {
  it('lists distinct repos, authors and bases, sorted', () =>
    expect(pullOptions(ROWS)).toEqual({
      repos: ['o/other', 'o/r'],
      authors: ['alice', 'hape'],
      bases: ['develop', 'main'],
    }));
});
