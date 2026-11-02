import { describe, it, expect } from 'vitest';
import { dedupeDirectories, groupDirectories, shortenHome } from './directoryGroups';

const HOME = '/home/me';

/** Picker contents shaped like the #158 screenshots (neutral paths) */
const CHOICES = [
  { name: '~ (home)', path: HOME, source: 'home' },
  { name: '.claude', path: `${HOME}/.claude`, source: 'repo' },
  { name: '.config', path: `${HOME}/.config`, source: 'session' },
  {
    name: '03 Docs',
    path: `${HOME}/Drive/shared/03 Docs`,
    source: 'configured',
  },
  { name: 'ADMIN', path: `${HOME}/ADMIN`, source: 'repo' },
  { name: 'bakery-monorepo', path: `${HOME}/code/Bakery`, source: 'app' },
  { name: 'clip-tool', path: `${HOME}/Code/clip-tool`, source: 'session' },
  { name: 'clip-tool', path: `${HOME}/code/clip-tool`, source: 'app' },
  { name: 'site-a', path: `${HOME}/Sites/site-a`, source: 'session' },
  { name: 'devorbit-dashboard', path: `${HOME}/code/DevOrbitDashboard`, source: 'app' },
  { name: 'DevOrbitDashboard', path: `${HOME}/Code/DevOrbitDashboard`, source: 'session' },
  {
    name: 'issue-37-landing',
    path: `${HOME}/Code/DevOrbitDashboard/.claude/worktrees/issue-37-landing`,
    source: 'session',
  },
  { name: 'agentic', path: `${HOME}/Code/agentic/`, source: 'repo' },
];

const labels = (groups: ReturnType<typeof groupDirectories>) => groups.map((g) => g.label);
const names = (groups: ReturnType<typeof groupDirectories>, label: string | null) =>
  groups.find((g) => g.label === label)?.entries.map((e) => e.name);

describe('groupDirectories', () => {
  it('groups by parent directory with home shortened to ~ (AC-1)', () => {
    const groups = groupDirectories(CHOICES, { home: HOME });
    expect(labels(groups)).toEqual([null, '~', '~/Code', '~/Drive/shared', '~/Sites']);
    expect(names(groups, '~')).toEqual(['.claude', '.config', 'ADMIN']);
  });

  it('places worktrees in their repo group, right after the repo (AC-1)', () => {
    const projects = groupDirectories(CHOICES, { home: HOME }).find((g) => g.label === '~/Code')!;
    expect(projects.entries.map((e) => e.name)).toEqual([
      'agentic',
      'bakery-monorepo',
      'clip-tool',
      'DevOrbitDashboard',
      'issue-37-landing',
    ]);
    expect(projects.entries[4].detail).toBe('worktree of DevOrbitDashboard');
  });

  it('pins current then home on top, not repeated in their groups (AC-2)', () => {
    const current = `${HOME}/Sites/site-a`;
    const groups = groupDirectories(CHOICES, { home: HOME, current });
    expect(groups[0].entries.map((e) => e.path)).toEqual([current, HOME]);
    expect(groups.find((g) => g.label === '~/Sites')).toBeUndefined();
  });

  it('sorts groups and entries case-insensitively (AC-2)', () => {
    const groups = groupDirectories(
      [
        { name: 'beta', path: '/b/beta', source: 'repo' },
        { name: 'Alpha', path: '/b/Alpha', source: 'repo' },
        { name: 'x', path: '/A/x', source: 'repo' },
      ],
      {}
    );
    expect(labels(groups)).toEqual(['/A', '/b']);
    expect(names(groups, '/b')).toEqual(['Alpha', 'beta']);
  });

  it('filters by name and path and drops empty groups (AC-4)', () => {
    const groups = groupDirectories(CHOICES, { home: HOME, query: 'dev' });
    expect(labels(groups)).toEqual(['~/Code']);
    expect(names(groups, '~/Code')).toEqual(['DevOrbitDashboard', 'issue-37-landing']);
    expect(groupDirectories(CHOICES, { home: HOME, query: 'Sites' })[0].entries[0].name).toBe(
      'site-a'
    );
  });
});

describe('dedupeDirectories (AC-3)', () => {
  it('merges paths that differ only in case and keeps the real spelling', () => {
    const clip = dedupeDirectories(CHOICES).filter((e) =>
      e.path.toLowerCase().endsWith('clip-tool')
    );
    expect(clip).toHaveLength(1);
    expect(clip[0].path).toBe(`${HOME}/Code/clip-tool`);
    expect(clip[0].sources).toEqual(['session', 'app']);
  });

  it('prefers the name of the higher-ranked source and shows the basename as detail', () => {
    const dev = dedupeDirectories(CHOICES).find((e) => e.path.endsWith('/DevOrbitDashboard'))!;
    expect(dev.name).toBe('DevOrbitDashboard');
    expect(dev.detail).toBeNull();
    const bake = dedupeDirectories(CHOICES).find((e) => e.name === 'bakery-monorepo')!;
    expect(bake.detail).toBe('Bakery');
  });

  it('treats a trailing slash as the same directory', () => {
    const entries = dedupeDirectories([
      { name: 'a', path: '/x/a/', source: 'repo' },
      { name: 'a', path: '/x/a', source: 'session' },
    ]);
    expect(entries).toEqual([
      { name: 'a', path: '/x/a', sources: ['repo', 'session'], detail: null, aliases: [] },
    ]);
  });
});

describe('shortenHome', () => {
  it('only shortens real children of home', () => {
    expect(shortenHome('/home/mex/a', HOME)).toBe('/home/mex/a');
    expect(shortenHome(`${HOME}/a`, HOME)).toBe('~/a');
    expect(shortenHome(HOME, HOME)).toBe('~');
  });
});

describe('review follow-ups', () => {
  it('keeps names of merged spellings searchable', () => {
    const groups = groupDirectories(
      [
        { name: 'shop-monorepo', path: '/w/Shop', source: 'app' },
        { name: 'Shop', path: '/w/shop', source: 'session' },
      ],
      { query: 'monorepo' }
    );
    expect(groups[0].entries.map((e) => e.name)).toEqual(['Shop']);
  });

  it('keeps worktrees after their repo even when a sibling shares the prefix', () => {
    const groups = groupDirectories([
      { name: 'App', path: '/w/App', source: 'repo' },
      { name: 'App-v2', path: '/w/App-v2', source: 'repo' },
      { name: 'zz', path: '/w/App/.claude/worktrees/zz', source: 'session' },
      { name: 'aa', path: '/w/App/.claude/worktrees/aa', source: 'session' },
    ]);
    expect(groups[0].entries.map((e) => e.name)).toEqual(['App', 'aa', 'zz', 'App-v2']);
  });

  it('uses the display name of the repo to place its worktrees', () => {
    const groups = groupDirectories([
      { name: 'alpha-app', path: '/w/zeta', source: 'app' },
      { name: 'beta', path: '/w/beta', source: 'repo' },
      { name: 'wt', path: '/w/zeta/.claude/worktrees/wt', source: 'session' },
    ]);
    expect(groups[0].entries.map((e) => e.name)).toEqual(['alpha-app', 'wt', 'beta']);
  });
});
