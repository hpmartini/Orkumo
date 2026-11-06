import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Workflow routes over the real path (docs/WORKFLOW_PROVIDER.md): HTTP -> server -> provider.start
 * -> host.exec -> pty-host /exec (allowlist from the rules file) -> an executable. Only that
 * executable is a stub, at the process boundary.
 * A real provider joins via env, e.g. the mw one:
 *   WORKFLOW_PROVIDER_DIR=<mw>/plugins/mw/orkumo WORKFLOW_PROVIDER_RULES=<mw>/plugins/mw/orkumo/exec-rules.json
 *   WORKFLOW_PROVIDER_COMMAND=mw bunx vitest run test/workflowRoutes.test.js
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'test/fixtures/workflow/cli');
const PROVIDERS = [
  {
    label: 'fixture CLI provider',
    dir: FIXTURE,
    rules: path.join(FIXTURE, 'exec-rules.json'),
    command: 'wf-tool',
  },
  process.env.WORKFLOW_PROVIDER_DIR && {
    label: `provider from ${process.env.WORKFLOW_PROVIDER_DIR}`,
    dir: process.env.WORKFLOW_PROVIDER_DIR,
    rules: process.env.WORKFLOW_PROVIDER_RULES,
    command: process.env.WORKFLOW_PROVIDER_COMMAND,
  },
].filter(Boolean);
const TOKEN = 'test-token';

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    const ok = await fetch(url).then(
      (r) => r.status < 500,
      () => false
    );
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up`);
}

const post = (base, route, body, headers = {}) =>
  fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

/** Starts pty-host and the server; `stub`: command name of the stub executable, or null */
async function startStack({ modulesDir, rules, stub }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orkumo-wf-'));
  const home = path.join(tmp, 'home');
  const log = path.join(tmp, 'argv.log');
  fs.mkdirSync(path.join(home, '.local/bin'), { recursive: true });
  if (stub) {
    // issue 1 start, 2 resume, 3 no free slot (exit 3), else none; every call logs its argv
    const script = `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
case "$*" in
  */issues/1\\ *) echo '{"action":"start","reason":"gestartet"}' ;;
  */issues/2\\ *) echo '{"action":"resume","reason":"geweckt"}' ;;
  */issues/3\\ *) echo '{"action":"none","reason":"kein Platz frei (6/6)"}'; exit 3 ;;
  *) echo '{"action":"none","reason":"nichts zu tun"}' ;;
