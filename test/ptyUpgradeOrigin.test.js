// PTY WebSocket upgrades through the real server: the packaged app loads from file:// and its
// renderer sends `Origin: file://` on the upgrade (fetch sends "null"), cross-site pages never pass
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

const upgrade = (base, origin) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://${base}/api/pty?sessionId=origin-${Date.now()}&cwd=/tmp`, {
      headers: { Origin: origin },
    });
    ws.on('open', () => {
      ws.close();
      resolve('open');
    });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
    ws.on('error', () => resolve('error'));
  });

afterEach(() => {
  child?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('PTY WebSocket upgrade origin', { timeout: 60_000 }, () => {
  it('lets the Electron renderer (file://) open terminals, refuses cross-site pages', async () => {
    const base = await startServer({ ELECTRON_MODE: 'true' });
    expect(await upgrade(base, 'file://')).toBe('open');
    expect(await upgrade(base, 'http://localhost:3000')).toBe('open');
    expect(await upgrade(base, 'https://evil.example')).toBe(403);
  });

  it('refuses file:// outside Electron', async () => {
    const base = await startServer({});
    expect(await upgrade(base, 'file://')).toBe(403);
  });
});
