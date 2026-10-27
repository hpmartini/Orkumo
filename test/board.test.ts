import { describe, it, expect } from 'vitest';
import {
  DONE_WINDOW_DAYS,
  UNSET_STATUS,
  issueKey,
  itemKey,
  shortRepo,
  resolveRepoSlice,
  isDoneOption,
  boardColumns,
  columnKeyOf,
  withinDoneWindow,
  sliceValues,
  sliceKey,
  buildSlices,
  filterItems,
  matchesQuery,
  matchesContextFilter,
  parseContextFilter,
  moveSliceKey,
  buildLanes,
  deriveAgentLinks,
  linksByIssue,
  linksByAgent,
  columnTint,
  parseIssueRef,
} from '../utils/board';
import type { AgentPrLink, BoardItem, BoardStatusOption } from '../types';

const OPTIONS: BoardStatusOption[] = [
  { id: 'o-backlog', name: 'Backlog', color: 'GRAY' },
  { id: 'o-todo', name: 'Todo', color: 'BLUE' },
  { id: 'o-done', name: 'Done', color: 'GREEN' },
];

let seq = 0;
function item(partial: Partial<BoardItem> = {}): BoardItem {
  seq++;
  return {
    itemId: `PVTI_${seq}`,
    type: 'Issue',
    issueId: null,
    number: seq,
    title: `Issue ${seq}`,
    url: null,
    repo: 'hpmartini/DevHub',
    state: 'OPEN',
    stateReason: null,
    statusOptionId: 'o-todo',
    labels: [],
    milestone: null,
    assignees: [],
    parent: null,
    subIssues: { total: 0, completed: 0 },
    pullRequests: [],
    mwBoardSessions: [],
    mwMarkers: [],
    updatedAt: '2026-10-20T00:00:00Z',
    closedAt: null,
    ...partial,
  };
}

const prLink = (href: string): AgentPrLink => ({
  id: href,
  href,
  title: null,
  number: null,
  provider: 'github',
  state: null,
});

describe('keys', () => {
  it('builds issue keys and short repo names', () => {
    expect(issueKey('hpmartini/DevHub', 44)).toBe('hpmartini/DevHub#44');
    expect(shortRepo('hpmartini/DevHub')).toBe('DevHub');
    expect(shortRepo(null)).toBe('');
    expect(sliceKey('repo', 'hpmartini/DevHub')).toBe('repo:hpmartini/DevHub');
  });

  it('uses the item id for drafts', () => {
    const draft = item({ type: 'DraftIssue', repo: null, number: null, itemId: 'PVTI_draft' });
    expect(itemKey(draft)).toBe('PVTI_draft');
    expect(itemKey(item({ repo: 'a/b', number: 3 }))).toBe('a/b#3');
  });
});

describe('status columns', () => {
  it('detects the done option by name', () => {
    expect(isDoneOption(OPTIONS[2])).toBe(true);
    expect(isDoneOption({ id: 'x', name: 'done', color: 'GREEN' })).toBe(true);
    expect(isDoneOption({ id: 'x', name: 'to Deploy', color: 'ORANGE' })).toBe(false);
    expect(isDoneOption({ id: 'x', name: 'Done soon', color: 'GREEN' })).toBe(false);
  });

  it('maps items to their option, unknown or missing status to UNSET', () => {
    expect(columnKeyOf(item({ statusOptionId: 'o-done' }), OPTIONS)).toBe('o-done');
    expect(columnKeyOf(item({ statusOptionId: null }), OPTIONS)).toBe(UNSET_STATUS);
    expect(columnKeyOf(item({ statusOptionId: 'deleted-option' }), OPTIONS)).toBe(UNSET_STATUS);
  });

  it('keeps field order and adds the UNSET column only when needed', () => {
    expect(boardColumns(OPTIONS, [item()]).map((c) => c.key)).toEqual([
      'o-backlog',
      'o-todo',
      'o-done',
    ]);
    const cols = boardColumns(OPTIONS, [item(), item({ statusOptionId: 'gone' })]);
    expect(cols.map((c) => c.key)).toEqual(['o-backlog', 'o-todo', 'o-done', UNSET_STATUS]);
    expect(cols[3].option).toBeNull();
    expect(cols[0].option).toBe(OPTIONS[0]);
  });
});

