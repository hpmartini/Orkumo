import { describe, it, expect } from 'vitest';
import {
  groupSessions,
  flattenGroups,
  summarizeSessions,
  sessionAgeMs,
  formatAge,
  prLabel,
  documentTitle,
  COMPLETED_VISIBLE_LIMIT,
  DEFAULT_SORT,
  sortSessionsBy,
  applyQuickFilters,
  matchServers,
  summarizeContext,
  mainRepoPath,
  repoName,
  formatModelName,
  type SessionLookup,
} from '../utils/agentSessions';
import type { AgentSession } from '../types';

function session(partial: Partial<AgentSession>): AgentSession {
  return {
    id: Math.random().toString(36).slice(2, 10),
    sessionId: null,
    kind: 'background',
    cwd: '/home/dev/app',
    startedAt: 1000,
    name: 'session',
    state: 'done',
    pinned: false,
    order: null,
    links: [],
    displayState: 'completed',
    ...partial,
  };
}

const openPr = {
  id: 'pr',
  href: 'https://github.com/o/r/pull/1',
  title: null,
  number: 1,
  provider: 'github' as const,
  state: null,
};

describe('groupSessions (state)', () => {
  it('places sessions into pinned / review / needs input / working / completed', () => {
    const sessions = [
      session({ id: 'pinned', pinned: true, state: 'working' }),
      session({ id: 'review', links: [openPr] }),
      session({ id: 'blocked', state: 'blocked' }),
      session({ id: 'working', state: 'working' }),
      session({ id: 'done', state: 'done' }),
      session({ id: 'tty', kind: 'interactive', state: null }),
    ];
    const groups = groupSessions(sessions, 'state');
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.sessions.map((s) => s.id)]));
    expect(byKey.pinned).toEqual(['pinned']);
    expect(byKey.review).toEqual(['review']);
    expect(byKey['needs-input']).toEqual(['blocked']);
    expect(byKey.working).toEqual(['working']);
    expect(byKey.completed).toEqual(['done']);
    expect(byKey.interactive).toEqual(['tty']);
  });

  it('folds completed sessions but keeps failures and open PRs visible', () => {
    const sessions = [
      ...Array.from({ length: COMPLETED_VISIBLE_LIMIT + 4 }, (_, i) =>
        session({ id: `done-${i}`, startedAt: i })
      ),
      session({ id: 'failed', state: 'failed', startedAt: -1 }),
    ];
    const completed = groupSessions(sessions, 'state').find((g) => g.key === 'completed')!;
    expect(completed.sessions).toHaveLength(COMPLETED_VISIBLE_LIMIT);
    expect(completed.sessions.some((s) => s.id === 'failed')).toBe(true);
    expect(completed.hidden).toHaveLength(5);

    const expanded = groupSessions(sessions, 'state', { expandedCompleted: true }).find(
      (g) => g.key === 'completed'
    )!;
    expect(expanded.hidden).toHaveLength(0);
  });

  it('respects manual order before recency', () => {
    const sessions = [
      session({ id: 'newest', state: 'working', startedAt: 300 }),
      session({ id: 'ordered-second', state: 'working', startedAt: 100, order: 1 }),
      session({ id: 'ordered-first', state: 'working', startedAt: 50, order: 0 }),
    ];
    const working = groupSessions(sessions, 'state').find((g) => g.key === 'working')!;
    expect(working.sessions.map((s) => s.id)).toEqual([
      'ordered-first',
      'ordered-second',
      'newest',
    ]);
  });
});

describe('groupSessions (directory)', () => {
  it('groups by cwd and exposes the directory as dispatch target', () => {
    const sessions = [
      session({ id: 'a', cwd: '/x' }),
      session({ id: 'b', cwd: '/y' }),
      session({ id: 'c', cwd: '/x' }),
    ];
    const groups = groupSessions(sessions, 'directory');
    expect(groups.map((g) => g.cwd)).toEqual(['/x', '/y']);
    expect(groups[0].sessions.map((s) => s.id).sort()).toEqual(['a', 'c']);
  });
});

