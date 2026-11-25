import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Threads of an orchestrator chat over the real path: `orkumo` CLI entry -> HTTP -> server ->
 * thread files in the data dir. Only the `claude` binary is a stub, at the process boundary:
 * `agents --json` lists one orchestrator and one worker, `--bg` answers like a started job.
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'server/orchestrator/orkumo.mjs');

const ORCH = '0a0a0a0a-0000-4000-8000-000000000001';
const WORKER = '0b0b0b0b-0000-4000-8000-000000000002';
const JOB = 'job12345';

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

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orkumo-threads-')));
const home = path.join(tmp, 'home');
const data = path.join(tmp, 'data');
const projects = path.join(tmp, 'projects');
const shop = path.join(projects, 'demo-shop');
let server;
let api;

async function startServer() {
  const port = await freePort();
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: home,
      CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
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

/** The CLI as an agent runs it: its session in ORKUMO_AGENT_ID */
const cli = (args, agentId) =>
  spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: home,
      ORKUMO_API_URL: api,
      ...(agentId ? { ORKUMO_AGENT_ID: agentId } : {}),
    },
  });

const threads = async (session = ORCH) =>
  (await fetch(`${api}/orchestrator/threads?session=${session}`)).json();
const patch = (id, body) =>
  fetch(`${api}/orchestrator/threads/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(shop, { recursive: true });
  const sessions = [
    { kind: 'interactive', sessionId: ORCH, cwd: tmp, pid: 4242, status: 'idle' },
    { kind: 'interactive', sessionId: WORKER, cwd: shop, pid: 4343, status: 'idle' },
  ];
  fs.writeFileSync(
    path.join(home, 'claude'),
    `#!/bin/sh\ncase " $* " in\n  *" --bg "*) echo "backgrounded · ${JOB} · fix-login" ;;\n  *) echo '${JSON.stringify(sessions)}' ;;\nesac\n`,
    { mode: 0o755 }
  );
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ directories: [projects] }));
  fs.writeFileSync(
    path.join(data, 'settings.json'),
    JSON.stringify({ agentView: { orchestrators: [ORCH] } })
  );
  await startServer();
}, 90_000);

afterAll(async () => {
  if (server && server.exitCode === null)
    await new Promise((resolve) => {
      server.once('exit', resolve);
      server.kill();
    });
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('orkumo thread open (AC-6)', () => {
  it('creates an unbound thread in the calling orchestrator and prints its tag', async () => {
    const run = cli(['thread', 'open', 'Release plan', 'for', 'Friday'], ORCH);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    // the title alone names it (AC-9: never after the orchestrator's own session name)
    const tag = run.stdout.match(/\[Thread: [^\]]+\]/)?.[0];
    expect(tag).toBe('[Thread: Release plan for Friday · Release plan for Friday]');
    expect(run.stdout).toMatch(/start .*with this tag/i);
    const listed = (await threads()).threads;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ tag, binding: null, agents: [] });
  });

  it('"Project · Topic" names project and topic', async () => {
    const run = cli(['thread', 'open', 'demo-shop · Payments'], ORCH);
    expect(run.status).toBe(0);
    const made = (await threads()).threads.find((t) => t.name.task === 'Payments');
    expect(made?.name).toEqual({ project: 'demo-shop', task: 'Payments' });
  });

  it('a non-orchestrator or an empty title is refused, nothing stored', async () => {
    const before = (await threads()).threads.length;
    const asWorker = cli(['thread', 'open', 'Side topic'], WORKER);
    expect(asWorker.status).not.toBe(0);
    expect(asWorker.stderr).toMatch(/404.*Not an orchestrator chat/);
    expect(cli(['thread', 'open'], ORCH).status).toBe(2);
    expect(cli(['thread', 'bogus'], ORCH).status).toBe(2);
    expect((await threads()).threads).toHaveLength(before);
  });
});

describe('rename (AC-1)', () => {
  it('stores the new name, keeps id and tag; survives a fresh read', async () => {
    const [before] = (await threads()).threads;
    const res = await patch(before.id, {
      session: ORCH,
      name: { project: ' Shop ', task: 'Launch "v2" [final]' },
    });
    expect(res.status).toBe(200);
    const { thread } = await res.json();
    expect(thread).toMatchObject({
      id: before.id,
      tag: before.tag,
      name: { project: 'Shop', task: 'Launch v2 final' },
    });
    const [after] = (await threads()).threads;
    expect(after).toMatchObject({ id: before.id, tag: before.tag, name: thread.name });
    const dir = path.join(data, 'orchestrator-reports/threads');
    const [stored] = fs.readdirSync(dir);
    const file = JSON.parse(fs.readFileSync(path.join(dir, stored), 'utf8'));
    expect(file.threads[0].name).toEqual({ project: 'Shop', task: 'Launch v2 final' });
  });

  it('refuses a task that is empty once cleaned, and a missing thread', async () => {
    const [t] = (await threads()).threads;
    const empty = await patch(t.id, { session: ORCH, name: { project: 'Shop', task: '[]' } });
    expect(empty.status).toBe(400);
    expect((await threads()).threads[0].name.task).toBe('Launch v2 final');
    const missing = await patch('00000000-0000-4000-8000-000000000000', {
      session: ORCH,
      name: { project: 'A', task: 'B' },
    });
    expect(missing.status).toBe(404);
  });
});