describe('withinDoneWindow', () => {
  const now = Date.parse('2026-10-23T12:00:00Z');
  const day = 24 * 60 * 60 * 1000;

  it('uses closedAt when present', () => {
    expect(
      withinDoneWindow(
        item({
          closedAt: new Date(now - 13 * day).toISOString(),
          updatedAt: '2020-01-01T00:00:00Z',
        }),
        now
      )
    ).toBe(true);
    expect(
      withinDoneWindow(
        item({
          closedAt: new Date(now - 15 * day).toISOString(),
          updatedAt: new Date(now).toISOString(),
        }),
        now
      )
    ).toBe(false);
  });

  it('falls back to updatedAt and honours a custom window', () => {
    const it3 = item({ updatedAt: new Date(now - 3 * day).toISOString() });
    expect(withinDoneWindow(it3, now)).toBe(true);
    expect(withinDoneWindow(it3, now, 2)).toBe(false);
    expect(DONE_WINDOW_DAYS).toBe(14);
  });

  it('treats an unparsable date as outside the window', () => {
    expect(withinDoneWindow(item({ updatedAt: 'nope' }), now)).toBe(false);
  });
});

describe('slices', () => {
  const a = item({
    repo: 'hpmartini/DevHub',
    labels: [
      { name: 'bug', color: 'd73a4a' },
      { name: 'ui', color: '000000' },
    ],
    milestone: 'M1',
    assignees: ['hape', 'bot'],
  });
  const b = item({ repo: 'hpmartini/DevHub', labels: [{ name: 'bug', color: 'd73a4a' }] });
  const c = item({ repo: 'hpmartini/glades' });
  const d = item({ repo: 'hpmartini/zeta' });
  const draft = item({ type: 'DraftIssue', repo: null, number: null });

  it('extracts values per kind', () => {
    expect(sliceValues(a, 'repo')).toEqual(['hpmartini/DevHub']);
    expect(sliceValues(a, 'label')).toEqual(['bug', 'ui']);
    expect(sliceValues(a, 'milestone')).toEqual(['M1']);
    expect(sliceValues(a, 'assignee')).toEqual(['hape', 'bot']);
    expect(sliceValues(draft, 'repo')).toEqual([]);
    expect(sliceValues(b, 'milestone')).toEqual([]);
  });

  it('sorts by manual order, then count desc, then name', () => {
    const s = buildSlices([a, b, c, d, draft], 'repo', { favorites: [], order: [], hidden: [] });
    expect(s.others.map((e) => e.value)).toEqual([
      'hpmartini/DevHub',
      'hpmartini/glades',
      'hpmartini/zeta',
    ]);
    expect(s.others[0].count).toBe(2);

    const ordered = buildSlices([a, b, c, d], 'repo', {
      favorites: [],
      order: ['repo:hpmartini/zeta'],
      hidden: [],
    });
    expect(ordered.others.map((e) => e.value)).toEqual([
      'hpmartini/zeta',
      'hpmartini/DevHub',
      'hpmartini/glades',
    ]);
  });

  it('splits favorites and hidden', () => {
    const s = buildSlices([a, b, c, d], 'repo', {
      favorites: ['repo:hpmartini/glades'],
      order: [],
      hidden: ['repo:hpmartini/zeta', 'label:bug'],
    });
    expect(s.favorites.map((e) => e.key)).toEqual(['repo:hpmartini/glades']);
    expect(s.favorites[0].favorite).toBe(true);
    expect(s.others.map((e) => e.key)).toEqual(['repo:hpmartini/DevHub']);
    expect(s.hidden.map((e) => e.key)).toEqual(['repo:hpmartini/zeta']);
    expect(s.hidden[0].hidden).toBe(true);
  });

  it('a hidden favorite goes to hidden only', () => {
    const s = buildSlices([c], 'repo', {
      favorites: ['repo:hpmartini/glades'],
      order: [],
      hidden: ['repo:hpmartini/glades'],
    });
    expect(s.favorites).toEqual([]);
    expect(s.hidden.map((e) => e.key)).toEqual(['repo:hpmartini/glades']);
  });

  it('counts labels per item once', () => {
    const dup = item({
      labels: [
        { name: 'x', color: '0' },
        { name: 'x', color: '0' },
      ],
    });
    expect(
      buildSlices([dup], 'label', { favorites: [], order: [], hidden: [] }).others[0].count
    ).toBe(1);
  });

  describe('filterItems', () => {
    const all = [a, b, c, d, draft];

    it('Alle returns everything except hidden repos', () => {
      expect(filterItems(all, { kind: 'repo', selected: null, hidden: [] })).toEqual(all);
      expect(
        filterItems(all, { kind: 'repo', selected: null, hidden: ['repo:hpmartini/zeta'] })
      ).toEqual([a, b, c, draft]);
    });

    it('hidden repos stay excluded under other slice kinds', () => {
      const tagged = item({ repo: 'hpmartini/zeta', labels: [{ name: 'bug', color: '0' }] });
      expect(
        filterItems([a, tagged], {
          kind: 'label',
          selected: 'bug',
          hidden: ['repo:hpmartini/zeta'],
        })
      ).toEqual([a]);
      expect(
        filterItems([a, tagged], { kind: 'label', selected: null, hidden: ['repo:hpmartini/zeta'] })
      ).toEqual([a]);
    });

    it('excludes hidden keys of the current kind', () => {
      expect(filterItems(all, { kind: 'label', selected: null, hidden: ['label:ui'] })).toEqual([
        b,
        c,
        d,
        draft,
      ]);
      // a label key hides nothing when slicing by repo
      expect(filterItems(all, { kind: 'repo', selected: null, hidden: ['label:ui'] })).toEqual(all);
    });

    it('filters by the selected slice value', () => {
      expect(filterItems(all, { kind: 'repo', selected: 'hpmartini/DevHub', hidden: [] })).toEqual([
        a,
        b,
      ]);
      expect(filterItems(all, { kind: 'assignee', selected: 'hape', hidden: [] })).toEqual([a]);
    });

    it('filters by agent issue keys', () => {
      const keys = new Set([itemKey(c), draft.itemId]);
      expect(
        filterItems(all, { kind: 'repo', selected: null, hidden: [], agentIssueKeys: keys })
      ).toEqual([c, draft]);
      expect(
        filterItems(all, { kind: 'repo', selected: null, hidden: [], agentIssueKeys: null })
      ).toEqual(all);
    });
  });
});

