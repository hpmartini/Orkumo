import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createModuleHost, getModulesDir } from '../server/services/moduleLoader.js';
import { getDataPath } from '../server/services/dataPath.js';
import { getProvider, setProvider } from '../server/services/workflowProvider.js';
import { isAuthorized } from '../server/services/remoteAccess.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => path.join(FIXTURES, name);
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

let server;
let tmp;
let host;

async function start(dir, { isAdmin = () => true } = {}) {
  host = createModuleHost({ services: {}, logger, isAdmin });
  const app = express();
  app.use('/api/modules', host.router);
  const loaded = await host.load(dir);
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const get = (p, init) => fetch(`http://localhost:${server.address().port}/api/modules${p}`, init);
  return { loaded, get };
}

afterEach(async () => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  // directory gone: a reload unloads every module (timers, authorizers, provider)
  await host?.reload();
  host = undefined;
  setProvider(null);
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  server = undefined;
  tmp = undefined;
  vi.clearAllMocks();
});

describe('moduleLoader', () => {
  it('without a modules directory: empty list, no routes', async () => {
    const { loaded, get } = await start(path.join(os.tmpdir(), 'orkumo-does-not-exist'));
    expect(loaded).toEqual([]);
    expect(await (await get('/')).json()).toEqual([]);
    expect((await get('/premium-placeholder')).status).toBe(404);
  });

  it('lists the placeholder and serves its route; broken modules are skipped', async () => {
    const { loaded, get } = await start(fixture('premium'));
    expect(loaded).toEqual([
      { id: 'premium-placeholder', name: 'Premium Placeholder' },
      { id: 'with-mode', name: 'With Mode' },
      { id: 'with-slot', name: 'With Slot' },
    ]);
    expect(await (await get('/')).json()).toEqual([
      { id: 'premium-placeholder', name: 'Premium Placeholder', ui: false },
      {
        id: 'with-mode',
        name: 'With Mode',
        ui: true,
        mode: { label: 'Fixture Mode', icon: 'Boxes', keywords: 'fixture demo', scoped: true },
      },
      { id: 'with-slot', name: 'With Slot', ui: true, slot: 'agents-rail' },
    ]);
    const res = await get('/premium-placeholder');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'premium-placeholder' });
    // register() threw after adding a route: that route must not be reachable
    expect((await get('/broken-register')).status).toBe(404);
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('serves ui.js and skips a module whose ui path escapes its directory', async () => {
    const { loaded, get } = await start(fixture('premium-ui'));
    expect(loaded.map((m) => m.id)).toEqual(['with-ui']);
    expect((await (await get('/')).json())[0].ui).toBe(true);
    const res = await get('/with-ui/ui.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    expect((await get('/escape/ui.js')).status).toBe(404);
  });

  it('skips a module whose ui.js is a symlink to a file outside the module', async () => {
    // inside the repo: vite-node cannot import() modules from os.tmpdir(), which would skip the module for the wrong reason
    tmp = fs.mkdtempSync(path.join(FIXTURES, 'tmp-symlink-'));
    const secret = path.join(tmp, 'secret.js');
    fs.writeFileSync(secret, 'export const secret = 1;');
    const modDir = path.join(tmp, 'mods', 'linked');
    fs.mkdirSync(modDir, { recursive: true });
    fs.writeFileSync(path.join(modDir, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(
      path.join(modDir, 'index.js'),
      "export default { id: 'linked', name: 'Linked', ui: 'ui.js', register() {} };"
    );
    fs.symlinkSync(secret, path.join(modDir, 'ui.js'));

    const { loaded, get } = await start(path.join(tmp, 'mods'));
    expect(loaded).toEqual([]);
    expect((await get('/linked/ui.js')).status).toBe(404);
    expect(String(logger.error.mock.calls[0][1])).toContain(
      'ui must be inside the module directory'
    );
  });

  it('rejects invalid, duplicate and reserved ids, and a mode without ui', async () => {
    const { loaded } = await start(fixture('premium-invalid'));
    expect(loaded.map((m) => m.id)).toEqual(['same']);
    const errors = logger.error.mock.calls.map((c) => String(c[1]));
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('id "agents" is reserved'),
        expect.stringContaining('mode needs ui'),
      ])
    );
  });
});

