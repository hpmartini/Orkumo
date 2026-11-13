import { describe, it, expect } from 'vitest';
import {
  agentFolder,
  boardUrl,
  codeRows,
  codeTargets,
  codeUrl,
  findCodeTarget,
  linkedAgentFolder,
  modeUrl,
  pushRecent,
  worktreesKey,
  type CodeGroup,
  type CodeRows,
} from '../utils/codeTarget';
import type { AgentContext } from '../types';

const ctx = (worktreePath: string | null) =>
  ({ repo: { worktreePath } }) as unknown as AgentContext;

describe('codeTarget', () => {
  it('codeUrl encodes the path', () => {
    expect(codeUrl('/a b/c')).toBe('/code?path=%2Fa%20b%2Fc');
  });

  it('boardUrl filters by repo and optionally by agent', () => {
    expect(boardUrl('o/r')).toBe('/board?repo=o%2Fr');
    expect(boardUrl('o/r', 'job1')).toBe('/board?repo=o%2Fr&agent=job1');
    expect(modeUrl('workflows')('o/r', 'job1')).toBe('/workflows?repo=o%2Fr&agent=job1');
  });

  it('agentFolder prefers the worktree over the cwd', () => {
    expect(agentFolder({ cwd: '/r/.claude/worktrees/x/sub' }, ctx('/r/.claude/worktrees/x'))).toBe(
      '/r/.claude/worktrees/x'
    );
    expect(agentFolder({ cwd: '/r' }, ctx(null))).toBe('/r');
    expect(agentFolder(undefined)).toBeNull();
  });

  it('linkedAgentFolder takes the first known agent', () => {
    const sessions = new Map([['b', { cwd: '/b' }]]);
    expect(linkedAgentFolder(['gone', 'b'], sessions)).toBe('/b');
    expect(linkedAgentFolder(['gone'], sessions)).toBeNull();
    expect(linkedAgentFolder(['b'], sessions, { b: ctx('/b/wt') })).toBe('/b/wt');
  });
});