describe('flattenGroups', () => {
  it('skips collapsed groups and adds a "more" row', () => {
    const sessions = Array.from({ length: COMPLETED_VISIBLE_LIMIT + 2 }, (_, i) =>
      session({ id: `s${i}` })
    );
    const groups = groupSessions([...sessions, session({ id: 'w', state: 'working' })], 'state');
    const items = flattenGroups(groups, new Set(['working']));
    expect(items.filter((i) => i.type === 'more')).toHaveLength(1);
    const workingIndex = items.findIndex((i) => i.type === 'group' && i.group.key === 'working');
    expect(items[workingIndex + 1].type).toBe('group');
  });
});

describe('summaries and formatting', () => {
  it('counts awaiting input / working / completed / failed', () => {
    const counts = summarizeSessions([
      session({ state: 'blocked' }),
      session({ state: 'working' }),
      session({ state: 'done' }),
      session({ state: 'failed' }),
      session({ kind: 'interactive', state: null }),
    ]);
    expect(counts).toEqual({ awaitingInput: 1, working: 1, completed: 1, failed: 1 });
  });

  it('freezes the age of finished sessions', () => {
    const finished = session({ state: 'done', startedAt: 1000, updatedAt: 6000 });
    expect(sessionAgeMs(finished, 100000)).toBe(5000);
    const running = session({ state: 'working', startedAt: 1000 });
    expect(sessionAgeMs(running, 4000)).toBe(3000);
  });

  it('formats ages compactly', () => {
    expect(formatAge(15 * 1000)).toBe('15s');
    expect(formatAge(3 * 60 * 1000)).toBe('3m');
    expect(formatAge(5 * 3600 * 1000)).toBe('5h');
    expect(formatAge(3 * 86400 * 1000)).toBe('3d');
  });

  it('renders PR labels with provider prefixes and counts', () => {
    expect(prLabel([openPr])).toMatchObject({ text: '#1', href: openPr.href });
    expect(prLabel([{ ...openPr, provider: 'gitlab', number: 9 }])?.text).toBe('!9');
    expect(prLabel([openPr, { ...openPr, id: 'pr2', number: 2 }])?.text).toBe('2 PRs');
    expect(prLabel([])).toBeNull();
  });

  it('builds the document title', () => {
    expect(documentTitle(0)).toBe('claude agents');
    expect(documentTitle(2)).toBe('2 awaiting input · claude agents');
  });
});