/** Writes module `entry` with index.js `source` and package.json `version` into `dir` */
function writeModule(dir, entry, source, version = '1.0.0') {
  fs.mkdirSync(path.join(dir, entry), { recursive: true });
  fs.writeFileSync(
    path.join(dir, entry, 'package.json'),
    JSON.stringify({ type: 'module', version })
  );
  fs.writeFileSync(path.join(dir, entry, 'index.js'), source);
}

const routeModule = (v) => `export default {
  id: 'changing', name: 'Changing ${v}',
  register({ router }) { router.get('/', (_q, res) => res.json({ v: ${v} })); },
};`;

// Each instance counts its own ticks in globalThis.__ticks[<instance>]
const tickerModule = `const g = globalThis;
const n = (g.__tickerInstances = (g.__tickerInstances ?? 0) + 1);
export default {
  id: 'ticker', name: 'Ticker',
  register({ onDispose }) {
    g.__ticks ??= {};
    g.__ticks[n] = 0;
    const timer = setInterval(() => g.__ticks[n]++, 2);
    onDispose(() => clearInterval(timer));
  },
};`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('moduleLoader reload', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(FIXTURES, 'tmp-reload-'));
  });

  it('serves the changed module after a reload and reports its version', async () => {
    const mods = path.join(tmp, 'mods');
    writeModule(mods, 'changing', routeModule(1), '1.0.0');
    const { get } = await start(mods);
    expect(await (await get('/changing')).json()).toEqual({ v: 1 });

    writeModule(mods, 'changing', routeModule(2), '2.0.0');
    const status = await host.reload();
    expect(status).toEqual([
      { entry: 'changing', id: 'changing', name: 'Changing 2', version: '2.0.0', status: 'loaded' },
    ]);
    expect(await (await get('/changing')).json()).toEqual({ v: 2 });
    expect(await (await get('/')).json()).toEqual([
      { id: 'changing', name: 'Changing 2', ui: false },
    ]);
  });

  it('a broken module neither stops the others nor leaks what it started before failing', async () => {
    const mods = path.join(tmp, 'mods');
    writeModule(mods, 'a-good', routeModule(1));
    writeModule(
      mods,
      'b-broken',
      `export default { id: 'broken', name: 'Broken', register({ onDispose, router }) {
        const timer = setInterval(() => {}, 1000);
        onDispose(() => { clearInterval(timer); globalThis.__brokenDisposed = true; });
        router.get('/', (_q, res) => res.json({}));
        throw new Error('boom');
      } };`
    );
    writeModule(
      mods,
      'c-bad-dispose',
      `export default { id: 'bad-dispose', name: 'Bad Dispose', register({ onDispose }) {
        onDispose(() => { throw new Error('dispose failed'); });
      } };`
    );
    const { get } = await start(mods);
    expect(globalThis.__brokenDisposed).toBe(true);
    expect((await get('/broken')).status).toBe(404);

    const status = await host.reload();
    expect(status.map(({ entry, status: s }) => [entry, s])).toEqual([
      ['a-good', 'loaded'],
      ['b-broken', 'error'],
      ['c-bad-dispose', 'loaded'],
    ]);
    expect(status[1].error).toContain('boom');
    expect(await (await get('/changing')).json()).toEqual({ v: 1 });
  });

  it('ends the timers of the old instance (no timer leak)', async () => {
    const mods = path.join(tmp, 'mods');
    writeModule(mods, 'ticker', tickerModule);
    globalThis.__tickerInstances = 0;
    await start(mods);
    await host.reload();
    await host.reload();
    expect(globalThis.__tickerInstances).toBe(3);

    await wait(20);
    const before = { ...globalThis.__ticks };
    await wait(40);
    expect(globalThis.__ticks[1]).toBe(before[1]);
    expect(globalThis.__ticks[2]).toBe(before[2]);
    expect(globalThis.__ticks[3]).toBeGreaterThan(before[3]);
  });

  it('swaps authorizer, upgrade handler and workflow provider; a removed module leaves none', async () => {
    const mods = path.join(tmp, 'mods');
    const authModule = (gen) => `export default {
      id: 'auth', name: 'Auth',
      workflow: { apiVersion: 1, name: 'Flow ${gen}', stages: [{ id: 'a', label: 'A' }], annotate: () => null },
      register({ addAuthorizer, onUpgrade }) {
        addAuthorizer((req) => req.headers['x-gen'] === '${gen}');
        onUpgrade(() => '${gen}');
      },
    };`;
    writeModule(mods, 'auth', authModule(1));
    const savedRemote = process.env.DEVORBIT_REMOTE;
    process.env.DEVORBIT_REMOTE = 'true';
    const remoteReq = (gen) => ({
      socket: { remoteAddress: '10.0.0.9' },
      headers: { 'x-gen': gen },
      url: '/api/x',
    });
    try {
      await start(mods);
      expect(isAuthorized(remoteReq('1'))).toBe(true);
      expect(getProvider().name).toBe('Flow 1');

      writeModule(mods, 'auth', authModule(2));
      await host.reload();
      expect(isAuthorized(remoteReq('1'))).toBe(false);
      expect(isAuthorized(remoteReq('2'))).toBe(true);
      expect(host.upgradeHandler('auth')()).toBe('2');
      expect(getProvider().name).toBe('Flow 2');

      fs.rmSync(path.join(mods, 'auth'), { recursive: true });
      expect(await host.reload()).toEqual([]);
      expect(isAuthorized(remoteReq('2'))).toBe(false);
      expect(host.upgradeHandler('auth')).toBeUndefined();
      expect(getProvider()).toBeNull();
    } finally {
      if (savedRemote === undefined) delete process.env.DEVORBIT_REMOTE;
      else process.env.DEVORBIT_REMOTE = savedRemote;
    }
  });

  it("prefers the module's own version and calls onReload after every reload", async () => {
    const mods = path.join(tmp, 'mods');
    writeModule(
      mods,
      'own',
      "export default { id: 'own', name: 'Own', version: '0.3.0', register() {} };",
      '0.1.0'
    );
    const onReload = vi.fn();
    host = createModuleHost({ services: {}, logger, onReload });
    await host.load(mods);
    expect(onReload).not.toHaveBeenCalled();
    expect((await host.reload())[0].version).toBe('0.3.0');
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent reloads', async () => {
    const mods = path.join(tmp, 'mods');
    writeModule(mods, 'ticker', tickerModule);
    globalThis.__tickerInstances = 0;
    await start(mods);
    await Promise.all([host.reload(), host.reload(), host.reload()]);
    expect(globalThis.__tickerInstances).toBe(4);
    await wait(20);
    const before = { ...globalThis.__ticks };
    await wait(40);
    expect([1, 2, 3].map((n) => globalThis.__ticks[n])).toEqual([1, 2, 3].map((n) => before[n]));
  });

  it('status and reload routes: only for the owner, with per-module results', async () => {
    const mods = path.join(tmp, 'mods');
    writeModule(mods, 'changing', routeModule(1), '1.2.3');
    let admin = false;
    const { get } = await start(mods, { isAdmin: () => admin });
    expect((await get('/_status')).status).toBe(403);
    expect((await get('/_reload', { method: 'POST' })).status).toBe(403);

    admin = true;
    const expected = [
      { entry: 'changing', id: 'changing', name: 'Changing 1', version: '1.2.3', status: 'loaded' },
    ];
    expect(await (await get('/_status')).json()).toEqual(expected);
    writeModule(mods, 'changing', routeModule(2), '1.2.4');
    const res = await get('/_reload', { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await res.json())[0]).toMatchObject({ name: 'Changing 2', version: '1.2.4' });
  });
});

describe('getModulesDir', () => {
  const saved = process.env.DEVHUB_PREMIUM_DIR;
  beforeEach(() => delete process.env.DEVHUB_PREMIUM_DIR);
  afterEach(() => {
    if (saved === undefined) delete process.env.DEVHUB_PREMIUM_DIR;
    else process.env.DEVHUB_PREMIUM_DIR = saved;
  });

  it('uses DEVHUB_PREMIUM_DIR, else <dataPath>/modules', () => {
    expect(getModulesDir()).toBe(path.join(getDataPath(), 'modules'));
    process.env.DEVHUB_PREMIUM_DIR = '/x/y';
    expect(getModulesDir()).toBe('/x/y');
  });
});
