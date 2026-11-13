import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

let root;
vi.mock('../server/services/configService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getConfig: () => ({ directories: [root], scanDepth: 3, excludePatterns: ['node_modules'] }),
}));

const {
  scanDirectory,
  agentRepoPaths,
  mergeAgentRepos,
  gitRootInfo,
  projectCatalog,
  applyProjectOverrides,
  projectIdFor,
  validateProjectRoot,
} = await import('../server/services/scannerService.js');

const id = (p) => crypto.createHash('sha256').update(p).digest('hex').slice(0, 16);
const mkdir = (...parts) => {
  const dir = path.join(root, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'init.defaultBranch=main', ...args], { cwd });
/** A real repo with one commit, so `git worktree add` works */
const repo = (...parts) => {
  const dir = mkdir(...parts);
  git(dir, 'init', '-q');
  git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x');
  return dir;
};
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value));

beforeEach(() => {
  // realpath: /var is not scannable, /private/var is
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'scan133-')));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('gitRootInfo', () => {
  it('a .git directory is a main checkout', () => {
    const main = mkdir('main');
    mkdir('main', '.git');
    expect(gitRootInfo(main)).toEqual({ root: main, worktreeOf: null, worktreePath: null });
  });

  it('a worktree .git file resolves to its main checkout through commondir', () => {
    const main = repo('main');
    const wt = path.join(root, 'main-wt', 'feat');
    git(main, 'worktree', 'add', '-q', wt);
    expect(gitRootInfo(wt)).toEqual({ root: main, worktreeOf: main, worktreePath: wt });
  });

  it('a folder without .git, or with a pruned worktree link, is no repo', () => {
    expect(gitRootInfo(mkdir('plain'))).toBeNull();
    const dead = mkdir('dead');
    fs.writeFileSync(
      path.join(dead, '.git'),
      `gitdir: ${path.join(root, 'gone/.git/worktrees/x')}`
    );
    expect(gitRootInfo(dead)).toBeNull();
  });

  it('a .git file without commondir (submodule, separate git dir) is its own root', () => {
    const sub = mkdir('sub');
    mkdir('modules', 'sub');
    fs.writeFileSync(path.join(sub, '.git'), 'gitdir: ../modules/sub\n');
    expect(gitRootInfo(sub)).toEqual({ root: sub, worktreeOf: null, worktreePath: null });
  });
});

describe('scanner: only git main checkouts are projects', () => {
  it('lists a Git repo without package.json, not runnable', () => {
    const dir = mkdir('py-tool');
    mkdir('py-tool', '.git');
    const [project] = scanDirectory(root);
    expect(project).toMatchObject({ id: id(dir), path: dir, detectedFramework: 'Git' });
    expect(project.startCommand).toBeUndefined();
  });

  it('skips package.json-only folders; package.json only describes a repo', () => {
    writeJson(path.join(mkdir('no-git'), 'package.json'), { name: 'no-git' });
    const web = mkdir('web');
    mkdir('web', '.git');
    writeJson(path.join(web, 'package.json'), { name: 'web-app', dependencies: { vite: '1' } });
    expect(scanDirectory(root)).toEqual([
      expect.objectContaining({ path: web, name: 'web-app', detectedFramework: 'Vite' }),
    ]);
  });

  it('keeps finding nested repos inside a repo, not its package folders', () => {
    mkdir('mono', '.git');
    writeJson(path.join(mkdir('mono', 'packages', 'ui'), 'package.json'), { name: 'ui' });
    const nested = mkdir('mono', 'tools', 'cli');
    mkdir('mono', 'tools', 'cli', '.git');
    expect(scanDirectory(root).map((p) => p.path)).toEqual([path.join(root, 'mono'), nested]);
  });

  it('folds sibling worktrees into their main repo instead of listing them', () => {
    const main = repo('app');
    const sibling = path.join(root, 'app-wt', 'bun');
    git(main, 'worktree', 'add', '-q', sibling);
    writeJson(path.join(sibling, 'package.json'), { name: 'app' });
    const projects = scanDirectory(root);
    expect(projects.map((p) => p.path)).toEqual([main]);
    expect(projects[0].worktrees).toEqual([sibling]);
  });

  it('does not treat a stray worktree checkout (.git file) as a project', () => {
    const wt = mkdir('other', 'checkout');
    fs.writeFileSync(path.join(wt, '.git'), 'gitdir: /somewhere/.git/worktrees/x');
    expect(scanDirectory(root)).toEqual([]);
  });

  it('reads main repos from job state and merges uncovered ones by path', () => {
    const jobs = mkdir('jobs');
    const outside = mkdir('outside');
    mkdir('outside', '.git');
    const write = (job, state) => {
      mkdir('jobs', job);
      writeJson(path.join(jobs, job, 'state.json'), state);
    };
    write('a', { cwd: path.join(outside, '.claude', 'worktrees', 'feat') });
    write('b', { cwd: path.join(root, 'known', 'sub') });
    write('c', { cwd: path.join(root, 'gone') });
    mkdir('jobs', 'broken');

    const repos = agentRepoPaths(jobs);
    expect(repos).toContain(outside);

    const known = { id: 'k', path: path.join(root, 'KNOWN'), name: 'known' };
    const merged = mergeAgentRepos([known], repos);
    // Case-insensitive match keeps 'known/sub' in the scanned project; 'gone' has no .git
    expect(merged.map((p) => p.path)).toEqual([known.path, outside]);
    expect(merged[1].id).toBe(id(outside));
  });
});

