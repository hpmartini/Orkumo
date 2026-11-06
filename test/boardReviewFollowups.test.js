// Review follow-ups from #82 (#88): paging, cold-cache create, -f/-F split, typed mutation, repo guard
import { describe, it, expect, vi, afterEach } from 'vitest';
import { execFile } from 'child_process';

vi.mock('child_process', () => {
  const execFile = vi.fn();
  return { execFile, default: { execFile } };
});

const {
  getRepoOptions,
  resolveIssueRefs,
  getIssueDetails,
  createIssue,
  clearCache,
  updateIssueMutation,
  assertRepoWritable,
  MAX_PAGES,
} = await import('../server/services/boardService.js');

const json = (data) => JSON.stringify({ data });
const argOf = (args, key) =>
  args.find((a) => String(a).startsWith(`${key}=`))?.slice(key.length + 1);

// Routes `gh api graphql` calls by a predicate on (query, args); records every call
function routeGh(routes) {
  const calls = [];
  vi.mocked(execFile).mockImplementation((_cmd, args, _opts, cb) => {
    const q = String(args[3]);
    calls.push(args);
    const hit = routes.find(([match]) => match(q, args));
    cb(null, hit ? hit[1](q, args) : json({}), '');
  });
  return calls;
}
const has = (needle) => (q) => q.includes(needle);

const page = (nodes, endCursor = null) => ({
  pageInfo: { hasNextPage: endCursor !== null, endCursor },
  nodes,
});
const labels = (from, to) =>
  Array.from({ length: to - from }, (_, i) => ({
    id: `LA_${from + i}`,
    name: `l${from + i}`,
    color: 'fff',
  }));

// Repo with 101 labels, 101 assignable users and 51 open milestones (two pages each)
function bigRepoRoutes() {
  return [
    [
      (q) => q.includes('id labels(first:100') && !q.includes('$after'),
      () =>
        json({
          repository: {
            id: 'R_1',
            labels: page(labels(0, 100), 'L1'),
            assignableUsers: page(
              Array.from({ length: 100 }, (_, i) => ({ id: `U_${i}`, login: `u${i}` })),
              'A1'
            ),
            milestones: page(
              Array.from({ length: 50 }, (_, i) => ({ id: `M_${i}`, title: `m${i}` })),
              'M1'
            ),
          },
        }),
    ],
    [
      (q, a) => q.includes('{labels(first:100,after:$after') && argOf(a, 'after') === 'L1',
      () =>
        json({ repository: { labels: page([{ id: 'LA_deep', name: 'deep-label', color: '0' }]) } }),
    ],
    [
      (q, a) => q.includes('{assignableUsers(first:100,after:$after') && argOf(a, 'after') === 'A1',
      () => json({ repository: { assignableUsers: page([{ id: 'U_deep', login: 'deep-user' }]) } }),
    ],
    [
      (q, a) => q.includes('{milestones(first:100,after:$after') && argOf(a, 'after') === 'M1',
      () => json({ repository: { milestones: page([{ id: 'M_deep', title: 'deep-ms' }]) } }),
    ],
  ];
}

afterEach(() => vi.useRealTimers());

describe('getRepoOptions paging (AC-1)', () => {
  it('collects label 101+, assignee 101+ and milestone 51+ via after-cursor follow-up pages', async () => {
    const calls = routeGh(bigRepoRoutes());
    const opts = await getRepoOptions('o/big', { refresh: true });
    expect(opts.labels).toHaveLength(101);
    expect(opts.assignees).toHaveLength(101);
    expect(opts.milestones).toHaveLength(51);
    expect(
      resolveIssueRefs(opts, {
        labels: ['deep-label'],
        assignees: ['deep-user'],
        milestone: 'deep-ms',
      })
    ).toEqual({
      labelIds: ['LA_deep'],
      assigneeIds: ['U_deep'],
      milestoneId: 'M_deep',
    });
    expect(
      calls
        .map((a) => argOf(a, 'after'))
        .filter(Boolean)
        .sort()
    ).toEqual(['A1', 'L1', 'M1']);
  });
});

describe('getRepoOptions cache (AC-8)', () => {
  it('serves from cache for 5 min, refetches after the TTL and on refresh', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-11-06T10:00:00Z').getTime();
    vi.setSystemTime(t0);
    const calls = routeGh([
      [
        has('id labels(first:100'),
        () =>
          json({
            repository: {
              id: 'R',
              labels: page([]),
              assignableUsers: page([]),
              milestones: page([]),
            },
          }),
      ],
    ]);
    await getRepoOptions('o/ttl', { refresh: true });
    await getRepoOptions('o/ttl');
    vi.setSystemTime(t0 + 5 * 60_000 - 1);
    await getRepoOptions('o/ttl');
    expect(calls).toHaveLength(1);
    vi.setSystemTime(t0 + 5 * 60_000);
    await getRepoOptions('o/ttl');
    expect(calls).toHaveLength(2);
    await getRepoOptions('o/ttl', { refresh: true });
    expect(calls).toHaveLength(3);
  });
});

