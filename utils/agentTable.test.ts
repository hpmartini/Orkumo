import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentSession } from '../types';
import type { AgentOverview } from './agentOverview';
import { buildRows, filterRows, groupRows, removeRetryOptions, sortRows } from './agentTable';
import { removeAgent, renameAgent, respawnAgent, stopAgent } from '../services/agentsApi';

const session = (over: Partial<AgentSession>): AgentSession =>
  ({
    id: 'a',
    sessionId: null,
    kind: 'background',
    cwd: '/p/Repo',
    startedAt: 1,
    name: 'a',
    state: null,
    pinned: false,
    order: null,
    links: [],
    displayState: 'idle',
    ...over,
  }) as AgentSession;

const empty: AgentOverview = {
  running: 0,
  needsInput: 0,
  working: 0,
  done: 0,
  cacheExpiring: [],
  needsCompaction: [],
};

const sessions = [
  session({ id: 'w', name: 'fix-login', displayState: 'working', updatedAt: 30 }),
  session({ id: 'n', name: 'docs', cwd: '/p/Other', displayState: 'needs-input', updatedAt: 10 }),
  session({
    id: 'd',
    name: 'done-one',
    cwd: '/p/Repo/.claude/worktrees/x',
    displayState: 'completed',
    startedAt: 20,
  }),
];
const overview: AgentOverview = {
  ...empty,
  cacheExpiring: [{ session: sessions[1], remainingMs: 5000 }],
  needsCompaction: [{ session: sessions[0], fill: 0.9 }],
};
const rows = buildRows(sessions, overview);

describe('buildRows', () => {
  it('assigns every bucket a session belongs to', () => {
    expect(rows.map((r) => r.buckets)).toEqual([
      ['running', 'working', 'compact'],
      ['running', 'needs-input', 'cache'],
      ['done'],
    ]);
    expect(rows[1].cacheMs).toBe(5000);
    expect(rows[0].fill).toBe(0.9);
  });
  it('uses the main repo as project and falls back to startedAt for activity', () => {
    expect(rows[2].project).toBe('Repo');
    expect(rows[2].lastActivity).toBe(20);
  });
});

describe('filterRows', () => {
  it('filters by bucket', () => {
    expect(filterRows(rows, 'running', '').map((r) => r.session.id)).toEqual(['w', 'n']);
    expect(filterRows(rows, 'cache', '').map((r) => r.session.id)).toEqual(['n']);
  });
  it('searches name, cwd and project case-insensitively', () => {
    expect(filterRows(rows, null, 'LOGIN').map((r) => r.session.id)).toEqual(['w']);
    expect(filterRows(rows, null, 'other').map((r) => r.session.id)).toEqual(['n']);
    expect(filterRows(rows, null, 'worktrees').map((r) => r.session.id)).toEqual(['d']);
    expect(filterRows(rows, 'done', 'login')).toEqual([]);
  });
});

describe('sortRows / groupRows', () => {
  it('sorts by last activity in both directions', () => {
    expect(sortRows(rows, 'desc').map((r) => r.session.id)).toEqual(['w', 'd', 'n']);
    expect(sortRows(rows, 'asc').map((r) => r.session.id)).toEqual(['n', 'd', 'w']);
  });
  it('groups by status in attention order and by project alphabetically', () => {
    const sorted = sortRows(rows, 'desc');
    expect(groupRows(sorted, 'status').map((g) => g.label)).toEqual([
      'Needs input',
      'Working',
      'Done',
    ]);
    const byProject = groupRows(sorted, 'project');
    expect(byProject.map((g) => [g.key, g.rows.map((r) => r.session.id)])).toEqual([
      ['Other', ['n']],
      ['Repo', ['w', 'd']],
    ]);
    expect(groupRows(sorted, 'none')).toEqual([{ key: 'all', label: '', rows: sorted }]);
  });
});

describe('removeRetryOptions', () => {
  it('turns server hints into the next delete options', () => {
    expect(removeRetryOptions({ removed: true, message: '' })).toBeNull();
    expect(
      removeRetryOptions({
        removed: false,
        message: 'unpushed',
        hints: { discardUnpushed: 'abc', forceRemoveWorktree: null },
      })
    ).toEqual({ discardUnpushed: 'abc' });
    expect(
      removeRetryOptions({
        removed: false,
        message: 'dirty',
        hints: { discardUnpushed: null, forceRemoveWorktree: '/wt' },
      })
    ).toEqual({ forceRemoveWorktree: '/wt' });
    expect(removeRetryOptions({ removed: false, message: 'no' })).toBeNull();
  });
});

describe('row actions hit the /api/agents routes', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stubFetch = (status = 200, body: unknown = {}) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };
  const call = (fetchMock: ReturnType<typeof stubFetch>) => {
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    return { url, method: init.method, body: init.body };
  };

  it('stop and respawn POST to /:id/stop and /:id/respawn', async () => {
    let f = stubFetch();
    await stopAgent('a b');
    expect(call(f)).toMatchObject({
      url: expect.stringMatching(/\/agents\/a%20b\/stop$/),
      method: 'POST',
    });
    f = stubFetch();
    await respawnAgent('x');
    expect(call(f)).toMatchObject({
      url: expect.stringMatching(/\/agents\/x\/respawn$/),
      method: 'POST',
    });
  });
  it('delete sends DELETE /:id with retry options and returns 409 results', async () => {
    const refused = {
      removed: false,
      message: 'm',
      hints: { discardUnpushed: 'h', forceRemoveWorktree: null },
    };
    const f = stubFetch(409, refused);
    expect(await removeAgent('x', { discardUnpushed: 'h' })).toEqual(refused);
    expect(call(f)).toEqual({
      url: expect.stringMatching(/\/agents\/x$/),
      method: 'DELETE',
      body: JSON.stringify({ discardUnpushed: 'h' }),
    });
  });
  it('rename PUTs the name to /:id/name', async () => {
    const f = stubFetch(200, { id: 'x', name: 'n' });
    await renameAgent('x', 'n');
    expect(call(f)).toEqual({
      url: expect.stringMatching(/\/agents\/x\/name$/),
      method: 'PUT',
      body: JSON.stringify({ name: 'n' }),
    });
  });
});