esac
`;
    fs.writeFileSync(path.join(home, '.local/bin', stub), script, { mode: 0o755 });
  }
  const [ptyPort, ptyHttp, port] = [await freePort(), await freePort(), await freePort()];
  const children = [
    spawn(process.execPath, ['pty-host/index.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        HOME: home, // resolveBinary looks in ~/.local/bin first: the stub, never a real tool
        PTY_HOST_PORT: String(ptyPort),
        PTY_HOST_HTTP_PORT: String(ptyHttp),
        PTY_HOST_HTTP_TOKEN: TOKEN,
        PTY_HOST_EXEC_RULES: rules ?? path.join(tmp, 'no-rules.json'),
      },
      stdio: 'ignore',
    }),
    spawn(process.execPath, ['server/index.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        SERVER_PORT: String(port),
        DEVORBIT_DATA_PATH: path.join(tmp, 'data'),
        DEVHUB_PREMIUM_DIR: modulesDir,
        PTY_HOST_HTTP_URL: `http://127.0.0.1:${ptyHttp}`,
        PTY_HOST_HTTP_TOKEN: TOKEN,
      },
      stdio: 'ignore',
    }),
  ];
  const base = `http://127.0.0.1:${port}`;
  const pty = `http://127.0.0.1:${ptyHttp}`;
  await waitFor(`${base}/api/workflow`);
  await waitFor(`${pty}/exec`);
  return {
    base,
    pty,
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []),
    stop() {
      for (const c of children) c.kill();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

describe('without a workflow provider', () => {
  let stack;
  beforeAll(async () => {
    stack = await startStack({ modulesDir: '/nonexistent-orkumo-modules', stub: null });
  }, 90_000);
  afterAll(() => stack?.stop());

  it('GET /api/workflow reports no provider', async () => {
    expect(await (await fetch(`${stack.base}/api/workflow`)).json()).toEqual({ provider: null });
  });

  it('start answers 404, nothing runs', async () => {
    const res = await post(stack.base, '/api/workflow/start', {
      url: 'https://github.com/o/r/issues/1',
    });
    expect(res.status).toBe(404);
  });

  it('pty-host without rules file runs only claude', async () => {
    const auth = { 'X-Pty-Host-Token': `Bearer ${TOKEN}` };
    const res = await post(stack.pty, '/exec', { command: 'sh', args: ['-c', 'id'] }, auth);
    expect(res.status).toBe(403);
  });

  it('the old mw routes are gone', async () => {
    for (const route of ['/api/board/start', '/api/board/poll']) {
      expect((await post(stack.base, route, {})).status).toBe(404);
    }
  });
});

describe.each(PROVIDERS)('with $label', (provider) => {
  let stack;
  const url = (n) => `https://github.com/o/r/issues/${n}`;
  const start = (body) => post(stack.base, '/api/workflow/start', body);

  beforeAll(async () => {
    stack = await startStack({
      modulesDir: provider.dir,
      rules: provider.rules,
      stub: provider.command,
    });
  }, 90_000);
  afterAll(() => stack?.stop());

  it('GET /api/workflow describes the provider without functions or commands', async () => {
    const { provider: info } = await (await fetch(`${stack.base}/api/workflow`)).json();
    expect(info.apiVersion).toBe(1);
    expect(info.stages.length).toBeGreaterThan(0);
    expect(Object.keys(info).sort()).toEqual(
      ['apiVersion', 'controls', 'name', 'sessionName', 'stages'].sort()
    );
  });

  it('reports start, resume, none and "no free slot" as the tool said', async () => {
    expect(await (await start({ url: url(1) })).json()).toMatchObject({ action: 'start' });
    expect(await (await start({ url: url(2) })).json()).toMatchObject({ action: 'resume' });
    expect(await (await start({ url: url(3) })).json()).toEqual({
      action: 'none',
      reason: 'kein Platz frei (6/6)',
      full: true,
    });
    const none = await (await start({ url: url(4) })).json();
    expect(none.action).toBe('none');
    expect(none.full).toBeUndefined();
    // the issue URL reached the executable as one exact argument
    expect(stack.calls().every((c) => c.includes(' https://github.com/o/r/issues/'))).toBe(true);
    expect(stack.calls()).toHaveLength(4);
  });

  it('refuses crafted URLs and extra keys before anything runs (AC-8)', async () => {
    const before = stack.calls().length;
    for (const body of [
      { url: `${url(1)};touch /tmp/pwned` },
      { url: `${url(1)} --force` },
      { url: 'https://github.com/o/r/pull/1' },
      { url: 'https://evil.example/o/r/issues/1' },
      { url: url(1), command: 'sh' },
      { url: url(1), args: ['-c', 'id'] },
      {},
    ]) {
      expect((await start(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(stack.calls()).toHaveLength(before);
  });

  it('pty-host refuses commands and arguments outside the rules file (AC-8)', async () => {
    const auth = { 'X-Pty-Host-Token': `Bearer ${TOKEN}` };
    const exec = (command, args) => post(stack.pty, '/exec', { command, args }, auth);
    const rules = JSON.parse(fs.readFileSync(provider.rules, 'utf8'));
    const rule = rules.find((r) => r.args.includes('{issue}'));
    const argv = (u) => rule.args.map((a) => (a === '{issue}' ? u : a));
    expect((await exec('sh', ['-c', 'id'])).status).toBe(403);
    expect((await exec(`/bin/${rule.command}`, argv(url(1)))).status).toBe(403);
    expect((await exec(rule.command, argv(`${url(1)};id`))).status).toBe(403);
    expect((await exec(rule.command, [...argv(url(1)), '--extra'])).status).toBe(403);
    expect((await exec(rule.command, argv(url(4)))).status).toBe(200);
  });

  it('go: malformed bodies are refused (400)', async () => {
    for (const body of [
      {},
      { itemId: '../etc', go: { kind: 'poll' } },
      { itemId: 'PVTI_x', go: { kind: 'poll; rm' } },
      { itemId: 'PVTI_x', go: { kind: 'poll' }, url: url(1) },
    ]) {
      expect((await post(stack.base, '/api/workflow/go', body)).status).toBe(400);
    }
  });
});
