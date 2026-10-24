import { describe, it, expect, vi } from 'vitest';
import { execFile } from 'child_process';

vi.mock('child_process', () => {
  const execFile = vi.fn();
  return { execFile, default: { execFile } };
});

const {
  mapItem,
  parseMwBoardSessions,
  mapCheckState,
  getBoard,
  setItemStatus,
  clearCache,
  pickRepoPath,
  resolveIssueRefs,
  pickNewItemStatus,
  updateIssue,
} = await import('../server/services/boardService.js');

const UUID = '6259550d-1555-4cd2-85d1-d37082bb80f4';

describe('boardService - mapCheckState', () => {
  it.each([
    ['SUCCESS', 'success'],
    ['FAILURE', 'failure'],
    ['ERROR', 'failure'],
    ['PENDING', 'pending'],
    ['EXPECTED', 'pending'],
    ['NEUTRAL', null],
    [undefined, null],
  ])('%s -> %s', (state, expected) => {
    expect(mapCheckState(state)).toBe(expected);
  });
});

describe('boardService - parseMwBoardSessions', () => {
  it('extracts all session uuids, dedups, ignores other comments', () => {
    const bodies = [
      `<!-- mw-board:start session=${UUID} mode=default dynamic=on -->\nstarted`,
      'plain comment',
      `<!--mw-board:start   session=${UUID} -->`,
      '<!-- mw-board:start session=11111111-2222-3333-4444-555555555555 -->',
      null,
    ];
    expect(parseMwBoardSessions(bodies)).toEqual([UUID, '11111111-2222-3333-4444-555555555555']);
  });
  it('returns [] without bodies', () => {
    expect(parseMwBoardSessions(undefined)).toEqual([]);
  });
});

describe('boardService - mapItem', () => {
  it('maps an issue with closing PRs, parent, labels and mw-board sessions', () => {
    const item = mapItem({
      id: 'PVTI_abc',
      fieldValueByName: { optionId: '47fc9ee4' },
      content: {
        __typename: 'Issue',
        id: 'I_44',
        number: 44,
        title: 'Board',
        url: 'https://github.com/hpmartini/DevHub/issues/44',
        state: 'OPEN',
        updatedAt: '2026-10-23T10:00:00Z',
        closedAt: null,
        repository: { nameWithOwner: 'hpmartini/DevHub' },
        parent: {
          id: 'I_40',
          number: 40,
          title: 'Epic',
          repository: { nameWithOwner: 'hpmartini/DevHub' },
        },
        subIssuesSummary: { total: 3, completed: 1 },
        labels: { nodes: [{ name: 'prio: high', color: 'f97316' }] },
        milestone: { title: 'M1' },
        assignees: { nodes: [{ login: 'hpmartini' }] },
        closedByPullRequestsReferences: {
          nodes: [
            {
              number: 50,
              url: 'https://github.com/hpmartini/DevHub/pull/50',
              title: 'Fix',
              state: 'OPEN',
              repository: { nameWithOwner: 'hpmartini/DevHub' },
              statusCheckRollup: { state: 'FAILURE' },
            },
          ],
        },
        comments: { nodes: [{ body: `<!-- mw-board:start session=${UUID} -->` }] },
      },
    });
    expect(item).toEqual({
      itemId: 'PVTI_abc',
      type: 'Issue',
      issueId: 'I_44',
      number: 44,
      title: 'Board',
      url: 'https://github.com/hpmartini/DevHub/issues/44',
      repo: 'hpmartini/DevHub',
      state: 'OPEN',
      stateReason: null,
      statusOptionId: '47fc9ee4',
      labels: [{ name: 'prio: high', color: 'f97316' }],
      milestone: 'M1',
      assignees: ['hpmartini'],
      parent: { id: 'I_40', repo: 'hpmartini/DevHub', number: 40, title: 'Epic' },
      subIssues: { total: 3, completed: 1 },
      pullRequests: [
        {
          repo: 'hpmartini/DevHub',
          number: 50,
          url: 'https://github.com/hpmartini/DevHub/pull/50',
          title: 'Fix',
          state: 'OPEN',
          checks: 'failure',
        },
      ],
      mwBoardSessions: [UUID],
      updatedAt: '2026-10-23T10:00:00Z',
      closedAt: null,
    });
  });

  it('maps a pull request item as its own pullRequests[0]', () => {
    const item = mapItem({
      id: 'PVTI_pr',
      fieldValueByName: null,
      content: {
        __typename: 'PullRequest',
        number: 7,
        url: 'https://github.com/o/r/pull/7',
        title: 'PR',
        state: 'MERGED',
        repository: { nameWithOwner: 'o/r' },
        statusCheckRollup: null,
        updatedAt: '2026-10-01T00:00:00Z',
        closedAt: '2026-10-01T00:00:00Z',
      },
    });
    expect(item.type).toBe('PullRequest');
    expect(item.statusOptionId).toBeNull();
    expect(item.parent).toBeNull();
    expect(item.subIssues).toEqual({ total: 0, completed: 0 });
    expect(item.pullRequests).toEqual([
      {
        repo: 'o/r',
        number: 7,
        url: 'https://github.com/o/r/pull/7',
        title: 'PR',
        state: 'MERGED',
        checks: null,
      },
    ]);
  });

  it('maps a draft issue without repo/number/url', () => {
    const item = mapItem({
      id: 'PVTI_draft',
      fieldValueByName: { optionId: 'f75ad846' },
      content: { __typename: 'DraftIssue', title: 'Idea', updatedAt: '2026-10-02T00:00:00Z' },
    });
    expect(item).toMatchObject({
      type: 'DraftIssue',
      issueId: null,
      number: null,
      url: null,
      repo: null,
      state: 'OPEN',
      title: 'Idea',
      labels: [],
      assignees: [],
      pullRequests: [],
      mwBoardSessions: [],
      closedAt: null,
    });
  });
});

