import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

let root;
vi.mock('../server/services/configService.js', () => ({
  getConfig: () => ({ directories: [root], scanDepth: 3, excludePatterns: ['node_modules'] }),
}));

const { scanDirectory, agentRepoPaths, mergeAgentRepos } =
  await import('../server/services/scannerService.js');

const id = (p) => crypto.createHash('sha256').update(p).digest('hex').slice(0, 16);
const mkdir = (...parts) => {
  const dir = path.join(root, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

describe('scanner: plain Git repos and agent repos (#133)', () => {
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'scan133-')));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('lists a Git repo without package.json, not runnable', () => {
    const repo = mkdir('py-tool');
    mkdir('py-tool', '.git');
    const [project] = scanDirectory(root);
    expect(project).toMatchObject({ id: id(repo), path: repo, detectedFramework: 'Git' });
    expect(project.startCommand).toBeUndefined();
  });

  it('keeps finding apps inside a Git repo', () => {
    mkdir('mono', '.git');
    const web = mkdir('mono', 'web');
    fs.writeFileSync(path.join(web, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
    const paths = scanDirectory(root).map((p) => p.path);
    expect(paths).toEqual([path.join(root, 'mono'), web]);
  });

  it('does not treat worktree checkouts (.git file) as projects', () => {
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
      fs.writeFileSync(path.join(jobs, job, 'state.json'), JSON.stringify(state));
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
