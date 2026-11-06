// #242: one-time migration of the pre-#181 `hover` default, through the real server and a real settings.json
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
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

const dirs = [];
let child;

afterEach(() => {
  child?.kill();
  child = undefined;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const dataDirWith = (agentView) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orkumo-242-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ agentView, version: 1 }));
  return dir;
};
const fileAgentView = (dir) =>
  JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).agentView;

/** Starts a fresh server process on `dir`; returns its base URL */
async function startServer(dir) {
  child?.kill();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: dir,
      SERVER_PORT: String(port),
      DEVORBIT_DATA_PATH: dir,
      DEVHUB_PREMIUM_DIR: '/nonexistent-orkumo-modules',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 120; i++) {
    const ok = await fetch(`${base}/api/settings/agent-view`).then(
      (r) => r.ok,
      () => false
    );
    if (ok) return base;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start');
}
const getCardDetails = async (base) =>
  (await fetch(`${base}/api/settings/agent-view`).then((r) => r.json())).cardDetails;

describe('cardDetails migration (#242)', { timeout: 60_000 }, () => {
  it('AC-1: stored `hover` without marker becomes `click`, persisted with the marker', async () => {
    const dir = dataDirWith({ cardDetails: 'hover' });
    const base = await startServer(dir);
    expect(await getCardDetails(base)).toBe('click');
    expect(fileAgentView(dir)).toMatchObject({ cardDetails: 'click', cardDetailsMigrated: true });
  });

  it('AC-2: with marker, `hover` stays across two server starts', async () => {
    const dir = dataDirWith({ cardDetails: 'hover', cardDetailsMigrated: true });
    expect(await getCardDetails(await startServer(dir))).toBe('hover');
    expect(await getCardDetails(await startServer(dir))).toBe('hover');
    expect(fileAgentView(dir).cardDetails).toBe('hover');
  });

  it('AC-3: `hover` chosen via PUT after the migration survives a restart', async () => {
    const dir = dataDirWith({ cardDetails: 'hover' });
    let base = await startServer(dir);
    expect(await getCardDetails(base)).toBe('click');
    const put = await fetch(`${base}/api/settings/agent-view`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardDetails: 'hover' }),
    });
    expect(put.status).toBe(200);
    base = await startServer(dir);
    expect(await getCardDetails(base)).toBe('hover');
    expect(fileAgentView(dir)).toMatchObject({ cardDetails: 'hover', cardDetailsMigrated: true });
  });

  it.each(['click', 'always'])('AC-4: `%s` without marker stays unchanged', async (mode) => {
    const dir = dataDirWith({ cardDetails: mode });
    expect(await getCardDetails(await startServer(dir))).toBe(mode);
    expect(fileAgentView(dir).cardDetails).toBe(mode);
  });

  it('a fresh install gets the marker, so a later `hover` is never migrated', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orkumo-242-'));
    dirs.push(dir);
    expect(await getCardDetails(await startServer(dir))).toBe('click');
    expect(fileAgentView(dir).cardDetailsMigrated).toBe(true);
  });
});
