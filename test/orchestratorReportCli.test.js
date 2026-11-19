import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * `orkumo report` over the real path (AC-2, AC-3): CLI entry point -> HTTP -> server -> files in
 * the data dir, then a second server start on the same data dir. Only `claude agents --json` is
 * a stub, at the process boundary: it lists one orchestrator session and one plain agent.
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'server/orchestrator/orkumo.mjs');
const example = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'server/orchestrator/report.example.json'), 'utf8')
);

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    if (
      await fetch(url).then(
        (r) => r.status < 500,
        () => false
      )
    )
      return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orkumo-report-'));
const home = path.join(tmp, 'home');
const data = path.join(tmp, 'data');
let server;
let api;

async function startServer() {
  const port = await freePort();
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: home,
      SERVER_PORT: String(port),
      DEVORBIT_DATA_PATH: data,
      CLAUDE_CLI_PATH: path.join(home, 'claude'),
      DEVHUB_PREMIUM_DIR: '/nonexistent-orkumo-modules',
    },
    stdio: 'ignore',
  });
  api = `http://127.0.0.1:${port}/api`;
  await waitFor(`${api}/orchestrator/reports`);
}

const stopServer = () =>
  new Promise((resolve) => {
    server.once('exit', resolve);
    server.kill();
  });

/** Runs the CLI as orchestrators do: `orkumo report -` with the report on stdin */
const report = (body, agentId) =>
  spawnSync(process.execPath, [CLI, 'report', '-'], {
    input: typeof body === 'string' ? body : JSON.stringify(body),
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: home,
      ORKUMO_API_URL: api,
      ...(agentId ? { ORKUMO_AGENT_ID: agentId } : {}),
    },
  });

const stored = async () => (await fetch(`${api}/orchestrator/reports`)).json();

beforeAll(async () => {
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const sessions = [
    { kind: 'interactive', sessionId: 'sess-orch', cwd: tmp, pid: 4242, status: 'idle' },
    { kind: 'interactive', sessionId: 'sess-worker', cwd: tmp, pid: 4343, status: 'idle' },
  ];
  fs.writeFileSync(path.join(home, 'claude'), `#!/bin/sh\necho '${JSON.stringify(sessions)}'\n`, {
    mode: 0o755,
  });
  fs.writeFileSync(
    path.join(data, 'settings.json'),
    JSON.stringify({
      agentView: { orchestrators: ['sess-orch'], orchestratorRoles: { 'sess-orch': 'release' } },
    })
  );
  await startServer();
}, 90_000);

afterAll(async () => {
  if (server && server.exitCode === null) await stopServer();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('orkumo report', () => {
  it('an invalid report exits non-zero with readable errors and stores nothing', async () => {
    const bad = { ...example, projects: undefined, inbox: [{ ...example.inbox[0], options: [] }] };
    const run = report(bad, 'sess-orch');
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/Invalid report/);
    expect(run.stderr).toMatch(/projects/);
    expect(report('{ not json', 'sess-orch').stderr).toMatch(/not valid JSON/);
    expect((await stored()).reports).toEqual([]);
  });

  it('a non-orchestrator or a foreign id is refused and changes nothing (AC-3)', async () => {
    const asWorker = report({ ...example, orchestrator: { id: 'sess-worker' } }, 'sess-worker');
    expect(asWorker.status).not.toBe(0);
    expect(asWorker.stderr).toMatch(/403.*Only an orchestrator/);
    const foreign = report({ ...example, orchestrator: { id: 'research' } }, 'sess-orch');
    expect(foreign.stderr).toMatch(/403.*reports as "release"/);
    expect(report(example).stderr).toMatch(/400.*Unknown sender/);
    expect((await stored()).reports).toEqual([]);
  });

  it('a valid report is stored, logged and survives a server restart (AC-2)', async () => {
    const run = report(example, 'sess-orch');
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/Report stored for release: 3 new, 0 closed, 3 task changes/);

    const foreign = report({ ...example, orchestrator: { id: 'research' } }, 'sess-orch');
    expect(foreign.status).not.toBe(0);

    await stopServer();
    await startServer();
    const after = await stored();
    expect(after.reports).toHaveLength(1);
    expect(after.reports[0].report.orchestrator).toMatchObject({
      id: 'release',
      agentId: 'sess-orch',
    });
    expect(after.reports[0].report.inbox.map((e) => e.id)).toEqual(example.inbox.map((e) => e.id));
    expect(after.changes).toHaveLength(1);
    expect(fs.existsSync(path.join(data, 'orchestrator/reports/release.json'))).toBe(true);
  }, 90_000);

  it('answers only open entries', async () => {
    const res = await fetch(`${api}/orchestrator/reports/release/answers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry: 'nope', text: 'x' }),
    });
    expect(res.status).toBe(404);
  });
});
