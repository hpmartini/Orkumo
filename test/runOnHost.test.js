import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('node-pty', () => ({ spawn: vi.fn() }));

// PTY_HOST_HTTP_URL is read when agentService loads: each test imports a fresh copy
async function load(env = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import('../server/services/agentService.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const CAT = ['-e', 'process.stdin.pipe(process.stdout)'];

describe('runOnHost input', () => {
  it('local: writes input to the child stdin and closes it', async () => {
    const { runOnHost } = await load({ PTY_HOST_HTTP_URL: '' });
    expect(await runOnHost(process.execPath, CAT, { input: '{"a":1}', timeout: 10000 })).toEqual({
      code: 0,
      stdout: '{"a":1}',
      stderr: '',
    });
    expect((await runOnHost(process.execPath, CAT, { input: '', timeout: 10000 })).stdout).toBe('');
  });

  it('local: a child that ignores stdin does not break the call', async () => {
    const { runOnHost } = await load({ PTY_HOST_HTTP_URL: '' });
    const r = await runOnHost(process.execPath, ['-e', 'process.exit(4)'], {
      input: 'x'.repeat(16 * 1024),
      timeout: 10000,
    });
    expect(r.code).toBe(4);
  });

  it('pty-host: sends input in the /exec body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 0, stdout: 'out', stderr: '' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { runOnHost } = await load({
      PTY_HOST_HTTP_URL: 'http://pty.example:3097/',
      PTY_HOST_HTTP_TOKEN: 't',
    });
    expect(await runOnHost('wf-tool', ['set', '--json'], { input: '{"v":1}' })).toEqual({
      code: 0,
      stdout: 'out',
      stderr: '',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://pty.example:3097/exec');
    expect(JSON.parse(init.body)).toMatchObject({
      command: 'wf-tool',
      args: ['set', '--json'],
      input: '{"v":1}',
    });
  });
});