describe('matchesQuery', () => {
  const it44 = item({
    number: 44,
    title: 'Agent Task Board',
    labels: [{ name: 'area: ui', color: 'fff' }],
  });

  it('matches everything for an empty query', () => {
    expect(matchesQuery(it44, '  ')).toBe(true);
  });

  it('matches title, #nr and repo case-insensitively', () => {
    expect(matchesQuery(it44, 'task BOARD')).toBe(true);
    expect(matchesQuery(it44, '#44')).toBe(true);
    expect(matchesQuery(it44, 'devhub#44')).toBe(true);
    expect(matchesQuery(it44, '#45')).toBe(false);
    expect(matchesQuery(it44, 'mesh')).toBe(false);
  });

  it('label: prefix searches label names only', () => {
    expect(matchesQuery(it44, 'label:ui')).toBe(true);
    expect(matchesQuery(it44, 'label: area')).toBe(true);
    expect(matchesQuery(it44, 'label:board')).toBe(false);
  });
});

describe('moveSliceKey', () => {
  const all = ['repo:a', 'repo:b', 'repo:c'];

  it('moves before a key, materialising unordered keys', () => {
    expect(moveSliceKey([], all, 'repo:c', 'repo:a')).toEqual(['repo:c', 'repo:a', 'repo:b']);
  });

  it('moves to the end with null', () => {
    expect(moveSliceKey([], all, 'repo:a', null)).toEqual(['repo:b', 'repo:c', 'repo:a']);
  });

  it('keeps keys of other kinds', () => {
    expect(moveSliceKey(['label:x', 'repo:b'], all, 'repo:c', 'repo:b')).toEqual([
      'label:x',
      'repo:c',
      'repo:b',
      'repo:a',
    ]);
  });

  it('appends when beforeKey is unknown, never duplicates', () => {
    const out = moveSliceKey(['repo:a'], all, 'repo:a', 'repo:zzz');
    expect(out).toEqual(['repo:b', 'repo:c', 'repo:a']);
    expect(new Set(out).size).toBe(out.length);
  });
});