describe('sorting, quick filters and server matching', () => {
  const blocked = session({ id: 'b', name: 'beta', state: 'blocked', startedAt: 1 });
  const working = session({ id: 'w', name: 'alpha', state: 'working', startedAt: 3 });
  const failed = session({ id: 'f', name: 'gamma', state: 'failed', startedAt: 2 });
  const done = session({ id: 'd', name: 'delta', state: 'done', startedAt: 4 });
  const all = [done, failed, working, blocked];
  const ids = (list: AgentSession[]) => list.map((s) => s.id).join('');

  it('sorts by attention by default', () => {
    expect(ids(sortSessionsBy(all, DEFAULT_SORT))).toBe('bwfd');
  });

  it('sorts by name, newest and oldest', () => {
    expect(ids(sortSessionsBy(all, { key: 'name', dir: 'asc' }))).toBe('wbdf');
    expect(ids(sortSessionsBy(all, { key: 'name', dir: 'desc' }))).toBe('fdbw');
    expect(ids(sortSessionsBy(all, { key: 'newest', dir: 'desc' }))).toBe('dwfb');
    expect(ids(sortSessionsBy(all, { key: 'oldest', dir: 'asc' }))).toBe('bfwd');
  });

  it('sorts by repository and running servers using the lookup', () => {
    const lookup: SessionLookup = {
      contexts: { w: { repo: { name: 'zeta' } }, b: { repo: { name: 'eta' } } } as never,
      servers: new Map([['f', [{ port: 3000, running: true, name: 'app' }]]]),
    };
    expect(ids(sortSessionsBy([working, blocked], { key: 'repo', dir: 'asc' }, lookup))).toBe('bw');
    expect(ids(sortSessionsBy(all, { key: 'servers', dir: 'desc' }, lookup))[0]).toBe('f');
  });

  it('applies the sort inside a flat list', () => {
    const groups = groupSessions(all, 'none', { sort: { key: 'name', dir: 'asc' } });
    expect(groups).toHaveLength(1);
    expect(ids(groups[0].sessions)).toBe('wbdf');
    expect(flattenGroups(groups, new Set()).every((i) => i.type === 'session')).toBe(true);
  });

  it('combines state chips with OR and attribute chips with AND', () => {
    const lookup: SessionLookup = {
      servers: new Map([['w', [{ port: 1, running: true, name: 'a' }]]]),
    };
    expect(ids(applyQuickFilters(all, new Set(['needs-input', 'working']), lookup))).toBe('wb');
    expect(ids(applyQuickFilters(all, new Set(['working', 'server']), lookup))).toBe('w');
    expect(ids(applyQuickFilters(all, new Set(['server', 'needs-input']), lookup))).toBe('');
  });

  it('matches apps by directory in both directions and parses ports from addresses', () => {
    const s = session({ cwd: '/work/repo/sub', worktree: '/work/repo/.wt/x' });
    const apps = [
      { name: 'root', path: '/work/repo', port: 3000, status: 'RUNNING' },
      { name: 'inner', path: '/work/repo/sub/web', addresses: ['http://localhost:5173/'] },
      { name: 'other', path: '/work/repo2', port: 9999, status: 'RUNNING' },
    ];
    expect(matchServers(s, apps)).toEqual([
      { port: 3000, running: true, name: 'root' },
      { port: 5173, running: false, name: 'inner' },
    ]);
  });

  it('totals unique running ports; unknown until contexts load', () => {
    const a = session({ id: 'a', links: [{ state: 'open' }, { state: 'merged' }] as never });
    const b = session({ id: 'b' });
    const server = { port: 3000, running: true, name: 'x' };
    const lookup: SessionLookup = {
      contexts: { a: undefined, b: undefined } as never,
      servers: new Map([
        ['a', [server]],
        ['b', [server]],
      ]),
    };
    expect(summarizeContext([a, b], lookup)).toEqual({ openPrs: 0, runningServers: 1 });
    expect(summarizeContext([a, b], {})).toEqual({ openPrs: null, runningServers: null });
  });
});

