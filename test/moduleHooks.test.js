// #220: the module hooks the mesh module uses - slot `agents-rail`, ctx.onUpgrade, ctx.addAuthorizer
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createModuleHost } from '../server/services/moduleLoader.js';
import { isAuthorized } from '../server/services/remoteAccess.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
let tmp;

function writeModule(dir, id, body) {
  fs.mkdirSync(path.join(dir, id), { recursive: true });
  fs.writeFileSync(path.join(dir, id, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, id, 'ui.js'), 'export function mount() {}');
  fs.writeFileSync(path.join(dir, id, 'index.js'), body);
}

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
  delete process.env.DEVORBIT_REMOTE;
  vi.clearAllMocks();
});

// Proxied request (forward header) from another machine, without the pairing token
const remoteReq = (login) => ({
  socket: { remoteAddress: '127.0.0.1' },
  headers: { host: 'mac.ts.net', 'x-forwarded-for': '100.64.0.2', 'tailscale-user-login': login },
  url: '/api/agents',
  method: 'GET',
});

describe('module hooks', () => {
  it('lists the slot, keeps the upgrade handler and ORs the authorizer into remote auth', async () => {
    tmp = fs.mkdtempSync(path.join(FIXTURES, 'tmp-hooks-'));
    writeModule(
      tmp,
      'a-rail',
      `export default { id: 'rail-mod', name: 'Rail', ui: './ui.js', slot: 'agents-rail',
        register(ctx) {
          ctx.onUpgrade((req, socket) => socket.end('hi'));
          ctx.addAuthorizer((req) => req.headers['tailscale-user-login'] === 'me@example.com');
          ctx.addAuthorizer(() => { throw new Error('boom'); });
        } };`
    );
    writeModule(
      tmp,
      'b-bad-slot',
      `export default { id: 'bad-slot', name: 'Bad', ui: './ui.js', slot: 'title-bar', register() {} };`
    );
    writeModule(
      tmp,
      'c-fails',
      `export default { id: 'fails', name: 'Fails', register(ctx) {
        ctx.onUpgrade(() => {}); ctx.addAuthorizer(() => true); throw new Error('nope'); } };`
    );
    const host = createModuleHost({ services: {}, logger });
    const loaded = await host.load(tmp);
    expect(loaded.map((m) => m.id)).toEqual(['rail-mod']);
    expect(String(logger.error.mock.calls[0][1])).toContain('slot must be one of agents-rail');

    expect(typeof host.upgradeHandler('rail-mod')).toBe('function');
    // a module whose register threw leaves no upgrade hook and no authorizer behind
    expect(host.upgradeHandler('fails')).toBeUndefined();

    process.env.DEVORBIT_REMOTE = 'true';
    expect(isAuthorized(remoteReq('me@example.com'))).toBe(true);
    expect(isAuthorized(remoteReq('evil@example.com'))).toBe(false);
    expect(isAuthorized(remoteReq(undefined))).toBe(false);
  });
});
