import { describe, it, expect, vi } from 'vitest';
import { execFile } from 'child_process';

vi.mock('child_process', () => {
  const execFile = vi.fn();
  return { execFile, default: { execFile } };
});

const { mapItem, parseMwBoardSessions, mapCheckState, getBoard, setItemStatus, clearCache } =
  await import('../server/services/boardService.js');

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
        number: 44,
        title: 'Board',
        url: 'https://github.com/hpmartini/DevHub/issues/44',
        state: 'OPEN',
        updatedAt: '2026-10-23T10:00:00Z',
        closedAt: null,
        repository: { nameWithOwner: 'hpmartini/DevHub' },
        parent: { number: 40, title: 'Epic', repository: { nameWithOwner: 'hpmartini/DevHub' } },
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
      number: 44,
      title: 'Board',
      url: 'https://github.com/hpmartini/DevHub/issues/44',
      repo: 'hpmartini/DevHub',
      state: 'OPEN',
      statusOptionId: '47fc9ee4',
      labels: [{ name: 'prio: high', color: 'f97316' }],
      milestone: 'M1',
      assignees: ['hpmartini'],
      parent: { repo: 'hpmartini/DevHub', number: 40, title: 'Epic' },
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
      { repo: 'o/r', number: 7, url: 'https://github.com/o/r/pull/7', title: 'PR', state: 'MERGED', checks: null },
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