describe('groupSessions (project)', () => {
  const apps = [
    { id: 'web', name: 'web', path: '/code/web' },
    { id: 'web-admin', name: 'web-admin', path: '/code/web/admin' },
    { id: 'api', name: 'api', path: '/code/api' },
  ];

  it('clusters sessions per app, most specific path wins, worktrees count', () => {
    const sessions = [
      session({ id: 'a', cwd: '/code/web/src' }),
      session({ id: 'b', cwd: '/code/web/admin/x' }),
      session({ id: 'c', cwd: '/elsewhere', worktree: '/code/api/.claude/worktrees/w' }),
    ];
    const groups = groupSessions(sessions, 'project', { apps });
    expect(groups.map((g) => [g.key, g.appId, g.sessions.map((s) => s.id)])).toEqual([
      ['project:api', 'api', ['c']],
      ['project:web', 'web', ['a']],
      ['project:web-admin', 'web-admin', ['b']],
    ]);
    expect(groups[0].cwd).toBe('/code/api');
  });

  it('puts unmatched sessions into trailing clusters named after their directory', () => {
    const sessions = [
      session({ id: 'x', cwd: '/tmp/scratch' }),
      session({ id: 'y', cwd: '/tmp/scratch' }),
      session({ id: 'z', cwd: '/code/api' }),
    ];
    const groups = groupSessions(sessions, 'project', { apps });
    expect(groups.map((g) => g.key)).toEqual(['project:api', 'project:dir:/tmp/scratch']);
    expect(groups[1].appId).toBeUndefined();
    expect(groups[1].sessions).toHaveLength(2);
    // header rows are navigable items
    expect(flattenGroups(groups, new Set(), true).map((i) => i.type)).toEqual([
      'group',
      'session',
      'group',
      'session',
      'session',
    ]);
  });

  it('groups unmatched worktree sessions with their main repo before contexts load', () => {
    const sessions = [
      session({ id: 'm', cwd: '/tmp/proj' }),
      session({ id: 'w1', cwd: '/tmp/proj/.claude/worktrees/feat' }),
      session({ id: 'w2', cwd: '/tmp/proj', worktree: '/tmp/proj/.worktrees/fix' }),
    ];
    const groups = groupSessions(sessions, 'project', { apps });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: 'project:dir:/tmp/proj',
      title: 'proj',
      cwd: '/tmp/proj',
    });
    expect(groups[0].sessions).toHaveLength(3);
  });

  it('groups a worktree with its DevOrbit app', () => {
    const sessions = [
      session({ id: 'a', cwd: '/code/api' }),
      session({ id: 'b', cwd: '/code/api/.claude/worktrees/agents-ui' }),
    ];
    const groups = groupSessions(sessions, 'project', { apps });
    expect(groups.map((g) => [g.key, g.title, g.sessions.length])).toEqual([
      ['project:api', 'api', 2],
    ]);
  });
});

describe('repoName / mainRepoPath', () => {
  const ctx = (name: string) =>
    ({ repo: { name } }) as unknown as NonNullable<SessionLookup['contexts']>[string];

  it('derives the main repo from worktree paths', () => {
    expect(mainRepoPath('/a/proj/.claude/worktrees/x')).toBe('/a/proj');
    expect(mainRepoPath('/a/proj/.claude/worktrees/x/sub')).toBe('/a/proj');
    expect(mainRepoPath('/a/proj/.worktrees/x')).toBe('/a/proj');
    expect(mainRepoPath('/a/proj')).toBe('/a/proj');
    expect(mainRepoPath('/a/my.worktrees-x')).toBe('/a/my.worktrees-x');
  });

  it('prefers the context repo name, else the path-derived main name', () => {
    const s = session({ id: 's', cwd: '/a/proj/.claude/worktrees/feat' });
    expect(repoName(s)).toBe('proj');
    expect(repoName(s, { contexts: { s: ctx('Real') } })).toBe('Real');
    expect(repoName(session({ id: 't', cwd: '/a/plain' }))).toBe('plain');
  });
});

describe('formatModelName', () => {
  it.each([
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-sonnet-5-5', 'Sonnet 5.5'],
    ['claude-haiku-5-5', 'Haiku 5.5'],
    ['claude-fable-5-1', 'Fable 5.1'],
    ['claude-opus-5', 'Opus 5'],
    ['claude-opus-4-7', 'Opus 4.7'],
    ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
    ['claude-opus-4-20250514', 'Opus 4'],
    ['claude-3-5-sonnet-20241022', 'Sonnet 3.5'],
    ['claude-3-opus-20240229', 'Opus 3'],
    ['claude-opus-5-5[1m]', 'Opus 5.5'],
    ['sonnet', 'sonnet'],
    ['gpt-4o', 'gpt-4o'],
  ])('%s -> %s', (id, label) => {
    expect(formatModelName(id)).toBe(label);
  });

  it('ignores synthetic and empty ids', () => {
    expect(formatModelName('<synthetic>')).toBeNull();
    expect(formatModelName('')).toBeNull();
    expect(formatModelName(null)).toBeNull();
    expect(formatModelName(undefined)).toBeNull();
  });
});