describe('buildLanes', () => {
  const parentA = { repo: 'hpmartini/DevHub', number: 1, title: 'Epic A' };
  const parentB = { repo: 'hpmartini/DevHub', number: 2, title: 'Epic B' };
  const done = new Set(['o-done']);
  const items = [
    item({ parent: parentA, statusOptionId: 'o-done' }),
    item({ parent: null }),
    item({ parent: null }),
    item({ parent: null }),
    item({ parent: parentB }),
    item({ parent: parentB }),
    item({ parent: parentA }),
    item({ parent: parentB, repo: 'hpmartini/glades' }),
  ];

  it('parent: one lane per parent, by size, "Ohne Parent" last', () => {
    const lanes = buildLanes(items, 'parent', done);
    expect(lanes.map((l) => l.key)).toEqual([
      'hpmartini/DevHub#2',
      'hpmartini/DevHub#1',
      'parent:none',
    ]);
    expect(lanes[0].title).toBe('Epic B');
    expect(lanes[0].parent).toEqual(parentB);
    expect(lanes[1]).toMatchObject({ total: 2, done: 1 });
    expect(lanes[2]).toMatchObject({ title: 'Ohne Parent', parent: null, total: 3 });
  });

  it('repo: one lane per repo', () => {
    const lanes = buildLanes(items, 'repo', done);
    expect(lanes.map((l) => [l.title, l.total])).toEqual([
      ['DevHub', 7],
      ['glades', 1],
    ]);
  });

  it('none: a single lane', () => {
    const lanes = buildLanes(items, 'none', done);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]).toMatchObject({ total: 8, done: 1 });
  });
});

describe('deriveAgentLinks', () => {
  const uuid = '6259550d-1555-4cd2-85d1-d37082bb80f4';
  const issue44 = item({ repo: 'hpmartini/DevHub', number: 44, mwBoardSessions: [uuid] });
  const prUrl = 'https://github.com/hpmartini/DevOrbitDashboard/pull/50';
  const issue45 = item({
    repo: 'hpmartini/DevOrbitDashboard',
    number: 45,
    pullRequests: [
      {
        repo: 'hpmartini/DevOrbitDashboard',
        number: 50,
        url: prUrl,
        title: 'Closes #45',
        state: 'OPEN',
        checks: 'pending',
      },
    ],
  });
  const prItem = item({
    type: 'PullRequest',
    repo: 'hpmartini/DevOrbitDashboard',
    number: 50,
    url: prUrl,
  });

  it('links mw-board sessions to job id = first 8 chars of the uuid', () => {
    expect(deriveAgentLinks([issue44], [{ id: '6259550d', sessionId: uuid, links: [] }])).toEqual([
      { jobId: '6259550d', issueKey: 'hpmartini/DevHub#44', via: 'mw-board' },
    ]);
  });

  it('keeps the mw-board link without a live session', () => {
    expect(deriveAgentLinks([issue44], [])).toEqual([
      { jobId: '6259550d', issueKey: 'hpmartini/DevHub#44', via: 'mw-board' },
    ]);
  });

  it('prefers the live session id matched by full session uuid', () => {
    expect(
      deriveAgentLinks([issue44], [{ id: 'other123', sessionId: uuid, links: [] }])[0].jobId
    ).toBe('other123');
  });

  it('links via PR url to the closed issue and the PR item itself', () => {
    const links = deriveAgentLinks(
      [issue45, prItem],
      [{ id: 'abcd1234', sessionId: null, links: [prLink(`${prUrl}/`)] }]
    );
    expect(links).toEqual([
      { jobId: 'abcd1234', issueKey: 'hpmartini/DevOrbitDashboard#45', via: 'pr' },
      { jobId: 'abcd1234', issueKey: 'hpmartini/DevOrbitDashboard#50', via: 'pr' },
    ]);
  });

  it('ignores unrelated PR urls', () => {
    expect(
      deriveAgentLinks(
        [issue45],
        [{ id: 'x', sessionId: null, links: [prLink('https://github.com/a/b/pull/1')] }]
      )
    ).toEqual([]);
  });

  it('dedups per (job, issue) and prefers mw-board', () => {
    const both = item({
      repo: 'hpmartini/DevHub',
      number: 44,
      mwBoardSessions: [uuid, uuid],
      pullRequests: [
        {
          repo: 'hpmartini/DevHub',
          number: 9,
          url: 'https://github.com/hpmartini/DevHub/pull/9',
          title: null,
          state: 'OPEN',
          checks: null,
        },
      ],
    });
    const links = deriveAgentLinks(
      [both],
      [
        {
          id: '6259550d',
          sessionId: uuid,
          links: [prLink('https://github.com/hpmartini/DevHub/pull/9')],
        },
      ]
    );
    expect(links).toEqual([
      { jobId: '6259550d', issueKey: 'hpmartini/DevHub#44', via: 'mw-board' },
    ]);
  });

  it('groups links by issue and by agent', () => {
    const links = [
      { jobId: 'j1', issueKey: 'r#1', via: 'pr' as const },
      { jobId: 'j2', issueKey: 'r#1', via: 'mw-board' as const },
      { jobId: 'j1', issueKey: 'r#2', via: 'pr' as const },
    ];
    expect(linksByIssue(links)).toEqual(
      new Map([
        ['r#1', ['j1', 'j2']],
        ['r#2', ['j1']],
      ])
    );
    expect(linksByAgent(links)).toEqual(
      new Map([
        ['j1', ['r#1', 'r#2']],
        ['j2', ['r#1']],
      ])
    );
  });
});

