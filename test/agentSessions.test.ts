import { describe, it, expect } from 'vitest';
import {
  groupSessions,
  flattenGroups,
  summarizeSessions,
  sessionAgeMs,
  formatAge,
  prLabel,
  dirName,
  documentTitle,
  COMPLETED_VISIBLE_LIMIT,
  DEFAULT_SORT,
  sortSessionsBy,
  applyQuickFilters,
  applyLinkFilter,
  applyTextQuery,
  collectLinkEntries,
  matchesQuickFilter,
  matchServers,
  summarizeContext,
  mainRepoPath,
  repoName,
  displayRepo,
  formatModelName,
  groupRepoSlug,
  sessionsInContext,
  railItems,
  appOriginLabel,
  type SessionLookup,
} from '../utils/agentSessions';
import type { AgentContext, AgentSession } from '../types';

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
    displayState: partial.state === 'working' ? 'working' : 'completed',
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
      session({ id: 'phone', kind: 'app', state: null, displayState: 'idle' }),
    ];
    const groups = groupSessions(sessions, 'state');
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.sessions.map((s) => s.id)]));
    expect(byKey.pinned).toEqual(['pinned']);
    expect(byKey.review).toEqual(['review']);
    expect(byKey['needs-input']).toEqual(['blocked']);
    expect(byKey.working).toEqual(['working']);
    expect(byKey.completed).toEqual(['done']);
    expect(byKey.interactive).toEqual(['tty']);
    expect(byKey.app).toEqual(['phone']);
    expect(groups.find((g) => g.key === 'app')?.title).toBe('Claude App');
  });

  it('leaves out the Claude App and Interactive groups while they are empty', () => {
    const keys = (sessions: AgentSession[]) =>
      railItems(groupSessions(sessions, 'state'), new Set(), 'state')
        .filter((item) => item.type === 'group')
        .map((item) => (item.type === 'group' ? item.group.key : ''));
    expect(keys([session({ id: 'w', state: 'working' })])).not.toContain('app');
    expect(keys([session({ id: 'w', state: 'working' })])).not.toContain('interactive');
    expect(keys([session({ id: 'p', kind: 'app', state: null })])).toContain('app');
  });

  it('labels a Claude app session by where it was started', () => {
    const app = (origin: string | null) =>
      session({
        kind: 'app',
        app: { url: 'https://claude.ai/code/session_x', origin, statusCategory: null },
      });
    expect(appOriginLabel(app('ios'))).toBe('iOS');
    expect(appOriginLabel(app('android'))).toBe('Android');
    expect(appOriginLabel(app(null))).toBe('Claude App');
    expect(appOriginLabel(session({ kind: 'interactive' }))).toBeNull();
  });

  it('puts a finished harness session into Completed, a running one into Interactive', () => {
    const omp = (id: string, state: AgentSession['state']) =>
      session({ id, kind: 'interactive', ptyCommand: 'omp', ptyArgs: ['-r', id], state });
    const groups = groupSessions([omp('done', 'done'), omp('live', null)], 'state');
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.sessions.map((s) => s.id)]));
    expect(byKey.completed).toEqual(['done']);
    expect(byKey.interactive).toEqual(['live']);
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
    expect(prLabel([openPr, { ...openPr, id: 'pr2', number: 2 }])?.text).toBe('2');
    expect(prLabel([])).toBeNull();
  });

  it('names directory groups by project, worktrees with their folder', () => {
    expect(dirName('/Users/x/PROJECTS/Orkumo')).toBe('Orkumo');
    expect(dirName('/Users/x/PROJECTS/App/.claude/worktrees/fix-1')).toBe('App · fix-1');
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

  describe('cache-expiring filter', () => {
    const MIN = 60_000;
    const cache = (lastActivityAt: number) => ({
      lastActivityAt,
      ttlMs: 60 * MIN,
      cachedTokens: 1000,
      contextWindow: 200_000,
      hits: 1,
      turns: 1,
      hitRatio: 1,
    });
    const ctx = (lastActivityAt: number) => ({ cache: cache(lastActivityAt) }) as AgentContext;
    // now = 60 min: cache of 'w' has 5 min left, 'b' 30 min, 'd' expired, 'f' has no cache
    const lookup: SessionLookup = {
      now: 60 * MIN,
      contexts: { w: ctx(5 * MIN), b: ctx(30 * MIN), d: ctx(-1 * MIN) },
    };

    it('matches only warm caches with at most 10 minutes left', () => {
      expect(
        all.filter((s) => matchesQuickFilter('cache-expiring', s, lookup)).map((s) => s.id)
      ).toEqual(['w']);
      expect(matchesQuickFilter('cache-expiring', working, {})).toBe(false);
      // exactly 10 min left counts, one ms more does not
      const edge = { contexts: { w: ctx(0) } };
      expect(matchesQuickFilter('cache-expiring', working, { ...edge, now: 50 * MIN })).toBe(true);
      expect(matchesQuickFilter('cache-expiring', working, { ...edge, now: 50 * MIN - 1 })).toBe(
        false
      );
    });

    it('follows the clock without new context data', () => {
      const at = (now: number) =>
        ids(applyQuickFilters(all, new Set(['cache-expiring']), { ...lookup, now }));
      expect(at(40 * MIN)).toBe(''); // 'w' still has 25 min
      expect(at(60 * MIN)).toBe('w');
      expect(at(81 * MIN)).toBe('b'); // 'w' expired, 'b' entered the window
    });

    it('combines with state chips using AND', () => {
      // 'w' is working, 'b' is blocked: only the working agent with an expiring cache stays
      const both = { ...lookup, contexts: { ...lookup.contexts, b: ctx(5 * MIN) } };
      expect(ids(applyQuickFilters(all, new Set(['cache-expiring']), both))).toBe('wb');
      expect(ids(applyQuickFilters(all, new Set(['working', 'cache-expiring']), both))).toBe('w');
      expect(ids(applyQuickFilters(all, new Set(['completed', 'cache-expiring']), both))).toBe('');
    });
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

  it('groups a worktree with its Orkumo app', () => {
    const sessions = [
      session({ id: 'a', cwd: '/code/api' }),
      session({ id: 'b', cwd: '/code/api/.claude/worktrees/agents-ui' }),
    ];
    const groups = groupSessions(sessions, 'project', { apps });
    expect(groups.map((g) => [g.key, g.title, g.sessions.length])).toEqual([
      ['project:api', 'api', 2],
    ]);
  });

  const repoCtx = (root: string, slug: string | null) =>
    ({ repo: { name: root.split('/').pop(), root, slug } }) as unknown as NonNullable<
      SessionLookup['contexts']
    >[string];

  it('merges root and subfolder sessions of one repo into an app matched case-insensitively', () => {
    // Issue #96: app stored as ~/projects/..., sessions run in ~/PROJECTS/... and a subfolder
    const sessions = [
      session({ id: 'r', cwd: '/Users/h/PROJECTS/MindHekker' }),
      session({ id: 's', cwd: '/Users/h/PROJECTS/MindHekker/MindHekker_v1' }),
    ];
    const lookup: SessionLookup = {
      contexts: {
        r: repoCtx('/Users/h/PROJECTS/MindHekker', 'hpmartini/glades'),
        s: repoCtx('/Users/h/PROJECTS/MindHekker', 'hpmartini/glades'),
      },
    };
    const mh = [{ id: 'mh', name: 'glades-monorepo', path: '/Users/h/projects/MindHekker' }];
    const groups = groupSessions(sessions, 'project', { apps: mh, lookup });
    expect(groups.map((g) => [g.key, g.title, g.sessions.length])).toEqual([
      ['project:mh', 'glades (MindHekker)', 2],
    ]);
  });

  it('groups unmatched subfolder sessions by repo root once contexts load', () => {
    const sessions = [
      session({ id: 'r', cwd: '/tmp/proj' }),
      session({ id: 's', cwd: '/tmp/proj/sub' }),
    ];
    // Before contexts: path-based keys, stable and deterministic
    expect(groupSessions(sessions, 'project').map((g) => g.key)).toEqual([
      'project:dir:/tmp/proj',
      'project:dir:/tmp/proj/sub',
    ]);
    const lookup: SessionLookup = {
      contexts: { r: repoCtx('/tmp/proj', null), s: repoCtx('/tmp/proj', null) },
    };
    const groups = groupSessions(sessions, 'project', { lookup });
    expect(groups.map((g) => [g.key, g.title, g.sessions.length])).toEqual([
      ['project:dir:/tmp/proj', 'proj', 2],
    ]);
  });

  it('groups a worktree outside the repo with its main checkout once contexts load', () => {
    const sessions = [
      session({ id: 'm', cwd: '/code/proj' }),
      session({ id: 'w', cwd: '/w/x' }),
      session({ id: 'c', cwd: '/code/proj/.claude/worktrees/feat' }),
    ];
    const lookup: SessionLookup = {
      contexts: {
        m: repoCtx('/code/proj', null),
        w: repoCtx('/code/proj', null),
        c: repoCtx('/code/proj', null),
      },
    };
    expect(
      groupSessions(sessions, 'project', { lookup }).map((g) => [g.key, g.title, g.sessions.length])
    ).toEqual([['project:dir:/code/proj', 'proj', 3]]);
  });

  it('titles by the GitHub repo name, folder in parentheses only when it differs', () => {
    const sessions = [session({ id: 'a', cwd: '/x/web' }), session({ id: 'b', cwd: '/x/old' })];
    const lookup: SessionLookup = {
      contexts: { a: repoCtx('/x/web', 'me/Web'), b: repoCtx('/x/old', 'me/new-name') },
    };
    expect(groupSessions(sessions, 'project', { lookup }).map((g) => g.title)).toEqual([
      'new-name (old)',
      'Web',
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

describe('displayRepo', () => {
  it('falls back to a worktree hint from the session when the context has no repo', () => {
    const s = session({
      cwd: '/a/proj/.claude/worktrees/feat',
      worktree: '/a/proj/.claude/worktrees/feat',
    });
    expect(displayRepo(s)).toMatchObject({
      name: 'proj',
      root: '/a/proj',
      branch: null,
      isWorktree: true,
      worktreeName: 'feat',
      worktreePath: '/a/proj/.claude/worktrees/feat',
    });
  });

  it('prefers the context repo and shows nothing without context or worktree', () => {
    const repo = { name: 'Real', branch: 'main', isWorktree: false };
    const ctx = { repo } as unknown as Parameters<typeof displayRepo>[1];
    expect(displayRepo(session({ worktree: '/a/proj/.claude/worktrees/feat' }), ctx)).toBe(repo);
    expect(displayRepo(session({ cwd: '/a/plain' }))).toBeNull();
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

describe('groupRepoSlug', () => {
  const a = session({ id: 'a' });
  const b = session({ id: 'b' });
  const contexts = { a: { repo: null }, b: { repo: { slug: 'o/r' } } };

  it('takes the first known slug of a project or directory group', () => {
    expect(groupRepoSlug({ cwd: '/r', sessions: [a, b] }, contexts)).toBe('o/r');
    expect(groupRepoSlug({ cwd: '/r', sessions: [a] }, contexts)).toBeNull();
  });

  it('ignores state groups, which mix repos', () => {
    expect(groupRepoSlug({ sessions: [b] }, contexts)).toBeNull();
  });
});

describe('sessionsInContext (#133)', () => {
  const apps = [
    { id: 'repo', name: 'repo', path: '/p/repo' },
    { id: 'web', name: 'web', path: '/p/repo/web' },
    { id: 'other', name: 'other', path: '/p/other' },
  ];
  const inRoot = session({ cwd: '/p/repo' });
  const inWeb = session({ cwd: '/p/repo/web/src' });
  const inWorktree = session({ cwd: '/p/other/.claude/worktrees/x' });
  const outside = session({ cwd: '/elsewhere' });
  const all = [inRoot, inWeb, inWorktree, outside];

  it('keeps every session for the "all" context', () => {
    expect(sessionsInContext(all, apps, null)).toEqual(all);
  });

  it('keeps sessions whose most specific app is a member', () => {
    expect(sessionsInContext(all, apps, ['repo', 'other'])).toEqual([inRoot, inWorktree]);
    expect(sessionsInContext(all, apps, ['web'])).toEqual([inWeb]);
  });
});

describe('PR / issue filter', () => {
  const pr = session({ id: 'p', links: [openPr] });
  const issue = session({ id: 'i' });
  const none = session({ id: 'n' });
  const issuesByAgent = new Map([['i', ['o/r#7']]]);

  it('lists open PRs first, then linked issues, with titles', () => {
    const entries = collectLinkEntries(
      [pr, issue, none],
      issuesByAgent,
      undefined,
      new Map([['o/r#7', 'Fix it']])
    );
    expect(entries.map((e) => [e.kind, e.label, e.title])).toEqual([
      ['pr', '#1', openPr.href],
      ['issue', '#7', 'Fix it'],
    ]);
  });

  it('keeps sessions linked to any selected entry', () => {
    const all = [pr, issue, none];
    const ids = (list: { id: string }[]) => list.map((s) => s.id).join('');
    expect(ids(applyLinkFilter(all, new Set(), issuesByAgent))).toBe('pin');
    expect(ids(applyLinkFilter(all, new Set(['issue:o/r#7']), issuesByAgent))).toBe('i');
    expect(
      ids(applyLinkFilter(all, new Set([`pr:${openPr.href}`, 'issue:o/r#7']), issuesByAgent))
    ).toBe('pi');
  });
});

describe('applyTextQuery (#198)', () => {
  const pr = { ...openPr, number: 42, title: 'Fix Login Flow' };
  const alpha = session({ id: 'a', name: 'Refactor rail', cwd: '/p/repo', agent: 'reviewer' });
  const beta = session({ id: 'b', name: 'Other', cwd: '/p/other/web', links: [pr] });
  const gamma = session({ id: 'c', name: 'Docs', cwd: '/p/repo', state: 'working' });
  const all = [alpha, beta, gamma];
  const lookup = {
    contexts: { c: { repo: { branch: 'feat/198-search' } } as unknown as AgentContext },
  };
  const issuesByAgent = new Map([['a', ['o/r#7']]]);
  const titles = new Map([['o/r#7', 'Board Spalte Briefed']]);
  const ids = (list: AgentSession[]) => list.map((s) => s.id).join('');
  const q = (text: string) => ids(applyTextQuery(all, text, issuesByAgent, lookup, titles));

  it('keeps everything for an empty or blank query', () => {
    expect(q('')).toBe('abc');
    expect(q('   ')).toBe('abc');
  });

  it('matches name, directory, agent, branch, PR and issue case-insensitively', () => {
    expect(q('RAIL')).toBe('a');
    expect(q('other/web')).toBe('b');
    expect(q('reviewer')).toBe('a');
    expect(q('198-search')).toBe('c');
    expect(q('#42')).toBe('b');
    expect(q('login')).toBe('b');
    expect(q('o/r#7')).toBe('a');
    expect(q('briefed')).toBe('a');
  });

  it('requires every word (AND)', () => {
    expect(q('repo docs')).toBe('c');
    expect(q('repo nothing')).toBe('');
  });

  it('only narrows the shown view: context and chip filters still apply', () => {
    const apps = [
      { id: 'repo', name: 'repo', path: '/p/repo' },
      { id: 'other', name: 'other', path: '/p/other' },
    ];
    // Same chain as the rail: context -> link filter -> chips -> text
    const shown = (ctx: string[] | null, chips: Set<'working'>, text: string) =>
      ids(
        applyTextQuery(
          applyQuickFilters(
            applyLinkFilter(sessionsInContext(all, apps, ctx), new Set(), issuesByAgent),
            chips
          ),
          text,
          issuesByAgent,
          lookup,
          titles
        )
      );
    expect(shown(null, new Set(), 'p/')).toBe('abc');
    expect(shown(['repo'], new Set(), 'p/')).toBe('ac');
    expect(shown(['repo'], new Set(), 'login')).toBe('');
    expect(shown(['repo'], new Set(['working']), 'p/')).toBe('c');
  });
});
