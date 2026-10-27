import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createModuleHost, getModulesDir } from '../server/services/moduleLoader.js';
import { getDataPath } from '../server/services/dataPath.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => path.join(FIXTURES, name);
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

let server;
let tmp;

async function start(dir) {
  const host = createModuleHost({ services: {}, logger });
  const app = express();
  app.use('/api/modules', host.router);
  const loaded = await host.load(dir);
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const get = (p) => fetch(`http://localhost:${server.address().port}/api/modules${p}`);
  return { loaded, get };
}

afterEach(async () => {
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  server = undefined;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
  vi.clearAllMocks();
});

describe('moduleLoader', () => {
  it('without a modules directory: empty list, no routes', async () => {
    const { loaded, get } = await start(path.join(os.tmpdir(), 'devhub-does-not-exist'));
    expect(loaded).toEqual([]);
    expect(await (await get('/')).json()).toEqual([]);
    expect((await get('/premium-placeholder')).status).toBe(404);
  });

  it('lists the placeholder and serves its route; broken modules are skipped', async () => {
    const { loaded, get } = await start(fixture('premium'));
    expect(loaded).toEqual([{ id: 'premium-placeholder', name: 'Premium Placeholder' }]);
    expect(await (await get('/')).json()).toEqual([
      { id: 'premium-placeholder', name: 'Premium Placeholder', ui: false },
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

  it('rejects invalid and duplicate ids', async () => {
    const { loaded } = await start(fixture('premium-invalid'));
    expect(loaded.map((m) => m.id)).toEqual(['same']);
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
