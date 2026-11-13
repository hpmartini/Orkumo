// The packaged app's renderer (file://) through the real server: it sends `Origin: file://` on the
// PTY upgrade, "null" or no Origin (but Sec-Fetch-Site: cross-site) on fetches, as any sandboxed
// iframe does; it passes only with the per-launch renderer secret Electron main adds (H1).
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAKE_DIR = path.join(ROOT, 'test/fixtures/fake-gh');

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

let child;
let dataDir;

async function startServer(env) {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orkumo-upgrade-'));
  const port = await freePort();
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      CLAUDE_CLI_PATH: path.join(FAKE_DIR, 'claude'),
      HOME: dataDir,
      SERVER_PORT: String(port),
      DEVORBIT_DATA_PATH: dataDir,
      DEVHUB_PREMIUM_DIR: '/nonexistent-orkumo-modules',
      ELECTRON_MODE: '',
      ...env,
    },
    stdio: 'ignore',
  });
  const base = `127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    if (
      await fetch(`http://${base}/api/board/settings`).then(
        (r) => r.ok,
        () => false
      )
    )
      break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return base;
}

const upgrade = (base, origin, token = '', headers = {}) =>
  new Promise((resolve) => {
    const query = `sessionId=origin-${Date.now()}&cwd=/tmp${token && `&token=${token}`}`;
    const ws = new WebSocket(`ws://${base}/api/pty?${query}`, {
      headers: { Origin: origin, ...headers },
    });
    ws.on('open', () => {
      ws.close();
      resolve('open');
    });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
    ws.on('error', () => resolve('error'));
  });

// The stop route ends processes (an omp in another terminal): a bodyless POST has no preflight
const STOP = '/api/agents/omp-01a1c018-5c63-776e-b0c3-b78121b577b3/stop';
const stop = (base, headers) =>
  fetch(`http://${base}${STOP}`, { method: 'POST', headers }).then((r) => r.status);

const SECRET = 'f'.repeat(64);
const marked = { 'X-Orkumo-Renderer': SECRET };
const ELECTRON = { ELECTRON_MODE: 'true', DEVORBIT_RENDERER_SECRET: SECRET };