describe('orkumo start opens a thread for the new agent (AC-5)', () => {
  it('from the orchestrator: a thread named after the agent, linked to it, created before it ran', async () => {
    const before = Date.now();
    const run = cli(
      [
        'start',
        '--project',
        shop,
        '--harness',
        'claude',
        '--name',
        'fix-login',
        'Fix the login form',
      ],
      ORCH
    );
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    const thread = (await threads()).threads.find((t) => t.agents.includes(JOB));
    expect(thread).toMatchObject({
      name: { project: 'demo-shop', task: 'fix-login' },
      tag: '[Thread: demo-shop · fix-login]',
      binding: null,
      closed: false,
    });
    expect(thread.createdAt).toBeGreaterThanOrEqual(before);
    expect(thread.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it('the same job started again (already running) gets no second thread', async () => {
    cli(
      [
        'start',
        '--project',
        shop,
        '--harness',
        'claude',
        '--name',
        'fix-login',
        'Fix the login form',
      ],
      ORCH
    );
    const linked = (await threads()).threads.filter((t) => t.agents.includes(JOB));
    expect(linked).toHaveLength(1);
  });

  it('from a worker or from the UI (no sender): no thread', async () => {
    const count = (await threads()).threads.length;
    expect(
      cli(
        ['start', '--project', shop, '--harness', 'claude', '--name', 'fix-login', 'Fix it again'],
        WORKER
      ).status
    ).toBe(0);
    const ui = await fetch(`${api}/agents/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Fix the login form', cwd: shop }),
    });
    expect(ui.status).toBe(201);
    expect((await threads()).threads).toHaveLength(count);
  });
});

describe('backfill from the transcript (AC-7)', () => {
  const user = (text, at, extra = {}) => ({
    type: 'user',
    timestamp: new Date(at).toISOString(),
    message: { role: 'user', content: text },
    ...extra,
  });
  const header = (id, name) => `[from agent ${id} "${name}" via orkumo send]\n\n`;

  it('one thread per unlinked sender, at or before its first message; idempotent, non-destructive', async () => {
    const t0 = Date.now() + 1000;
    const docs = 'omp-0c0c0c0c-0000-4000-8000-000000000003';
    const records = [
      user(`${header(docs, 'Docs pass')}Docs are done.`, t0),
      user(`${header(docs, 'Docs pass')}PR is green.`, t0 + 5000),
      // linked already (started from this orchestrator)
      user(`${header(JOB, 'fix-login')}Login fixed.`, t0 + 6000),
      // the form Orkumo wrote before its English UI
      user('[von Agent c0ffee12 „Altlauf“ via orkumo send]\n\nFertig.', t0 + 7000),
      // a known session: named after its project
      user(`${header(WORKER, 'worker')}Tests pass.`, t0 + 8000),
      // not typed by a sender: tool output and answers quoting a header
      {
        type: 'user',
        timestamp: new Date(t0 + 9000).toISOString(),
        message: {
          role: 'user',
          content: [{ type: 'tool_result', content: `${header('deadbeef99', 'Quoted')}x` }],
        },
      },
      {
        type: 'assistant',
        timestamp: new Date(t0 + 9500).toISOString(),
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: `${header('feedface77', 'Echo')}x` }],
        },
      },
      user(`Hello ${header('abcdef9876', 'Inline')}`, t0 + 9800),
      // a multi-line message typed into a pane arrives wrapped as pasted text
      user(
        `<pasted_content id="1">${header('pastepaste1', 'Pasted')}Done.</pasted_content id="1">`,
        t0 + 9900
      ),
    ];
    const pre = (await threads()).threads;
    const dir = path.join(home, '.claude', 'projects', tmp.replace(/[^a-zA-Z0-9]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${ORCH}.jsonl`);
    fs.writeFileSync(file, records.map((r) => `${JSON.stringify(r)}\n`).join(''));

    const polled = Date.now();
    const existing = (await threads()).threads;
    // existing threads untouched, new ones appended
    expect(existing.slice(0, pre.length)).toEqual(pre);
    expect(existing).toHaveLength(pre.length + 4);
    const byAgent = (id) => existing.find((t) => t.agents.includes(id));
    expect(byAgent(docs)).toMatchObject({
      name: { project: 'Agent', task: 'Docs pass' },
      binding: null,
    });
    expect(byAgent(docs).createdAt).toBeLessThanOrEqual(t0);
    expect(byAgent('c0ffee12')).toMatchObject({ name: { task: 'Altlauf' } });
    expect(byAgent('pastepaste1')).toMatchObject({ name: { task: 'Pasted' } });
    // the backlog was in the main chat: read up to the backfill, not unread from its start
    expect(byAgent(docs).readAt).toBeGreaterThanOrEqual(polled);
    expect(byAgent(WORKER)).toMatchObject({ name: { project: 'demo-shop' } });
    expect(existing.filter((t) => t.agents.includes(JOB))).toHaveLength(1);
    for (const id of ['deadbeef99', 'feedface77', 'abcdef9876'])
      expect(byAgent(id), id).toBeUndefined();
    expect((await threads()).threads).toEqual(existing);

    // a later message of a new sender: only that one is added, the others stay untouched
    fs.appendFileSync(
      file,
      `${JSON.stringify(user(`${header('beadbead55', 'Late')}Hi.`, t0 + 20_000))}\n`
    );
    const second = (await threads()).threads;
    expect(second).toHaveLength(existing.length + 1);
    expect(second.slice(0, existing.length)).toEqual(existing);
    expect((await threads()).threads).toEqual(second);
  });
});