describe('getIssueDetails paging (AC-2)', () => {
  it('returns all sub-issues across pages (more than 50)', async () => {
    const sub = (n) => ({
      id: `I_${n}`,
      number: n,
      title: `s${n}`,
      state: 'OPEN',
      repository: { nameWithOwner: 'o/r' },
    });
    routeGh([
      [
        (q, a) => q.includes('subIssues(first:100') && !argOf(a, 'after'),
        () =>
          json({
            node: {
              body: 'b',
              subIssues: page(
                Array.from({ length: 100 }, (_, i) => sub(i)),
                'S1'
              ),
            },
          }),
      ],
      [
        (q, a) => q.includes('subIssues(first:100') && argOf(a, 'after') === 'S1',
        () => json({ node: { body: 'b', subIssues: page([sub(100), sub(101)]) } }),
      ],
    ]);
    const details = await getIssueDetails('I_parent');
    expect(details.body).toBe('b');
    expect(details.subIssues).toHaveLength(102);
    expect(details.subIssues.at(-1)).toMatchObject({ id: 'I_101', repo: 'o/r', number: 101 });
  });
});

describe('paging stops (AC-3)', () => {
  it('rejects after MAX_PAGES when GitHub always reports hasNextPage', async () => {
    let n = 0;
    const calls = routeGh([
      [
        has('subIssues(first:100'),
        () => json({ node: { body: '', subIssues: page([], `C${n++}`) } }),
      ],
    ]);
    await expect(getIssueDetails('I_loop')).rejects.toMatchObject({ status: 502 });
    expect(MAX_PAGES).toBe(20);
    expect(calls).toHaveLength(MAX_PAGES);
  });
});

describe('createIssue on a cold cache (AC-4) and -f/-F split (AC-5)', () => {
  it('never runs the all-items board query and keeps an @-string behind -f', async () => {
    clearCache();
    const calls = routeGh([
      [
        has('fragment M on ProjectV2'),
        () =>
          json({
            repositoryOwner: {
              projectV2: {
                id: 'PVT_1',
                field: { id: 'F', options: [{ id: 'bl', name: 'Backlog' }] },
              },
            },
          }),
      ],
      [
        has('id labels(first:100'),
        () =>
          json({
            repository: {
              id: 'R_1',
              labels: page([]),
              assignableUsers: page([]),
              milestones: page([]),
            },
          }),
      ],
      [
        has('createIssue(input'),
        () => json({ createIssue: { issue: { id: 'I_n', number: 5, url: 'u' } } }),
      ],
      [
        has('addProjectV2ItemById'),
        () => json({ addProjectV2ItemById: { item: { id: 'PVTI_n' } } }),
      ],
      [
        has('node(id:$id){... on ProjectV2Item'),
        () =>
          json({
            node: {
              id: 'PVTI_n',
              content: {
                __typename: 'Issue',
                id: 'I_n',
                number: 5,
                title: '@/etc/passwd',
                repository: { nameWithOwner: 'o/r' },
              },
            },
          }),
      ],
    ]);
    const item = await createIssue(
      { owner: 'o', number: 1 },
      { repo: 'o/r', title: '@/etc/passwd', milestone: null }
    );
    expect(item.itemId).toBe('PVTI_n');
    expect(calls.some((a) => String(a[3]).includes('items(first'))).toBe(false);
    const create = calls.find((a) => String(a[3]).includes('createIssue(input'));
    const i = create.indexOf('title=@/etc/passwd');
    expect(create[i - 1]).toBe('-f');
    expect(create[create.indexOf('milestoneId=null') - 1]).toBe('-F');
    for (const args of calls) {
      args.forEach((a, k) => {
        if (a === '-F') expect(args[k + 1]).toMatch(/^[A-Za-z]+(=(null|\d+))?(\[\])?$/);
      });
    }
  });
});

describe('updateIssueMutation (AC-6)', () => {
  it('types each known field from the map', () => {
    expect(updateIssueMutation(['title', 'body', 'labelIds', 'assigneeIds', 'milestoneId'])).toBe(
      'mutation($id:ID!,$title:String,$body:String,$labelIds:[ID!],$assigneeIds:[ID!],$milestoneId:ID){updateIssue(input:{id:$id,title:$title,body:$body,labelIds:$labelIds,assigneeIds:$assigneeIds,milestoneId:$milestoneId}){issue{id}}}'
    );
  });
  it('throws for a key without a known type (no String fallback)', () => {
    expect(() => updateIssueMutation(['title', 'issueTypeIds'])).toThrow(/issueTypeIds/);
    expect(() => updateIssueMutation(['toString'])).toThrow(/toString/);
  });
});

describe('assertRepoWritable (AC-7)', () => {
  const source = { owner: 'o', number: 1 };
  const boardPage = json({
    rateLimit: { cost: 1, remaining: 1 },
    repositoryOwner: {
      projectV2: {
        id: 'PVT_1',
        title: 'B',
        field: { id: 'F', options: [] },
        items: page([
          {
            id: 'PVTI_1',
            content: {
              __typename: 'Issue',
              id: 'I_1',
              number: 1,
              repository: { nameWithOwner: 'O/OnBoard' },
            },
          },
        ]),
      },
    },
  });

  it('allows a repo with a local checkout without loading the board', async () => {
    clearCache();
    const calls = routeGh([]);
    await assertRepoWritable(source, 'o/local', async (s) => (s === 'o/local' ? '/x' : null));
    expect(calls).toHaveLength(0);
  });
  it('allows a repo with items on the board (case-insensitive), refuses any other with 403', async () => {
    clearCache();
    routeGh([[has('items(first'), () => boardPage]]);
    const none = async () => null;
    await expect(assertRepoWritable(source, 'o/onboard', none)).resolves.toBeUndefined();
    await expect(assertRepoWritable(source, 'o/foreign', none)).rejects.toMatchObject({
      status: 403,
    });
  });
});
