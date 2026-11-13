// The packaged app's renderer (file://) through the real server: it sends `Origin: file://` on the
// PTY upgrade and no Origin (but Sec-Fetch-Site: cross-site) on a POST; cross-site pages never pass
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
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

const upgrade = (base, origin, token = '') =>
  new Promise((resolve) => {
    const query = `sessionId=origin-${Date.now()}&cwd=/tmp${token && `&token=${token}`}`;
    const ws = new WebSocket(`ws://${base}/api/pty?${query}`, { headers: { Origin: origin } });
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

afterEach(() => {
  child?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('Electron renderer origin', { timeout: 60_000 }, () => {
  it('lets the packaged renderer open terminals and stop sessions, refuses cross-site pages', async () => {
    const base = await startServer({ ELECTRON_MODE: 'true' });
    expect(await upgrade(base, 'file://')).toBe('open');
    expect(await upgrade(base, 'http://localhost:3000')).toBe('open');
    expect(await upgrade(base, 'https://evil.example')).toBe(403);
    // file:// fetches carry no Origin but are marked cross-site; the unknown session is a 404-ish miss
    expect(await stop(base, { 'Sec-Fetch-Site': 'cross-site' })).not.toBe(403);
    expect(await stop(base, { Origin: 'https://evil.example' })).toBe(403);
  });

  it('refuses file:// and origin-less cross-site requests outside Electron', async () => {
    const base = await startServer({});
    expect(await upgrade(base, 'file://')).toBe(403);
    expect(await stop(base, { 'Sec-Fetch-Site': 'cross-site' })).toBe(403);
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
  const uiJs = (base, origin) =>
    fetch(`http://${base}/api/modules/with-mode/ui.js`, { headers: { Origin: origin } });

  it('serves a module ui.js to Origin null / file:// inside Electron', async () => {
    const base = await startServer({ ELECTRON_MODE: 'true', DEVHUB_PREMIUM_DIR: PREMIUM });
    for (const origin of ['null', 'file://']) {
      const res = await uiJs(base, origin);
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(origin);
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
});
