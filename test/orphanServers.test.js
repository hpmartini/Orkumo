import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('node-pty', () => ({ spawn: vi.fn() }));
// The session list comes from the claude CLI; everything else (lsof, ps, kill) runs for real.
const sessions = [];
vi.mock('../server/services/agentService.js', () => ({
  listSessions: vi.fn(async () => sessions),
  paths: { JOBS_DIR: path.join(os.tmpdir(), 'orphan-test-no-jobs') },
}));

const {
  assignServers,
  dirOwnsServerCwd,
  parseParents,
  getAgentContexts,
  getOrphanServers,
  getKnownServerPids,
  stopOrphanServer,
} = await import('../server/services/agentContextService.js');

const home = os.homedir();
const assign = (sess, servers, parents = new Map()) => {
  const { owner, orphans } = assignServers(sess, servers, parents);
  return { ownerOf: (s) => owner.get(s) ?? null, orphans };
};

describe('assignServers (#243)', () => {
  it('AC-1: server in <dir>/.claude/worktrees/x is no server of the session in <dir>', () => {
    const server = { pid: 50, cwd: '/r/app/.claude/worktrees/x/server' };
    const { ownerOf, orphans } = assign([{ key: 'main', dir: '/r/app', pid: 10 }], [server]);
    expect(ownerOf(server)).toBeNull();
    expect(orphans).toEqual([server]);
  });

  it('AC-2: server in ~/.claude/jobs/B/tmp is no server of the session in ~/.claude', () => {
    const server = { pid: 51, cwd: `${home}/.claude/jobs/B/tmp/old` };
    const { ownerOf, orphans } = assign([{ key: 'A', dir: `${home}/.claude`, pid: 11 }], [server]);
    expect(ownerOf(server)).toBeNull();
    expect(orphans).toEqual([server]);
  });

  it('AC-3: child process of the session (over intermediate processes) stays hers, any cwd', () => {
    const server = { pid: 52, cwd: '/r/other/.claude/worktrees/y' };
    // 52 -> 40 (npm) -> 30 (shell) -> 12 (session)
    const parents = new Map([
      [52, 40],
      [40, 30],
      [30, 12],
      [12, 1],
    ]);
    const { ownerOf, orphans } = assign(
      [
        { key: 'S', dir: '/r/app', pid: 12 },
        { key: 'T', dir: '/r/other', pid: 13 },
      ],
      [server],
      parents
    );
    expect(ownerOf(server)).toBe('S');
    expect(orphans).toEqual([]);
  });

  it('AC-4: session in the worktree owns its server, main session keeps <dir>/server', () => {
    const wt = { pid: 53, cwd: '/r/app/.claude/worktrees/x/server' };
    const main = { pid: 54, cwd: '/r/app/server' };
    const { ownerOf } = assign(
      [
        { key: 'main', dir: '/r/app', pid: 14 },
        { key: 'wt', dir: '/r/app/.claude/worktrees/x', pid: 15 },
      ],
      [wt, main]
    );
    expect(ownerOf(wt)).toBe('wt');
    expect(ownerOf(main)).toBe('main');
  });

  it('ignores unowned servers outside worktree/job dirs and survives ppid cycles', () => {
    const pg = { pid: 60, cwd: '/' };
    const { ownerOf, orphans } = assign(
      [],
      [pg],
      new Map([
        [60, 61],
        [61, 60],
      ])
    );
    expect(ownerOf(pg)).toBeNull();
    expect(orphans).toEqual([]);
  });

  it('dirOwnsServerCwd keeps home and root out, own job dir is owned', () => {
    expect(dirOwnsServerCwd(home, `${home}/x`)).toBe(false);
    expect(dirOwnsServerCwd(`${home}/.claude/jobs/A`, `${home}/.claude/jobs/A/tmp`)).toBe(true);
    expect(dirOwnsServerCwd(`${home}/.claude`, `${home}/.claude/plugins`)).toBe(true);
  });

  it('parses ps output', () => {
    expect(parseParents('  1     0\n 512   1\nbad\n')).toEqual(
      new Map([
        [1, 0],
        [512, 1],
      ])
    );
  });
});

// Real processes, real lsof/ps/kill: a finished worktree's dev server and a live session's child.
describe('orphan servers end to end (#243, AC-3, AC-5)', () => {
  let root;
  let orphanProc;
  let sessionProc;
  const listen = `require('http').createServer(()=>{}).listen(0,'127.0.0.1',function(){console.log(this.address().port)})`;
  const firstLine = (proc) =>
    new Promise((resolve) => proc.stdout.once('data', (d) => resolve(Number(String(d).trim()))));

  beforeAll(async () => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-')));
    const wt = path.join(root, 'repo/.claude/worktrees/old');
    fs.mkdirSync(wt, { recursive: true });
    orphanProc = spawn(process.execPath, ['-e', listen], { cwd: wt });
    // "session" process whose child listens in a foreign worktree dir
    sessionProc = spawn(
      process.execPath,
      [
        '-e',
        `const c=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(listen)}],{cwd:${JSON.stringify(path.join(root, 'repo/.claude/worktrees'))},stdio:['ignore','inherit','inherit']});setInterval(()=>{},1e6)`,
      ],
      { cwd: root }
    );
    fs.mkdirSync(path.join(root, 'repo/.claude/worktrees/other'), { recursive: true });
    await Promise.all([firstLine(orphanProc), firstLine(sessionProc)]);
    sessions.push(
      { id: 'main', kind: 'background', cwd: path.join(root, 'repo'), pid: 999999 },
      {
        id: 'live',
        kind: 'background',
        cwd: path.join(root, 'repo/.claude/worktrees/other'),
        pid: sessionProc.pid,
      }
    );
  }, 20_000);

  afterAll(() => {
    orphanProc?.kill('SIGKILL');
    sessionProc?.kill('SIGKILL');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('lists the worktree server as orphan, the session child under its session', async () => {
    const contexts = await getAgentContexts();
    const orphans = await getOrphanServers();
    expect(orphans.map((s) => s.pid)).toContain(orphanProc.pid);
    expect(contexts.main.servers).toEqual([]);
    expect(contexts.live.servers).toHaveLength(1);
    expect(orphans.map((s) => s.pid)).not.toContain(contexts.live.servers[0].pid);
    expect(await getKnownServerPids()).toContain(orphanProc.pid);
  }, 20_000);

  it('AC-5: refuses a pid that is no orphan, stops the orphan', async () => {
    const [child] = (await getAgentContexts()).live.servers;
    expect(await stopOrphanServer(child.pid)).toBe(false);
    expect(await stopOrphanServer(process.pid)).toBe(false);
    expect(await stopOrphanServer(1)).toBe(false);
    const exited = new Promise((r) => orphanProc.once('exit', (code, signal) => r(signal)));
    expect(await stopOrphanServer(orphanProc.pid)).toBe(true);
    expect(await exited).toBe('SIGTERM');
    expect((await getOrphanServers()).map((s) => s.pid)).not.toContain(orphanProc.pid);
  }, 20_000);
});
