// WebSocket upgrade origin gate through the real server: the packaged Electron renderer runs on
// file://, and Chromium sends `Origin: file://` on its WebSocket upgrades (fetches send "null").
// The upgrades target an unknown module path, so an origin that passes the gate gets 404 from the
// dispatcher and a refused one 403, without spawning a PTY.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const startServer = async (extraEnv) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orkumo-upgrade-'));
  const port = await freePort();
  const env = {
    ...process.env,
    HOME: dataDir,
    SERVER_PORT: String(port),
    DEVORBIT_DATA_PATH: dataDir,
    DEVHUB_PREMIUM_DIR: '/nonexistent-orkumo-modules',
  };
  delete env.ELECTRON_MODE;
  Object.assign(env, extraEnv);
  const child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: 'ignore' });
  for (let i = 0; i < 120; i++) {
    const up = await fetch(`http://127.0.0.1:${port}/api/config`).then(
      (r) => r.ok,
      () => false
    );
    if (up) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return { port, child, dataDir };
};

const upgradeStatus = (port, origin) =>
  new Promise((resolve, reject) => {
    const req = http.request({
      port,
      host: '127.0.0.1',
      path: '/api/modules/none/ws',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        Origin: origin,
      },
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });

describe('WebSocket upgrade origin gate', { timeout: 30_000 }, () => {
  let electron;
  let browser;

  beforeAll(async () => {
    [electron, browser] = await Promise.all([
      startServer({ ELECTRON_MODE: 'true' }),
      startServer({}),
    ]);
  }, 90_000);

  afterAll(() => {
    for (const s of [electron, browser]) {
      s?.child.kill();
      if (s) fs.rmSync(s.dataDir, { recursive: true, force: true });
    }
  });

  it('lets the packaged renderer (file://) through in Electron mode', async () => {
    expect(await upgradeStatus(electron.port, 'file://')).toBe(404);
  });

  it('refuses file:// outside Electron', async () => {
    expect(await upgradeStatus(browser.port, 'file://')).toBe(403);
  });

  it('refuses a foreign origin even in Electron mode', async () => {
    expect(await upgradeStatus(electron.port, 'https://evil.example')).toBe(403);
  });
});