afterEach(() => {
  child?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('Electron renderer origin', { timeout: 60_000 }, () => {
  it('lets the marked renderer open terminals and stop sessions, refuses unmarked and cross-site pages', async () => {
    const base = await startServer(ELECTRON);
    expect(await upgrade(base, 'file://', '', marked)).toBe('open');
    expect(await upgrade(base, 'file://')).toBe(403);
    expect(await upgrade(base, 'null')).toBe(403);
    expect(await upgrade(base, 'file://', '', { 'X-Orkumo-Renderer': 'e'.repeat(64) })).toBe(403);
    expect(await upgrade(base, 'http://localhost:3000')).toBe('open');
    expect(await upgrade(base, 'https://evil.example')).toBe(403);
    // file:// fetches carry no Origin but are marked cross-site; the unknown session is a 404-ish miss
    expect(await stop(base, { 'Sec-Fetch-Site': 'cross-site', ...marked })).not.toBe(403);
    expect(await stop(base, { 'Sec-Fetch-Site': 'cross-site' })).toBe(403);
    expect(await stop(base, { Origin: 'null', ...marked })).not.toBe(403);
    expect(await stop(base, { Origin: 'null' })).toBe(403);
    expect(await stop(base, { Origin: 'https://evil.example' })).toBe(403);
  });

  it('refuses Origin null before any route and without CORS header, answers its preflight', async () => {
    const base = await startServer(ELECTRON);
    const config = (headers) => fetch(`http://${base}/api/config`, { headers });

    const unmarked = await config({ Origin: 'null' });
    expect(unmarked.status).toBe(403);
    expect(unmarked.headers.get('access-control-allow-origin')).toBeNull();
    const ok = await config({ Origin: 'null', ...marked });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('null');

    const preflight = await fetch(`http://${base}/api/chat-history/import`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'null',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-orkumo-renderer',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('null');

    // curl and other non-browser clients send no Origin; a link from another site is a navigation
    // (node:http: fetch overwrites Sec-Fetch-Mode with "cors")
    expect((await config({})).status).toBe(200);
    const navigation = await new Promise((resolve, reject) =>
      http
        .get(
          `http://${base}/api/config`,
          { headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' } },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          }
        )
        .on('error', reject)
    );
    expect(navigation).toBe(200);
  });

  it('refuses file:// and origin-less cross-site requests outside Electron', async () => {
    const base = await startServer({});
    expect(await upgrade(base, 'file://')).toBe(403);
    expect(await upgrade(base, 'file://', '', marked)).toBe(403);
    expect(await stop(base, { 'Sec-Fetch-Site': 'cross-site' })).toBe(403);
    expect(await stop(base, { 'Sec-Fetch-Site': 'cross-site', ...marked })).toBe(403);
  });

  // DevHub-pro#8: a packaged app paired with another machine's server. Its file:// shape passes
  // only with the pairing token; from loopback, where requests need no token otherwise.
  it('lets a foreign Electron renderer in with the pairing token only', async () => {
    const base = await startServer({ DEVORBIT_REMOTE: 'true' });
    const { token } = await fetch(`http://${base}/api/remote/pairing`).then((r) => r.json());
    const auth = { 'X-DevOrbit-Token': token };

    expect(await upgrade(base, 'file://')).toBe(403);
    expect(await upgrade(base, 'file://', 'wrong')).toBe(403);
    expect(await upgrade(base, 'file://', token)).toBe('open');
    expect(await upgrade(base, 'https://evil.example', token)).toBe(403);

    expect(await stop(base, { 'Sec-Fetch-Site': 'cross-site' })).toBe(403);
    expect(await stop(base, { 'Sec-Fetch-Site': 'cross-site', ...auth })).not.toBe(403);
    expect(await stop(base, { Origin: 'https://evil.example', ...auth })).toBe(403);
  });

  it('ignores the token for file:// without remote mode', async () => {
    const base = await startServer({});
    expect(await upgrade(base, 'file://', 'anything')).toBe(403);
  });

  // #214 AC-4: the file:// renderer imports a module's UI bundle cross-origin (module script, CORS mode)
  const PREMIUM = path.join(ROOT, 'test/fixtures/premium');
  const uiJs = (base, origin, headers = {}) =>
    fetch(`http://${base}/api/modules/with-mode/ui.js`, {
      headers: { Origin: origin, ...headers },
    });

  it('serves a module ui.js to the marked renderer (Origin null / file://) inside Electron', async () => {
    const base = await startServer({ ...ELECTRON, DEVHUB_PREMIUM_DIR: PREMIUM });
    for (const origin of ['null', 'file://']) {
      const res = await uiJs(base, origin, marked);
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(origin);
      const unmarked = await uiJs(base, origin);
      expect(unmarked.status).toBe(403);
      expect(unmarked.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect(
      (await uiJs(base, 'https://evil.example')).headers.get('access-control-allow-origin')
    ).toBeNull();
  });

  it('grants a module ui.js no CORS header for Origin null / file:// outside Electron', async () => {
    const base = await startServer({ DEVHUB_PREMIUM_DIR: PREMIUM });
    for (const origin of ['null', 'file://']) {
      expect((await uiJs(base, origin)).headers.get('access-control-allow-origin')).toBeNull();
    }
  });

  // Security review M3: every loopback port passes CORS, the chat history only this app's pages
  it('lets only this app read the chat history, not a page on another loopback port', async () => {
    const vitePort = await freePort();
    const base = await startServer({ ...ELECTRON, VITE_PORT: String(vitePort) });
    const ownPort = base.split(':')[1];
    const read = (route, headers) => fetch(`http://${base}${route}`, { headers });
    const routes = ['/api/chat-history', '/api/chat-history/sync-state'];
    for (const route of routes) {
      expect((await read(route, {})).status).toBe(200);
      expect((await read(route, { Origin: `http://localhost:${ownPort}` })).status).toBe(200);
      expect((await read(route, { Origin: `http://127.0.0.1:${vitePort}` })).status).toBe(200);
      expect((await read(route, { Origin: 'null', ...marked })).status).toBe(200);
      expect((await read(route, { Origin: 'http://localhost:8080' })).status).toBe(403);
      expect((await read(route, { 'Sec-Fetch-Site': 'same-site' })).status).toBe(403);
    }
    expect(
      (await read('/api/chat-history/conversation?id=x', { Origin: 'http://localhost:8080' }))
        .status
    ).toBe(403);
    const importFrom = (origin) =>
      fetch(`http://${base}/api/chat-history/import`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/nonexistent-orkumo-import' }),
      }).then((r) => r.status);
    expect(await importFrom('http://localhost:8080')).toBe(403);
    expect(await importFrom(`http://localhost:${ownPort}`)).not.toBe(403);
  });
});