describe('codeTargets', () => {
  const HOME = '/Users/dev';
  const P = `${HOME}/PROJECTS`;
  const L = `${HOME}/LABORATORY`;
  const app = (path: string, extra: Record<string, unknown> = {}) => ({
    name: path.split('/').pop()!,
    path,
    ...extra,
  });
  /** Group label → rows as `label[qualifier]` with children indented by `  ` */
  const outline = (groups: CodeGroup[]) =>
    Object.fromEntries(
      groups.map((g) => [
        g.label,
        g.projects.flatMap((p) => [
          `${p.label}${p.qualifier ? `[${p.qualifier}]` : ''}`,
          ...p.children.map((c) => `  ${c.label}${c.qualifier ? `[${c.qualifier}]` : ''}`),
        ]),
      ])
    );
  /** Section label → picker rows; the worktree toggle as `  +N` (`  -N` when open) */
  const rowsOutline = (result: CodeRows) =>
    Object.fromEntries(
      result.sections.map((s) => [
        s.label,
        s.rows.map((r) =>
          r.type === 'more'
            ? `  ${r.expanded ? '-' : '+'}${r.count}`
            : r.target === r.project
              ? r.target.label
              : `  ${r.target.label}`
        ),
      ])
    );

  it('groups projects by scan root with their worktrees nested', () => {
    const groups = codeTargets(
      [
        app(`${P}/zeta`, { worktrees: [`${P}/zeta/.claude/worktrees/fix-a`, `${HOME}/wt/zeta-b`] }),
        app(`${L}/alpha`),
        app(`${P}/beta`),
      ],
      [],
      HOME
    );
    expect(outline(groups)).toEqual({
      LABORATORY: ['alpha'],
      PROJECTS: ['beta', 'zeta', '  fix-a', '  zeta-b'],
    });
    const zeta = groups[1].projects[1];
    expect(zeta.display).toBe('~/PROJECTS/zeta');
    // Worktrees inside the project show their path from there, others from home
    expect(zeta.children.map((c) => [c.kind, c.display])).toEqual([
      ['worktree', '.claude/worktrees/fix-a'],
      ['worktree', '~/wt/zeta-b'],
    ]);
  });

  it('leaves out worktrees whose folder is gone, even when a stale agent dir names them', () => {
    const gone = `${HOME}/BENCH/wt/issue-1`;
    const groups = codeTargets(
      [app(`${P}/zeta`, { worktrees: [gone, `${HOME}/wt/b`], missingWorktrees: [gone] })],
      [{ path: gone }],
      HOME
    );
    expect(outline(groups)).toEqual({ PROJECTS: ['zeta', '  b'] });
  });

  it('shows the folder name unless the user named the project, and nests merged checkouts', () => {
    const groups = codeTargets(
      [
        app(`${P}/insta-feed`, { name: 'vite-starter' }),
        app(`${P}/devorbit`, {
          name: 'Orkumo',
          userNamed: true,
          paths: [`${P}/devorbit`, `${P}/devorbit-pro`],
        }),
      ],
      [],
      HOME
    );
    expect(groups[0].projects.map((p) => [p.label, p.detail])).toEqual([
      ['insta-feed', null],
      ['Orkumo', 'devorbit'],
    ]);
    expect(groups[0].projects[1].children.map((c) => [c.kind, c.label])).toEqual([
      ['checkout', 'devorbit-pro'],
    ]);
    // The package name stays searchable
    expect(rowsOutline(codeRows(groups, { query: 'vite' }))).toEqual({
      PROJECTS: ['insta-feed'],
    });
  });

  it('disambiguates duplicate labels by parent folder and drops case-variant duplicates', () => {
    const groups = codeTargets(
      [
        app(`${P}/magos`),
        app(`${HOME}/MAGOS`),
        app(`${P}/insta-feed`),
        app(`${P}/old/insta-feed`),
        app(`${L}/insta-feed`),
        app(`${HOME}/projects/beta`),
        app(`${P}/beta`),
      ],
      [{ path: `${HOME}/Projects/Beta/` }],
      HOME
    );
    // ~/projects and ~/PROJECTS are one scan root; a folder in home needs no extra: ~/MAGOS says it
    expect(outline(groups)).toEqual({
      '~': ['MAGOS'],
      LABORATORY: ['insta-feed[LABORATORY]'],
      PROJECTS: ['beta', 'insta-feed[PROJECTS]', 'insta-feed[old]', 'magos[PROJECTS]'],
    });
    expect(groups[2].projects[0].path).toBe(`${HOME}/projects/beta`);
  });

  it('puts agent folders outside every project last and adopts unlisted agent worktrees', () => {
    const groups = codeTargets(
      [app(`${P}/app`, { worktrees: [`${P}/app/.claude/worktrees/known`] })],
      [
        { path: `${P}/app` },
        { path: `${P}/app/src` },
        { path: `${P}/app/.claude/worktrees/known/sub` },
        { path: `${P}/app/.claude/worktrees/fresh` },
        { path: '/tmp/scratch' },
        { path: HOME },
      ],
      HOME
    );
    expect(outline(groups)).toEqual({
      PROJECTS: ['app', '  fresh', '  known'],
      'Other folders': ['dev', 'scratch'],
    });
    expect(groups[0].projects[0].children.map((c) => c.agent)).toEqual([true, true]);
    expect(groups.at(-1)!.projects.map((p) => [p.kind, p.display])).toEqual([
      ['folder', '~'],
      ['folder', '/tmp/scratch'],
    ]);
  });

  it('groups projects outside home by parent and directly in home under ~', () => {
    const groups = codeTargets([app('/opt/work/x'), app(`${HOME}/solo`)], [], HOME);
    expect(groups.map((g) => [g.label, g.projects[0].display])).toEqual([
      ['/opt/work', '/opt/work/x'],
      ['~', '~/solo'],
    ]);
  });

  describe('codeRows', () => {
    const wt = (project: string, name: string) => `${project}/.claude/worktrees/${name}`;
    const feed = `${P}/insta-feed`;
    const ork = `${P}/orkumo`;
    const groups = codeTargets(
      [
        app(feed, {
          worktrees: [wt(feed, 'fix-login'), ...[1, 2, 3].map((n) => `${HOME}/BENCH/issue-${n}`)],
        }),
        app(`${L}/insta-clone`),
        app(ork, {
          paths: [ork, `${P}/orkumo-pro`],
          worktrees: [wt(ork, 'fix-picker'), wt(ork, 'idle')],
        }),
      ],
      // An agent works in fix-picker
      [{ path: `${wt(ork, 'fix-picker')}/src` }],
      HOME
    );

    it('shows checkouts and worktrees with agents or open, the rest behind one toggle', () => {
      expect(rowsOutline(codeRows(groups))).toEqual({
        LABORATORY: ['insta-clone'],
        PROJECTS: ['insta-feed', '  +4', 'orkumo', '  orkumo-pro', '  fix-picker', '  +1'],
      });
      expect(rowsOutline(codeRows(groups, { current: `${HOME}/bench/ISSUE-2` }))).toMatchObject({
        PROJECTS: [
          'insta-feed',
          '  issue-2',
          '  +3',
          'orkumo',
          '  orkumo-pro',
          '  fix-picker',
          '  +1',
        ],
      });
      const open = codeRows(groups, { expanded: new Set([worktreesKey({ path: feed })]) });
      expect(rowsOutline(open).PROJECTS.slice(0, 6)).toEqual([
        'insta-feed',
        '  -4',
        '  fix-login',
        '  issue-1',
        '  issue-2',
        '  issue-3',
      ]);
      const toggle = codeRows(groups).sections[1].rows[1];
      expect(toggle).toMatchObject({ type: 'more', count: 4, all: true });
    });

    it('lists projects matching every term with their worktrees folded, case-insensitively', () => {
      const insta = codeRows(groups, { query: 'INSTA' });
      expect(rowsOutline(insta)).toEqual({
        LABORATORY: ['insta-clone'],
        PROJECTS: ['insta-feed', '  +4'],
      });
      expect([insta.projects, insta.worktrees]).toEqual([2, 0]);
      expect(rowsOutline(codeRows(groups, { query: 'laboratory insta' }))).toEqual({
        LABORATORY: ['insta-clone'],
      });
    });

    it('shows a worktree only when it matches by its own name or path', () => {
      const fix = codeRows(groups, { query: 'fix' });
      // Projects frame their matching worktrees without their other ones
      expect(rowsOutline(fix)).toEqual({
        PROJECTS: ['insta-feed', '  fix-login', 'orkumo', '  fix-picker'],
      });
      expect([fix.projects, fix.worktrees]).toEqual([0, 2]);
      // Terms may match the project too; a project matching only partly frames, without toggle
      expect(rowsOutline(codeRows(groups, { query: 'orkumo picker' }))).toEqual({
        PROJECTS: ['orkumo', '  fix-picker'],
      });
      // A fully matching project keeps its other worktrees behind the toggle
      expect(rowsOutline(codeRows(groups, { query: 'orkumo' }))).toEqual({
        PROJECTS: ['orkumo', '  orkumo-pro', '  +2'],
      });
      expect(rowsOutline(codeRows(groups, { query: 'bench' }))).toEqual({
        PROJECTS: ['insta-feed', '  issue-1', '  issue-2', '  issue-3'],
      });
      expect(codeRows(groups, { query: 'nothing-here' }).sections).toEqual([]);
    });

    it('finds a row and its project by path, case-insensitively', () => {
      const hit = findCodeTarget(groups, `${P}/ORKUMO/.claude/worktrees/fix-picker`);
      expect([hit?.project.label, hit?.target.label]).toEqual(['orkumo', 'fix-picker']);
      expect(findCodeTarget(groups, '/nope')).toBeNull();
    });
  });

  it('pushRecent moves a path to the front once and caps the list', () => {
    expect(pushRecent(['/b', '/A', '/c'], '/a', 3)).toEqual(['/a', '/b', '/c']);
  });
});
