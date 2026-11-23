// The server hands out the web build (Safari on the iPad through `tailscale serve`): page and
// assets without token, the API still only with the pairing token.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'orkumo-webapp-'));
// Not loopback for the gate: proxies like `tailscale serve` add this header
const REMOTE = { 'x-forwarded-for': '100.64.0.7' };

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const connects = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port, timeout: 1500 });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => (socket.destroy(), resolve(false)));
  });

describe('web build served by the API server', { timeout: 60_000 }, () => {
  let child;
  let port;
  const token = 'web-test-token';
  const get = (url, headers = {}) =>
    fetch(`http://127.0.0.1:${port}${url}`, { headers: { ...REMOTE, ...headers } });

  beforeAll(async () => {
    const dataDir = path.join(root, 'data');
    const web = path.join(root, 'web');
    fs.mkdirSync(dataDir);
    fs.mkdirSync(path.join(root, 'home'));
    fs.mkdirSync(path.join(web, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ directories: [] }));
    fs.writeFileSync(path.join(dataDir, 'remote-token'), token, { mode: 0o600 });
    fs.writeFileSync(
      path.join(web, 'index.html'),
      '<html><head><script src="./assets/app.js"></script></head><body>orkumo-web</body></html>'
    );
    fs.writeFileSync(path.join(web, 'assets/app.js'), 'console.log("app")');
    port = await freePort();
    child = spawn(process.execPath, ['server/index.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        HOME: path.join(root, 'home'),
        CLAUDE_CONFIG_DIR: path.join(root, 'no-claude'),
        SERVER_PORT: String(port),
        DEVORBIT_DATA_PATH: dataDir,
        DEVORBIT_WEB_DIST: web,
        DEVHUB_PREMIUM_DIR: '/nonexistent-orkumo-modules',
        DEVORBIT_REMOTE: 'true',
      },
      stdio: 'ignore',
    });
    for (let i = 0; i < 120; i++) {
      if (await connects(port)) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('server did not start');
  }, 60_000);

  afterAll(() => {
    child?.kill();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('serves the page at / without token, with base href for the relative asset paths', async () => {
    const res = await get('/', { accept: 'text/html' });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('orkumo-web');
    expect(html).toContain('<base href="/">');
  });

  it('serves assets without token', async () => {
    const res = await get('/assets/app.js');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('console.log');
  });

  it('answers deep links (BrowserRouter) with the page', async () => {
    const res = await get('/agents/some/pane', { accept: 'text/html' });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('orkumo-web');
  });

  it('never answers a missing asset with the page', async () => {
    const res = await get('/assets/missing.js', { accept: 'text/html' });
    expect(res.status).not.toBe(200);
  });

  it('keeps the API behind the pairing token', async () => {
    expect((await get('/api/config', { accept: 'text/html' })).status).toBe(401);
    expect((await get('/api/config', { 'x-devorbit-token': token })).status).toBe(200);
    const unknown = await get('/api/nope', { 'x-devorbit-token': token, accept: 'text/html' });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'Not found' });
  });

  it('serves the page only for GET, not for writes', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', headers: REMOTE });
    expect(res.status).toBe(401);
  });
});
