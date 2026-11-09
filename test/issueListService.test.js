import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFile } from 'child_process';

vi.mock('child_process', () => {
  const execFile = vi.fn();
  return { execFile, default: { execFile } };
});

const { contextRepos, listIssues, mapIssue, isOnBoard, clearIssueCache } =
  await import('../server/services/issueListService.js');

const source = { owner: 'hpmartini', number: 4 };

const node = (number, { projects = [], state = 'OPEN', updatedAt } = {}) => ({
  id: `I_${number}`,
  number,
  title: `Issue ${number}`,
  url: `https://github.com/o/r/issues/${number}`,
  state,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: updatedAt ?? `2026-01-0${number}T00:00:00Z`,
  closedAt: null,
  author: { login: 'hape' },
  labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
  assignees: { nodes: [{ login: 'hape' }] },
  milestone: { title: 'v1' },
  comments: { totalCount: 3 },
  projectItems: {
    nodes: projects.map(([login, n]) => ({ project: { number: n, owner: { login } } })),
  },
});

const page = (nodes, hasNextPage = false) =>
  JSON.stringify({
    data: {
      repository: { issues: { pageInfo: { hasNextPage, endCursor: 'c1' }, nodes } },
    },
  });

/** Value of `-f name=value` in a gh argument list */
const ghVar = (args, name) =>
  args
    .find((a, i) => args[i - 1] === '-f' && String(a).startsWith(`${name}=`))
    ?.slice(name.length + 1);

beforeEach(() => {
  clearIssueCache();
  vi.mocked(execFile).mockReset();
});

describe('issueListService - mapIssue / isOnBoard', () => {
  it('maps a GraphQL node and flags items of the board project (owner case-insensitive)', () => {
    expect(mapIssue(node(1, { projects: [['HPMartini', 4]] }), 'o/r', source)).toEqual({
      id: 'I_1',
      repo: 'o/r',
      number: 1,
      title: 'Issue 1',
      url: 'https://github.com/o/r/issues/1',
      state: 'open',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      closedAt: null,
      author: 'hape',
      labels: [{ name: 'bug', color: 'd73a4a' }],
      assignees: ['hape'],
      milestone: 'v1',
      comments: 3,
      onBoard: true,
    });
  });

  it('is not on the board in another project or of another owner', () => {
    expect(isOnBoard(node(1, { projects: [['hpmartini', 5]] }), source)).toBe(false);
    expect(isOnBoard(node(1, { projects: [['someone', 4]] }), source)).toBe(false);
    expect(isOnBoard(node(1), source)).toBe(false);
  });
});

describe('issueListService - listIssues', () => {
  it('lists every repo newest first; a failing repo lands in errors, not in a failed response', async () => {
    vi.mocked(execFile).mockImplementation((_cmd, args, _opts, cb) => {
      const repo = `${ghVar(args, 'owner')}/${ghVar(args, 'name')}`;
      if (repo === 'o/broken') {
        cb(
          null,
          JSON.stringify({ errors: [{ message: 'Could not resolve to a Repository' }] }),
          ''
        );
      } else if (repo === 'o/r') {
        cb(null, page([node(1, { projects: [['hpmartini', 4]] }), node(3)]), '');
      } else {
        cb(null, page([node(2)]), '');
      }
    });

    const result = await listIssues(['o/r', 'o/broken', 'o/other'], { source });

    expect(result.repos).toEqual(['o/r', 'o/broken', 'o/other']);
    expect(result.issues.map((i) => `${i.repo}#${i.number}:${i.onBoard}`)).toEqual([
      'o/r#3:false',
      'o/other#2:false',
      'o/r#1:true',
    ]);
    expect(result.errors).toEqual([
      { repo: 'o/broken', message: 'GitHub: Could not resolve to a Repository' },
    ]);
  });

  it('asks for the requested state, caches per repo and state, and refresh bypasses the cache', async () => {
    vi.mocked(execFile).mockImplementation((_cmd, _args, _opts, cb) =>
      cb(null, page([node(1, { state: 'CLOSED' })]), '')
    );

    const first = await listIssues(['o/r'], { state: 'closed', source });
    expect(first.issues[0].state).toBe('closed');
    expect(ghVar(vi.mocked(execFile).mock.calls[0][1], 'states[]')).toBe('CLOSED');

    await listIssues(['o/r'], { state: 'closed', source });
    expect(execFile).toHaveBeenCalledTimes(1);
    await listIssues(['o/r'], { state: 'closed', source, refresh: true });
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it('pages open issues with the cursor', async () => {
    vi.mocked(execFile).mockImplementation((_cmd, args, _opts, cb) =>
      cb(null, ghVar(args, 'after') ? page([node(2)]) : page([node(1)], true), '')
    );
    const { issues } = await listIssues(['o/r'], { source });
    expect(issues.map((i) => i.number).sort()).toEqual([1, 2]);
    expect(ghVar(vi.mocked(execFile).mock.calls[1][1], 'after')).toBe('c1');
  });
});

describe('issueListService - contextRepos', () => {
  const apps = [
    { id: 'a', path: '/w/a' },
    { id: 'b', path: '/w/b' },
    { id: 'c', path: '/w/c' },
    { id: 'a-sub', path: '/w/a/sub' },
  ];
  const remotes = {
    '/w/a': 'git@github.com:o/a.git\n',
    '/w/a/sub': 'https://github.com/O/A.git\n',
    '/w/b': 'https://github.com/o/b\n',
  };

  beforeEach(() => {
    vi.mocked(execFile).mockImplementation((_cmd, _args, opts, cb) => {
      const remote = remotes[opts.cwd];
      if (remote) cb(null, remote, '');
      else cb(Object.assign(new Error('no remote'), { code: 2 }), '', '');
    });
  });

  it('appIds null covers every app; duplicate slugs and apps without remote drop out', async () => {
    expect(await contextRepos({ appIds: null, boardFilter: [] }, apps)).toEqual(['o/a', 'o/b']);
  });

  it('uses only the member apps plus the repo slices of the board filter', async () => {
    expect(
      await contextRepos(
        { appIds: ['b'], boardFilter: ['repo:x/off-board', 'label:bug', 'repo:o/B', 'repo:bad'] },
        apps
      )
    ).toEqual(['o/b', 'x/off-board']);
  });
});