describe('columnTint', () => {
  it('reproduces the mockup tints (hex 24 / 14 alpha)', () => {
    // mockup: Backlog #94a8d6, Todo #7dd3fc, In Progress #fde047, to Review #c4b5fd, to Deploy #fdba74, Done #6ee7b7
    expect(columnTint('GRAY')).toEqual({
      head: 'rgba(148, 168, 214, 0.14)',
      cell: 'rgba(148, 168, 214, 0.08)',
    });
    expect(columnTint('green').head).toBe('rgba(110, 231, 183, 0.14)');
    expect(columnTint('YELLOW').cell).toBe('rgba(253, 224, 71, 0.08)');
  });

  it('gives each GitHub color a distinct tint, unknown falls back to gray', () => {
    const heads = ['GRAY', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'PURPLE'].map(
      (c) => columnTint(c).head
    );
    expect(new Set(heads).size).toBe(heads.length);
    expect(columnTint('TEAL')).toEqual(columnTint('GRAY'));
  });
});

describe('parseIssueRef', () => {
  it('reads #n, n, owner/name#n and issue URLs', () => {
    expect(parseIssueRef('#12', 'hpmartini/DevHub')).toEqual({
      repo: 'hpmartini/DevHub',
      number: 12,
    });
    expect(parseIssueRef(' 7 ', 'a/b')).toEqual({ repo: 'a/b', number: 7 });
    expect(parseIssueRef('o/r.js#3', null)).toEqual({ repo: 'o/r.js', number: 3 });
    expect(parseIssueRef('https://github.com/o/r/issues/9', null)).toEqual({
      repo: 'o/r',
      number: 9,
    });
  });
  it('rejects other text and bare numbers without a repo', () => {
    expect(parseIssueRef('#12', null)).toBeNull();
    expect(parseIssueRef('foo', 'a/b')).toBeNull();
    expect(parseIssueRef('#0', 'a/b')).toBeNull();
    expect(parseIssueRef('https://github.com/o/r/pull/9', null)).toBeNull();
  });

  describe('context filter', () => {
    const bug = { name: 'bug', color: '0' };
    const epic = { name: 'epic-a', color: '0' };
    const x = item({ labels: [bug, epic], milestone: 'v2' });
    const y = item({ repo: 'hpmartini/zeta', labels: [bug] });

    it('keeps everything without a filter', () => {
      expect(matchesContextFilter(x, [])).toBe(true);
    });

    it('ORs values of one kind and ANDs across kinds', () => {
      expect(matchesContextFilter(y, ['label:epic-a', 'label:bug'])).toBe(true);
      expect(matchesContextFilter(x, ['label:epic-a', 'milestone:v2'])).toBe(true);
      expect(matchesContextFilter(y, ['label:bug', 'milestone:v2'])).toBe(false);
      expect(matchesContextFilter(y, ['repo:hpmartini/DevHub'])).toBe(false);
    });

    it('parses comma-separated keys and drops unknown kinds', () => {
      expect(
        parseContextFilter(' label:epic-a, foo:bar, milestone:, repo:o/r,label:epic-a')
      ).toEqual(['label:epic-a', 'repo:o/r']);
    });
  });

  describe('resolveRepoSlice', () => {
    const repos = ['o/DevHub', 'o/api', 'p/api'];
    it('takes an exact slug', () => {
      expect(resolveRepoSlice(repos, 'p/api')).toBe('p/api');
    });
    it('falls back to a unique case-insensitive folder name', () => {
      expect(resolveRepoSlice(repos, 'devhub')).toBe('o/DevHub');
      expect(resolveRepoSlice(repos, '/x/y/DEVHUB')).toBe('o/DevHub');
    });
    it('is null for ambiguous or unknown names', () => {
      expect(resolveRepoSlice(repos, 'api')).toBeNull();
      expect(resolveRepoSlice(repos, 'nope')).toBeNull();
    });
  });
});
