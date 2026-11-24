import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const updateConfig = vi.fn();
vi.mock('../server/services/configService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getConfig: () => ({ directories: ['/x/projects'], scanDepth: 2, excludePatterns: [] }),
  canonicalDir: (dir) => dir.replace('/projects', '/PROJECTS'),
  updateConfig: (...args) => updateConfig(...args),
}));

const { runScanJob } = await import('../server/services/scannerService.js');
const { migrateDirectorySpelling } = await import('../server/services/directoryMigration.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-hung-'));
afterEach(() => vi.clearAllMocks());

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// A readdir on a hung File Provider / network mount never returns; a child that never answers stands in
describe('scan child on a hung mount', () => {
  it('is killed after the timeout and resolves null instead of blocking', async () => {
    const script = path.join(tmp, 'hang.mjs');
    const pidFile = path.join(tmp, 'pid');
    fs.writeFileSync(
      script,
      "import fs from 'fs';\n" +
        'fs.writeFileSync(JSON.parse(process.argv[2]).pidFile, String(process.pid));\n' +
        'setInterval(() => {}, 1000);\n'
    );
    const started = Date.now();
    const result = await runScanJob(
      { job: 'root', root: tmp, pidFile },
      { timeoutMs: 1000, script }
    );
    expect(result).toBeNull();
    expect(Date.now() - started).toBeLessThan(3000);
    const pid = Number(fs.readFileSync(pidFile, 'utf-8'));
    await vi.waitFor(() => expect(isAlive(pid)).toBe(false), { timeout: 2000 });
  });

  it('returns the projects of a root that answers', async () => {
    const repo = path.join(fs.realpathSync(tmp), 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    const result = await runScanJob({
      job: 'root',
      root: fs.realpathSync(tmp),
      maxDepth: 2,
      excludePatterns: [],
    });
    expect(result.exists).toBe(true);
    expect(result.repos.map((p) => p.path)).toEqual([repo]);
  });
});

describe('directory spelling migration', () => {
  it('waits for a start where every root scans: a partial remap would orphan settings', async () => {
    const scan = vi.fn(async () => ({ projects: [], skipped: ['/x/PROJECTS'] }));
    const result = await migrateDirectorySpelling({ scan });
    expect(scan).toHaveBeenCalledWith({ directories: ['/x/PROJECTS'] });
    expect(result).toEqual({ migrated: false, skipped: ['/x/PROJECTS'] });
    expect(updateConfig).not.toHaveBeenCalled();
  });
});