describe('project overrides (settings.json)', () => {
  const detected = [
    { id: 'a', name: 'alpha', path: '/p/alpha', worktrees: ['/p/alpha-wt/x'] },
    { id: 'b', name: 'beta', path: '/p/beta', worktrees: [] },
    { id: 'c', name: 'gamma', path: '/p/gamma', worktrees: ['/p/gamma/.claude/worktrees/y'] },
    { id: 'd', name: 'delta', path: '/p/delta', worktrees: [] },
  ];

  it('disables, renames, merges and adds own projects', () => {
    const own = repo('own');
    const settings = {
      archived: ['d'],
      customNames: { a: 'Alpha App' },
      projectMerges: { c: 'b' },
      customProjects: [{ id: 'custom-1', name: 'Mine', paths: [own] }],
    };
    expect(applyProjectOverrides(detected, settings)).toEqual([
      expect.objectContaining({ id: 'a', name: 'Alpha App', userNamed: true, mergedIds: [] }),
      expect.objectContaining({
        id: 'b',
        name: 'beta',
        userNamed: false,
        paths: ['/p/beta', '/p/gamma'],
        worktrees: ['/p/gamma/.claude/worktrees/y'],
        mergedIds: ['c'],
      }),
      expect.objectContaining({ id: 'custom-1', name: 'Mine', path: own, source: 'custom' }),
    ]);
    const states = projectCatalog(detected, settings).map((p) => [p.id, p.state, p.mergedInto]);
    expect(states).toEqual([
      ['a', 'active', null],
      ['b', 'active', null],
      ['c', 'merged', 'b'],
      ['d', 'disabled', null],
      ['custom-1', 'active', null],
    ]);
  });

  it('follows merge chains; a disabled target hides what was merged into it', () => {
    const settings = { archived: ['b'], projectMerges: { c: 'a', a: 'b' } };
    expect(projectCatalog(detected, settings).find((p) => p.id === 'c').mergedInto).toBe('b');
    expect(applyProjectOverrides(detected, settings).map((p) => p.id)).toEqual(['d']);
  });

  it('resolves a session to the project holding its repo root, worktree or cwd', () => {
    const projects = applyProjectOverrides(detected, { projectMerges: { c: 'b' } });
    expect(projectIdFor(projects, { root: '/p/alpha', dirs: ['/elsewhere'] })).toBe('a');
    // a sibling worktree, also after it was deleted (no repo root anymore)
    expect(projectIdFor(projects, { root: null, dirs: ['/p/alpha-wt/x'] })).toBe('a');
    expect(projectIdFor(projects, { root: '/P/GAMMA', dirs: [] })).toBe('b');
    // the repo root wins over a cwd inside another project
    expect(projectIdFor(projects, { root: '/p/beta', dirs: ['/p/alpha/sub'] })).toBe('b');
    expect(projectIdFor(projects, { root: null, dirs: ['/Users/me/LABORATORY'] })).toBeNull();
  });

  it('accepts only git main checkouts as own project paths', () => {
    const main = repo('main');
    expect(validateProjectRoot(main)).toBe(main);
    expect(() => validateProjectRoot(mkdir('plain'))).toThrow(/Not a git repository/);
    const wt = path.join(root, 'main-wt');
    git(main, 'worktree', 'add', '-q', wt);
    expect(() => validateProjectRoot(wt)).toThrow(/worktree of .*add .*main instead/);
  });
});
