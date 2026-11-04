import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// Board-poll GO (#145) is a host route since the Workflows mode became a module (#165):
// it must answer the same with and without a loaded module.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE_DIRS = {
  'without module': '/nonexistent-devhub-modules',
  'with module': path.join(ROOT, 'test/fixtures/premium/with-mode'),
};

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

describe.each(Object.entries(MODULE_DIRS))('POST /api/board/poll %s', (_label, modulesDir) => {
  let child;
  let base;
  let dataDir;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devhub-poll-'));
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['server/index.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        SERVER_PORT: String(port),
        DEVORBIT_DATA_PATH: dataDir,
        DEVHUB_PREMIUM_DIR: modulesDir,
      },
      stdio: 'ignore',
    });
    for (let i = 0; i < 120; i++) {
      if (
        await fetch(`${base}/api/modules`).then(
          (r) => r.ok,
          () => false
        )
      )
        return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('server did not start');
  }, 90_000);

  afterAll(() => {
    child?.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const poll = (body) =>
    fetch(`${base}/api/board/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('rejects a missing or malformed itemId', async () => {
    expect((await poll({})).status).toBe(400);
    expect((await poll({ itemId: '../etc' })).status).toBe(400);
  });

  it('rejects extra keys (strict body)', async () => {
    expect((await poll({ itemId: 'PVTI_x', kind: 'build' })).status).toBe(400);
  });

  it('the old /api/workflows/poll route is gone', async () => {
    const old = await fetch(`${base}/api/workflows/poll`, { method: 'POST' });
    expect(old.status).toBe(404);
  });
});
