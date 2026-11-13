// Project detection and overrides through the real server (GET /api/apps, /api/projects, the
// project settings routes) against a throwaway scan dir and data dir.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAKE_CLAUDE = path.join(ROOT, 'test/fixtures/fake-gh/claude');
// realpath: macOS tmpdir lives under /var, which validatePath forbids
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'orkumo-projects-'));
const scan = path.join(root, 'scan');
const id = (p) => crypto.createHash('sha256').update(p).digest('hex').slice(0, 16);
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'init.defaultBranch=main', ...args], { cwd, stdio: 'ignore' });
const repo = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x');
  return dir;
};

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

describe('project routes', { timeout: 60_000 }, () => {
  let child;
  let base;
  let dataDir;
  const alpha = path.join(scan, 'alpha');
  const alphaWt = path.join(scan, 'alpha-wt');
  const beta = path.join(scan, 'beta');
  const gamma = path.join(scan, 'gamma');
  const outside = path.join(root, 'outside');
  // Missing at startup (unmounted volume, moved folder), created later
  const later = path.join(scan, 'later');
  const contextIds = () => [id(alpha), id(path.join(scan, 'demo')), id(later)];

  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const apps = async () => (await call('GET', '/api/apps')).body;

  beforeAll(async () => {
    fs.chmodSync(FAKE_CLAUDE, 0o755);
    repo(alpha);
    fs.writeFileSync(path.join(alpha, 'package.json'), JSON.stringify({ name: 'alpha' }));
    git(alpha, 'worktree', 'add', '-q', alphaWt);
    fs.writeFileSync(path.join(alphaWt, 'package.json'), JSON.stringify({ name: 'alpha' }));
    repo(beta);
    repo(gamma);
    repo(outside);
    // Not projects: a package.json-only folder and a plain folder
    fs.mkdirSync(path.join(scan, 'demo'));
    fs.writeFileSync(path.join(scan, 'demo', 'package.json'), '{"name":"demo"}');
    fs.mkdirSync(path.join(scan, 'cluster'));

    dataDir = fs.mkdtempSync(path.join(root, 'data-'));
    fs.mkdirSync(path.join(root, 'home'));
    fs.writeFileSync(
      path.join(dataDir, 'config.json'),
      JSON.stringify({ directories: [scan], scanDepth: 2, excludePatterns: ['node_modules'] })
    );
    // A context naming a folder the old scan listed and a repo that is not there yet
    fs.writeFileSync(
      path.join(dataDir, 'settings.json'),
      JSON.stringify({
        contexts: [
          { id: 'all', name: 'Alle', appIds: null, boardFilter: [] },
          {
            id: 'c1',
            name: 'Mixed',
            appIds: contextIds(),
            boardFilter: [],
          },
        ],
        activeContextId: 'all',
      })
    );
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['server/index.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        HOME: path.join(root, 'home'),
        CLAUDE_CLI_PATH: FAKE_CLAUDE,
        CLAUDE_CONFIG_DIR: path.join(root, 'no-claude'),
        SERVER_PORT: String(port),
        DEVORBIT_DATA_PATH: dataDir,
        DEVHUB_PREMIUM_DIR: '/nonexistent-orkumo-modules',
      },
      stdio: 'ignore',
    });
    for (let i = 0; i < 120; i++) {
      if (
        await fetch(`${base}/api/config`).then(
          (r) => r.ok,
          () => false
        )
      )
        return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('server did not start');
  }, 60_000);

  afterAll(() => {
    child?.kill();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('lists git main checkouts only; worktrees join their main repo', async () => {
    const list = await apps();
    expect(list.map((a) => a.path)).toEqual([alpha, beta, gamma]);
    expect(list[0]).toMatchObject({ id: id(alpha), worktrees: [alphaWt], paths: [alpha] });
  });

  it('names listed worktrees whose folder is gone in missingWorktrees', async () => {
    const gone = path.join(root, 'alpha-gone');
    git(alpha, 'worktree', 'add', '-q', gone);
    expect((await apps())[0].missingWorktrees).toEqual([]);
    fs.rmSync(gone, { recursive: true, force: true });
    const [listed] = await apps();
    expect(listed.worktrees).toContain(gone);
    expect(listed.missingWorktrees).toEqual([gone]);
    git(alpha, 'worktree', 'prune');
  });

  it('keeps context members that name no project; a repo that reappears is back', async () => {
    const stored = () =>
      JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8')).contexts.find(
        (c) => c.id === 'c1'
      ).appIds;
    expect(stored()).toEqual(contextIds());
    expect((await apps()).some((a) => a.id === id(later))).toBe(false);
    repo(later);
    expect((await apps()).some((a) => a.id === id(later))).toBe(true);
    expect(stored()).toEqual(contextIds());
    fs.rmSync(later, { recursive: true, force: true });
  });

  it('applies disable, merge and rename to GET /api/apps; /api/projects keeps them all', async () => {
    expect((await call('PUT', `/api/settings/archive/${id(gamma)}`, { value: true })).status).toBe(
      200
    );
    expect(
      (await call('PUT', `/api/settings/project-merge/${id(beta)}`, { into: id(alpha) })).status
    ).toBe(200);
    expect((await call('PUT', `/api/settings/name/${id(alpha)}`, { name: 'Alpha' })).status).toBe(
      200
    );

    expect(await apps()).toEqual([
      expect.objectContaining({
        id: id(alpha),
        name: 'Alpha',
        userNamed: true,
        paths: [alpha, beta],
        mergedIds: [id(beta)],
      }),
    ]);
    const { projects } = (await call('GET', '/api/projects')).body;
    expect(projects.map((p) => [p.name, p.state, p.mergedInto])).toEqual([
      ['Alpha', 'active', null],
      ['beta', 'merged', id(alpha)],
      ['gamma', 'disabled', null],
    ]);

    // Only into an active project
    const bad = await call('PUT', `/api/settings/project-merge/${id(alpha)}`, { into: id(gamma) });
    expect(bad.status).toBe(400);

    await call('PUT', `/api/settings/archive/${id(gamma)}`, { value: false });
    await call('PUT', `/api/settings/project-merge/${id(beta)}`, { into: null });
    expect((await apps()).map((a) => a.id)).toEqual([id(alpha), id(beta), id(gamma)]);
  });

  it('adds own projects only for git roots no project holds; delete removes them', async () => {
    const plain = await call('POST', '/api/settings/projects/custom', {
      paths: [path.join(scan, 'cluster')],
    });
    expect(plain.status).toBe(400);
    expect(plain.body.error).toMatch(/Not a git repository/);
    const wt = await call('POST', '/api/settings/projects/custom', { paths: [alphaWt] });
    expect(wt.body.error).toMatch(/worktree of/);
    const taken = await call('POST', '/api/settings/projects/custom', { paths: [alpha] });
    expect(taken.status).toBe(409);

    const added = await call('POST', '/api/settings/projects/custom', {
      name: 'Side',
      paths: [outside],
    });
    expect(added.status).toBe(200);
    const custom = (await apps()).find((a) => a.id === added.body.project.id);
    expect(custom).toMatchObject({ name: 'Side', path: outside, source: 'custom' });

    await call('PUT', `/api/settings/projects/custom/${custom.id}`, { name: 'Side B' });
    expect((await apps()).find((a) => a.id === custom.id).name).toBe('Side B');

    expect((await call('DELETE', `/api/settings/projects/custom/${custom.id}`)).status).toBe(200);
    expect((await apps()).some((a) => a.id === custom.id)).toBe(false);
  });
});