describe('boardService - status write during in-flight fetch', () => {
  const source = { owner: 'hpmartini', number: 4 };
  const page = (optionId) =>
    JSON.stringify({
      data: {
        rateLimit: { cost: 1, remaining: 4999 },
        repositoryOwner: {
          projectV2: {
            id: 'PVT_1',
            title: 'MACC',
            field: { id: 'PVTSSF_1', options: [{ id: 'todo' }, { id: 'done' }] },
            items: {
              nodes: [
                {
                  id: 'PVTI_a',
                  fieldValueByName: { optionId },
                  content: { __typename: 'DraftIssue', title: 'x' },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    });

  it('keeps a status written while an older fetch is still in flight', async () => {
    clearCache();
    let reads = 0;
    let releaseStale = null;
    vi.mocked(execFile).mockImplementation((_cmd, args, _opts, cb) => {
      if (args.some((a) => String(a).includes('updateProjectV2ItemFieldValue'))) {
        cb(null, '{"data":{}}', '');
      } else if (reads++ === 0) {
        cb(null, page('todo'), '');
      } else {
        releaseStale = () => cb(null, page('todo'), '');
      }
    });

    await getBoard(source); // seeds cache
    const refreshing = getBoard(source, { refresh: true }); // answers later with pre-write data
    await setItemStatus(source, 'PVTI_a', 'done');
    releaseStale();

    expect((await refreshing).items[0].statusOptionId).toBe('done');
    expect((await getBoard(source)).items[0].statusOptionId).toBe('done');
  });
});

describe('boardService - pickRepoPath', () => {
  const entries = [
    { path: '/w/DevOrbitDashboard/.claude/worktrees/issue-44-board', slug: 'hpmartini/DevHub' },
    { path: '/w/DevOrbitDashboard', slug: 'hpmartini/DevHub' },
    { path: '/w/archive/old/DevHub-copy', slug: 'hpmartini/DevHub' },
    { path: '/w/glen', slug: 'hpmartini/glen' },
    { path: '/w/no-remote', slug: null },
  ];

  it('matches the origin slug case-insensitively, main checkout before worktree, shortest first', () => {
    expect(pickRepoPath('HPMARTINI/devhub', entries)).toBe('/w/DevOrbitDashboard');
    expect(pickRepoPath('hpmartini/glen', entries)).toBe('/w/glen');
  });

  it('falls back to a worktree when it is the only checkout', () => {
    expect(pickRepoPath('hpmartini/DevHub', entries.slice(0, 1))).toBe(entries[0].path);
  });

  it('returns null when no local checkout has that origin', () => {
    expect(pickRepoPath('hpmartini/MAPLE', entries)).toBeNull();
  });
});

describe('boardService - resolveIssueRefs', () => {
  const options = {
    labels: [
      { id: 'LA_1', name: 'bug' },
      { id: 'LA_2', name: 'mw:go' },
    ],
    assignees: [{ id: 'MDQ6VXNlcjUwNDcxMTg=', login: 'hpmartini' }],
    milestones: [{ id: 'MI_1', title: 'M1' }],
  };
  it('maps names case-insensitively, only for given keys', () => {
    expect(resolveIssueRefs(options, { labels: ['MW:GO'], assignees: ['hpmartini'] })).toEqual({
      labelIds: ['LA_2'],
      assigneeIds: ['MDQ6VXNlcjUwNDcxMTg='],
    });
    expect(resolveIssueRefs(options, { labels: [], milestone: null })).toEqual({
      labelIds: [],
      milestoneId: null,
    });
    expect(resolveIssueRefs(options, { milestone: 'M1' })).toEqual({ milestoneId: 'MI_1' });
    expect(resolveIssueRefs(options, { title: 'x' })).toEqual({});
  });
  it('rejects unknown names with 400', () => {
    expect(() => resolveIssueRefs(options, { labels: ['nope'] })).toThrow(/Unknown label: nope/);
    try {
      resolveIssueRefs(options, { milestone: 'M9' });
    } catch (e) {
      expect(e.status).toBe(400);
    }
  });
});

describe('boardService - pickNewItemStatus', () => {
  const options = [
    { id: 'b', name: 'Todo' },
    { id: 'a', name: 'Backlog' },
  ];
  it('uses the requested option, else Backlog, else the first', () => {
    expect(pickNewItemStatus(options, 'b')).toBe('b');
    expect(pickNewItemStatus(options)).toBe('a');
    expect(pickNewItemStatus([{ id: 'x', name: 'Todo' }])).toBe('x');
    expect(pickNewItemStatus([])).toBeNull();
  });
  it('rejects an unknown option', () => {
    expect(() => pickNewItemStatus(options, 'zzz')).toThrow(/Unknown status option/);
  });
});

describe('boardService - updateIssue', () => {
  const source = { owner: 'hpmartini', number: 4 };
  const issueNode = (over = {}) => ({
    id: 'PVTI_i',
    fieldValueByName: { optionId: 'todo' },
    content: {
      __typename: 'Issue',
      id: 'I_7',
      number: 7,
      title: 'Old',
      state: 'OPEN',
      repository: { nameWithOwner: 'hpmartini/DevHub' },
      ...over,
    },
  });
  const boardPage = JSON.stringify({
    data: {
      rateLimit: { cost: 1, remaining: 1 },
      repositoryOwner: {
        projectV2: {
          id: 'PVT_1',
          title: 'MACC',
          field: { id: 'F', options: [{ id: 'todo', name: 'Todo' }] },
          items: { nodes: [issueNode()], pageInfo: { hasNextPage: false } },
        },
      },
    },
  });

  it('sends one updateIssue with label ids (empty list as k[]), closes, and returns the refetched item', async () => {
    clearCache();
    const calls = [];
    vi.mocked(execFile).mockImplementation((_cmd, args, _opts, cb) => {
      const q = args[3];
      calls.push(args);
      if (q.includes('items(first')) cb(null, boardPage, '');
      else if (q.includes('labels(first:100')) {
        cb(
          null,
          JSON.stringify({
            data: {
              repository: {
                id: 'R_1',
                labels: { nodes: [{ id: 'LA_1', name: 'bug', color: 'f00' }] },
                assignableUsers: { nodes: [] },
                milestones: { nodes: [] },
              },
            },
          }),
          ''
        );
      } else if (q.includes('node(id:$id){... on ProjectV2Item')) {
        cb(
          null,
          JSON.stringify({ data: { node: issueNode({ title: 'New', state: 'CLOSED' }) } }),
          ''
        );
      } else cb(null, '{"data":{}}', '');
    });

    const item = await updateIssue(source, 'PVTI_i', {
      title: 'New',
      labels: [],
      assignees: [],
      state: 'CLOSED',
      stateReason: 'NOT_PLANNED',
    });

    const update = calls.find((a) => a[3].includes('updateIssue'));
    expect(update).toContain('title=New');
    expect(update).toContain('labelIds[]');
    expect(update).toContain('assigneeIds[]');
    const close = calls.find((a) => a[3].includes('closeIssue'));
    expect(close).toContain('reason=NOT_PLANNED');
    expect(item).toMatchObject({ title: 'New', state: 'CLOSED', issueId: 'I_7' });
    expect((await getBoard(source)).items[0].title).toBe('New');
  });
});
