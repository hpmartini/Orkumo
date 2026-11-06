// Board write routes through the real server with a fake `gh` on PATH (#88)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAKE_GH_DIR = path.join(ROOT, 'test/fixtures/fake-gh');

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

describe('board write routes (#88)', { timeout: 30_000 }, () => {
  let child;
  let base;
  let dataDir;
  let ghLog;

  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const ghCalls = () =>
    fs.existsSync(ghLog)
      ? fs.readFileSync(ghLog, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
      : [];

  beforeAll(async () => {
    fs.chmodSync(path.join(FAKE_GH_DIR, 'gh'), 0o755);
    fs.chmodSync(path.join(FAKE_GH_DIR, 'claude'), 0o755);
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orkumo-writes-'));
    ghLog = path.join(dataDir, 'gh.log');
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['server/index.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PATH: `${FAKE_GH_DIR}:${process.env.PATH}`,
        // the fallback lookup lists agent sessions and scans $HOME: keep both off this machine
        CLAUDE_CLI_PATH: path.join(FAKE_GH_DIR, 'claude'),
        HOME: dataDir,
        FAKE_GH_LOG: ghLog,
        SERVER_PORT: String(port),
        DEVORBIT_DATA_PATH: dataDir,
        DEVHUB_PREMIUM_DIR: '/nonexistent-orkumo-modules',
      },
      stdio: 'ignore',
    });
    for (let i = 0; i < 120; i++) {
      if (
        await fetch(`${base}/api/board/settings`).then(
          (r) => r.ok,
          () => false
        )
      )
        break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const put = await call('PUT', '/api/board/settings', { source: { owner: 'o', number: 1 } });
    if (put.status !== 200) throw new Error(`settings: ${put.status}`);
    // A local checkout of o/local, registered as project directory
    const local = path.join(fs.realpathSync(dataDir), 'local'); // /private/var: /var is not scannable
    fs.mkdirSync(local);
    execFileSync('git', ['init', '-q'], { cwd: local });
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/o/local.git'], {
      cwd: local,
    });
    const dir = await call('POST', '/api/config/directories', { path: local });
    if (dir.status >= 300) throw new Error(`directories: ${dir.status}`);
  }, 90_000);

  afterAll(() => {
    child?.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('AC-1/AC-4: creates with label 101+, assignee 101+, milestone 51+ on a cold cache without loading all board items', async () => {
    fs.rmSync(ghLog, { force: true });
    const res = await call('POST', '/api/board/issues', {
      repo: 'o/local',
      title: 'new',
      labels: ['deep-label'],
      assignees: ['deep-user'],
      milestone: 'deep-ms',
    });
    expect(res.status).toBe(201);
    expect(res.body.itemId).toBe('PVTI_new');
    const calls = ghCalls();
    const create = calls.find((a) => a.some((x) => x.includes('createIssue(input')));
    expect(create).toEqual(
      expect.arrayContaining(['labelIds[]=LA_deep', 'assigneeIds[]=U_deep', 'milestoneId=M_deep'])
    );
    const followUps = calls.flatMap((a) => a.filter((x) => x.startsWith('after=')));
    expect(followUps.sort()).toEqual(['after=A1', 'after=L1', 'after=M1']);
    expect(calls.some((a) => a.some((x) => x.includes('items(first')))).toBe(false);
    expect(calls.some((a) => a.some((x) => x.includes('fragment M on ProjectV2')))).toBe(true);
  });

  it('AC-7: only this machine may switch the board source that backs the allow list', async () => {
    const remote = (source) =>
      fetch(`${base}/api/board/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '100.64.0.9' },
        body: JSON.stringify({ source }),
      }).then((r) => r.status);
    expect(await remote({ owner: 'evil', number: 7 })).toBe(403);
    expect(await remote({ owner: 'o', number: 1 })).toBe(200);
    expect((await call('GET', '/api/board/settings')).body.source).toEqual({
      owner: 'o',
      number: 1,
    });
  });

  it('AC-1: an unknown label is still a 400', async () => {
    const res = await call('POST', '/api/board/issues', {
      repo: 'o/onboard',
      title: 'x',
      labels: ['nope'],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown label: nope/);
  });

  it('AC-7: every board write route refuses a repo outside the allow list with 403', async () => {
    fs.rmSync(ghLog, { force: true });
    const refused = [
      await call('POST', '/api/board/issues', { repo: 'o/foreign', title: 'x' }),
      await call('PATCH', '/api/board/items/PVTI_on/issue', {
        parent: { repo: 'o/foreign', number: 3 },
      }),
      await call('PATCH', '/api/board/items/PVTI_on/issue', {
        addSubIssue: { repo: 'o/foreign', number: 3 },
      }),
      await call('PUT', '/api/board/issues/I_foreign/labels', { labels: [] }),
      await call('POST', '/api/board/issues/I_foreign/comments', { body: 'hi' }),
      await call('POST', '/api/board/images?repo=o/foreign', {}),
      // resuming a create must not put a foreign issue on the board via an allowed repo
      await call('POST', '/api/board/issues', {
        repo: 'o/onboard',
        title: 'x',
        issueId: 'I_foreign',
      }),
      // a remote client (behind tailscale serve) gets the same answer
      await call(
        'POST',
        '/api/board/issues',
        { repo: 'o/foreign', title: 'x' },
        {
          'X-Forwarded-For': '100.64.0.9',
        }
      ),
    ];
    expect(refused.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403, 403, 403]);
    const mutations = ghCalls().filter((a) => a.some((x) => x.startsWith('query=mutation')));
    expect(mutations).toEqual([]);
  });

  it('AC-7: the same routes accept a repo on the board', async () => {
    expect(
      (await call('PATCH', '/api/board/items/PVTI_on/issue', { title: 'renamed' })).status
    ).toBe(200);
    expect((await call('PUT', '/api/board/issues/I_on/labels', { labels: [] })).status).toBe(200);
    expect((await call('POST', '/api/board/issues/I_on/comments', { body: 'hi' })).status).toBe(
      200
    );
  });

  it('AC-8: unknown body keys and invalid issue ids are a 400', async () => {
    const res = [
      await call('POST', '/api/board/issues', { repo: 'o/onboard', title: 'x', evil: 1 }),
      await call('PATCH', '/api/board/items/PVTI_on/issue', { issueTypeId: 'T' }),
      await call('PUT', '/api/board/issues/I_on/labels', { labels: [], extra: true }),
      await call('GET', '/api/board/issues/not-an-id'),
      await call('PUT', '/api/board/issues/PVTI_on/labels', { labels: [] }),
      await call('POST', '/api/board/issues/I_x;rm/comments', { body: 'hi' }),
      await call('POST', '/api/board/issues', { repo: 'o/onboard', title: 'x', issueId: 'nope' }),
    ];
    expect(res.map((r) => r.status)).toEqual([400, 400, 400, 400, 400, 400, 400]);
  });
});
