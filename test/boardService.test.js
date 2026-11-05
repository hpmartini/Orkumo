import { describe, it, expect, vi, afterEach } from 'vitest';
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
  createIssue,
  getIssueComments,
  addIssueComment,
  getIssueSummary,
  setIssueLabels,
} = await import('../server/services/boardService.js');
const { CREATE_GRACE_MS } = await import('../utils/boardWrites.js');

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
    const item = mapItem(
      {
        id: 'PVTI_abc',
        fieldValueByName: { optionId: '47fc9ee4' },
        content: {
          __typename: 'Issue',
          id: 'I_44',
          number: 44,
          title: 'Board',
          url: 'https://github.com/hpmartini/Orkumo/issues/44',
          state: 'OPEN',
          updatedAt: '2026-10-23T10:00:00Z',
          closedAt: null,
          repository: { nameWithOwner: 'hpmartini/Orkumo' },
          parent: {
            id: 'I_40',
            number: 40,
            title: 'Epic',
            repository: { nameWithOwner: 'hpmartini/Orkumo' },
          },
          subIssuesSummary: { total: 3, completed: 1 },
          labels: { nodes: [{ name: 'prio: high', color: 'f97316' }] },
          milestone: { title: 'M1' },
          assignees: { nodes: [{ login: 'hpmartini' }] },
          closedByPullRequestsReferences: {
            nodes: [
              {
                number: 50,
                url: 'https://github.com/hpmartini/Orkumo/pull/50',
                title: 'Fix',
                state: 'OPEN',
                repository: { nameWithOwner: 'hpmartini/Orkumo' },
                statusCheckRollup: { state: 'FAILURE' },
              },
            ],
          },
          comments: {
            nodes: [
              { body: `<!-- mw-board:start session=${UUID} -->`, author: { login: 'hpmartini' } },
            ],
          },
        },
      },
      ['hpmartini']
    );
    expect(item).toEqual({
      itemId: 'PVTI_abc',
      type: 'Issue',
      issueId: 'I_44',
      number: 44,
      title: 'Board',
      url: 'https://github.com/hpmartini/Orkumo/issues/44',
      repo: 'hpmartini/Orkumo',
      state: 'OPEN',
      stateReason: null,
      statusOptionId: '47fc9ee4',
      labels: [{ name: 'prio: high', color: 'f97316' }],
      milestone: 'M1',
      assignees: ['hpmartini'],
      parent: { id: 'I_40', repo: 'hpmartini/Orkumo', number: 40, title: 'Epic' },
      subIssues: { total: 3, completed: 1 },
      pullRequests: [
        {
          repo: 'hpmartini/Orkumo',
          number: 50,
          url: 'https://github.com/hpmartini/Orkumo/pull/50',
          title: 'Fix',
          state: 'OPEN',
          checks: 'failure',
        },
      ],
      mwBoardSessions: [UUID],
      mwMarkers: [{ kind: 'start', attrs: { session: UUID }, at: '' }],
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
    { path: '/w/Orkumo/.claude/worktrees/issue-44-board', slug: 'hpmartini/Orkumo' },
    { path: '/w/Orkumo', slug: 'hpmartini/Orkumo' },
    { path: '/w/archive/old/Orkumo-copy', slug: 'hpmartini/Orkumo' },
    { path: '/w/glen', slug: 'hpmartini/glen' },
    { path: '/w/no-remote', slug: null },
  ];

  it('matches the origin slug case-insensitively, main checkout before worktree, shortest first', () => {
    expect(pickRepoPath('HPMARTINI/orkumo', entries)).toBe('/w/Orkumo');
    expect(pickRepoPath('hpmartini/glen', entries)).toBe('/w/glen');
  });

  it('falls back to a worktree when it is the only checkout', () => {
    expect(pickRepoPath('hpmartini/Orkumo', entries.slice(0, 1))).toBe(entries[0].path);
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
      repository: { nameWithOwner: 'hpmartini/Orkumo' },
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
      } else if (q.includes('state stateReason parent{id}}')) {
        cb(
          null,
          JSON.stringify({ data: { node: { state: 'OPEN', stateReason: null, parent: null } } }),
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

// Routes each `gh api graphql` call by a substring of its query; unmatched calls get {"data":{}}.
// A route value is a JSON string, an Error (gh fails) or a function returning one of those or (cb) => void.
function routeGh(routes) {
  const calls = [];
  vi.mocked(execFile).mockImplementation((_cmd, args, _opts, cb) => {
    const q = String(args[3]);
    calls.push(args);
    const hit = routes.find(([needle]) => q.includes(needle));
    const out = hit ? (typeof hit[1] === 'function' ? hit[1]() : hit[1]) : '{"data":{}}';
    if (typeof out === 'function') return out(cb);
    if (out instanceof Error) return cb(out, '', out.message);
    cb(null, out, '');
  });
  return calls;
}

describe('boardService - writes vs. board fetches (#72)', () => {
  const source = { owner: 'hpmartini', number: 4 };
  const node = (id, over = {}) => ({
    id,
    fieldValueByName: { optionId: 'todo' },
    content: {
      __typename: 'Issue',
      id: `I_${id}`,
      number: 1,
      title: id,
      state: 'OPEN',
      repository: { nameWithOwner: 'hpmartini/Orkumo' },
      ...over,
    },
  });
  const boardPage = (nodes) =>
    JSON.stringify({
      data: {
        rateLimit: { cost: 1, remaining: 1 },
        repositoryOwner: {
          projectV2: {
            id: 'PVT_1',
            title: 'MACC',
            field: { id: 'F', options: [{ id: 'todo', name: 'Backlog' }] },
            items: { nodes, pageInfo: { hasNextPage: false } },
          },
        },
      },
    });
  const repoOptions = JSON.stringify({
    data: {
      repository: {
        id: 'R_1',
        labels: { nodes: [] },
        assignableUsers: { nodes: [] },
        milestones: { nodes: [] },
      },
    },
  });
  const created = JSON.stringify({
    data: { createIssue: { issue: { id: 'I_new', number: 99, url: 'u' } } },
  });
  const added = JSON.stringify({ data: { addProjectV2ItemById: { item: { id: 'PVTI_new' } } } });
  const refetched = (n) => JSON.stringify({ data: { node: n } });
  const ids = (board) => board.items.map((i) => i.itemId);
  const ITEM_Q = 'node(id:$id){... on ProjectV2Item';

  afterEach(() => vi.useRealTimers());

  it('keeps a created item when a refresh started before the create resolves afterwards', async () => {
    clearCache();
    let reads = 0;
    let releaseStale = null;
    routeGh([
      [
        'items(first',
        () =>
          reads++ === 0
            ? boardPage([node('PVTI_a')])
            : (cb) => (releaseStale = () => cb(null, boardPage([node('PVTI_a')]), '')),
      ],
      ['labels(first:100', repoOptions],
      ['createIssue(input', created],
      ['addProjectV2ItemById', added],
      [ITEM_Q, refetched(node('PVTI_new'))],
    ]);

    await getBoard(source);
    const refreshing = getBoard(source, { refresh: true });
    const item = await createIssue(source, { repo: 'hpmartini/Orkumo', title: 'new' });
    expect(item.itemId).toBe('PVTI_new');
    releaseStale();

    expect(ids(await refreshing)).toEqual(['PVTI_a', 'PVTI_new']);
    expect(ids(await getBoard(source))).toEqual(['PVTI_a', 'PVTI_new']);
  });

  it('keeps a created item missing from later fetches only within CREATE_GRACE_MS', async () => {
    clearCache();
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-10-25T10:00:00Z').getTime();
    vi.setSystemTime(t0);
    routeGh([
      ['items(first', boardPage([node('PVTI_a')])], // GitHub listing lags: never shows PVTI_new
      ['labels(first:100', repoOptions],
      ['createIssue(input', created],
      ['addProjectV2ItemById', added],
      [ITEM_Q, refetched(node('PVTI_new'))],
    ]);

    await getBoard(source);
    await createIssue(source, { repo: 'hpmartini/Orkumo', title: 'new' });

    vi.setSystemTime(t0 + 1000); // fetch starts after the create
    expect(ids(await getBoard(source, { refresh: true }))).toEqual(['PVTI_a', 'PVTI_new']);

    vi.setSystemTime(t0 + CREATE_GRACE_MS + 1);
    expect(ids(await getBoard(source, { refresh: true }))).toEqual(['PVTI_a']);
    expect(ids(await getBoard(source))).toEqual(['PVTI_a']);
  });

  it('createIssue: failed add-to-project rejects with the issue; retry with issueId resumes', async () => {
    clearCache();
    let addFails = true;
    const calls = routeGh([
      ['items(first', boardPage([node('PVTI_a')])],
      ['labels(first:100', repoOptions],
      ['createIssue(input', created],
      ['addProjectV2ItemById', () => (addFails ? new Error('boom') : added)],
      [ITEM_Q, refetched(node('PVTI_new'))],
    ]);

    const err = await createIssue(source, { repo: 'hpmartini/Orkumo', title: 'new' }).catch(
      (e) => e
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(502);
    expect(err.message).toMatch(/hpmartini\/Orkumo#99/);
    expect(err.details.issue).toMatchObject({ id: 'I_new', number: 99 });

    addFails = false;
    calls.length = 0;
    const item = await createIssue(source, {
      repo: 'hpmartini/Orkumo',
      title: 'new',
      issueId: 'I_new',
    });
    expect(calls.some((a) => String(a[3]).includes('createIssue('))).toBe(false);
    expect(calls.find((a) => String(a[3]).includes('addProjectV2ItemById'))).toContain(
      'contentId=I_new'
    );
    expect(item.itemId).toBe('PVTI_new');
    expect(ids(await getBoard(source))).toContain('PVTI_new');
  });

  const liveState = (state, stateReason = null, parent = null) =>
    JSON.stringify({ data: { node: { state, stateReason, parent } } });
  const STATE_Q = 'state stateReason parent{id}}';

  it('updateIssue: close decides from the live state, not the cache', async () => {
    clearCache();
    let calls = routeGh([
      ['items(first', boardPage([node('PVTI_i')])], // cache: OPEN
      [STATE_Q, liveState('CLOSED', 'NOT_PLANNED')],
      [ITEM_Q, refetched(node('PVTI_i', { state: 'CLOSED' }))],
    ]);
    await updateIssue(source, 'PVTI_i', { state: 'CLOSED', stateReason: 'NOT_PLANNED' });
    expect(calls.some((a) => String(a[3]).includes('closeIssue'))).toBe(false);

    clearCache();
    calls = routeGh([
      ['items(first', boardPage([node('PVTI_i', { state: 'CLOSED' })])], // cache: CLOSED
      [STATE_Q, liveState('OPEN')],
      [ITEM_Q, refetched(node('PVTI_i', { state: 'CLOSED' }))],
    ]);
    await updateIssue(source, 'PVTI_i', { state: 'CLOSED' });
    expect(calls.find((a) => String(a[3]).includes('closeIssue'))).toContain('reason=COMPLETED');
  });

  it('updateIssue: parent:null removes the issue from its live parent', async () => {
    clearCache();
    const stale = { id: 'I_cached', number: 1, title: 'p', repository: { nameWithOwner: 'x/y' } };
    const calls = routeGh([
      ['items(first', boardPage([node('PVTI_i', { parent: stale })])],
      [STATE_Q, liveState('OPEN', null, { id: 'I_live' })],
      [ITEM_Q, refetched(node('PVTI_i'))],
    ]);
    await updateIssue(source, 'PVTI_i', { parent: null });
    const remove = calls.find((a) => String(a[3]).includes('removeSubIssue'));
    expect(remove).toContain('parentId=I_live');
    expect(remove).toContain('subId=I_PVTI_i');
  });

  it('updateIssue: a failing later step rejects with the refetched item', async () => {
    clearCache();
    const subId = JSON.stringify({ data: { repository: { issue: { id: 'I_9' } } } });
    const calls = routeGh([
      ['items(first', boardPage([node('PVTI_i')])],
      ['issue(number:$number){id}', subId],
      ['addSubIssue(input', new Error('sub failed')],
      [ITEM_Q, refetched(node('PVTI_i', { title: 'New' }))],
    ]);
    const err = await updateIssue(source, 'PVTI_i', {
      title: 'New',
      addSubIssue: { repo: 'hpmartini/Orkumo', number: 9 },
    }).catch((e) => e);

    expect(calls.find((a) => String(a[3]).includes('updateIssue(input'))).toContain('title=New');
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(502);
    expect(err.details.item).toMatchObject({ itemId: 'PVTI_i', title: 'New' });
    expect((await getBoard(source)).items[0].title).toBe('New');
  });

  it('gh missing from PATH: names the CLI instead of a bare ENOENT (#106)', async () => {
    clearCache();
    const enoent = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
    routeGh([['', enoent]]);
    const err = await createIssue(source, { repo: 'hpmartini/Orkumo', title: 'new' }).catch(
      (e) => e
    );
    expect(err.status).toBe(502);
    expect(err.message).toMatch(/GitHub CLI \(gh\) nicht gefunden/);
  });
});

describe('boardService - issue comments (#104)', () => {
  afterEach(() => vi.mocked(execFile).mockReset());
  const page = (ids, next) =>
    JSON.stringify({
      data: {
        node: {
          comments: {
            pageInfo: { hasNextPage: !!next, endCursor: next ?? null },
            nodes: ids.map((id) => ({
              id,
              body: `b${id}`,
              createdAt: '2026-10-27T00:00:00Z',
              url: `u${id}`,
              author: id === 'C3' ? null : { login: 'hpmartini' },
            })),
          },
        },
      },
    });

  it('reads all pages in order and maps deleted authors to ghost', async () => {
    let n = 0;
    const calls = routeGh([
      ['comments(first:100', () => (n++ ? page(['C3']) : page(['C1', 'C2'], 'CUR'))],
    ]);
    const comments = await getIssueComments('I_1');
    expect(comments.map((c) => c.id)).toEqual(['C1', 'C2', 'C3']);
    expect(comments[2].author).toBe('ghost');
    expect(comments[0]).toEqual({
      id: 'C1',
      author: 'hpmartini',
      body: 'bC1',
      createdAt: '2026-10-27T00:00:00Z',
      url: 'uC1',
    });
    expect(calls[1]).toContain('after=CUR');
  });

  it('404s for an unknown issue', async () => {
    routeGh([['comments(first:100', '{"data":{"node":null}}']]);
    await expect(getIssueComments('I_x')).rejects.toMatchObject({ status: 404 });
  });

  it('posts the body via addComment and returns the fresh list', async () => {
    const calls = routeGh([
      ['addComment', '{"data":{"addComment":{"commentEdge":{"node":{"id":"C9"}}}}}'],
      ['comments(first:100', page(['C9'])],
    ]);
    const comments = await addIssueComment('I_1', 'Hallo\n> zitat');
    expect(calls[0]).toContain('body=Hallo\n> zitat');
    expect(calls[0]).toContain('id=I_1');
    expect(comments.map((c) => c.id)).toEqual(['C9']);
  });

  it("off-board issue: summary by id, label set resolved against the issue's own repo", async () => {
    let labels = [{ name: 'bug', color: 'f00' }];
    const summary = () =>
      JSON.stringify({
        data: {
          node: {
            id: 'I_5',
            number: 5,
            title: 'T',
            body: null,
            url: 'u',
            state: 'OPEN',
            repository: { nameWithOwner: 'o/offboard' },
            labels: { nodes: labels },
          },
        },
      });
    const calls = routeGh([
      ['labels(first:50)', summary],
      [
        'labels(first:100',
        JSON.stringify({
          data: {
            repository: {
              id: 'R',
              labels: {
                nodes: [
                  { id: 'LA_b', name: 'bug', color: 'f00' },
                  { id: 'LA_m', name: 'mw:build', color: '0f0' },
                ],
              },
              assignableUsers: { nodes: [] },
              milestones: { nodes: [] },
            },
          },
        }),
      ],
      [
        'updateIssue',
        () => {
          labels = [...labels, { name: 'mw:build', color: '0f0' }];
          return '{"data":{"updateIssue":{"issue":{"id":"I_5"}}}}';
        },
      ],
    ]);
    expect(await getIssueSummary('I_5')).toMatchObject({ repo: 'o/offboard', body: '', number: 5 });
    const after = await setIssueLabels('I_5', ['bug', 'mw:build']);
    const update = calls.find((a) => String(a[3]).includes('updateIssue'));
    expect(update).toContain('labelIds[]=LA_b');
    expect(update).toContain('labelIds[]=LA_m');
    expect(calls.some((a) => a.includes('owner=o') && a.includes('name=offboard'))).toBe(true);
    expect(after.labels.map((l) => l.name)).toEqual(['bug', 'mw:build']);
  });

  it('off-board summary 404s for an unknown node', async () => {
    routeGh([['labels(first:50)', '{"data":{"node":null}}']]);
    await expect(getIssueSummary('I_x')).rejects.toMatchObject({ status: 404 });
  });
});
