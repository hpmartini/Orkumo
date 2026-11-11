import { describe, it, expect, vi, afterEach } from 'vitest';

// Fake PTY: only the spawn options matter here
const spawn = vi.hoisted(() =>
  vi.fn(() => ({ pid: 4242, write() {}, kill() {}, onData() {}, onExit() {} }))
);
vi.mock('node-pty', () => ({ spawn, default: { spawn } }));

const { createPtySession, killPtySession } = await import('../server/services/ptyService.js');

const LAUNCHER = {
  NO_COLOR: '1',
  FORCE_COLOR: '0',
  CI: 'true',
  TERM: 'dumb',
  // started from Ghostty (inside an omp session): that emulator's identity, not xterm.js's
  TERM_PROGRAM: 'ghostty',
  TERMINFO: '/Applications/Ghostty.app/Contents/Resources/terminfo',
  GHOSTTY_RESOURCES_DIR: '/Applications/Ghostty.app/Contents/Resources/ghostty',
  PI_SESSION_ID: '01a1c75d-ad18-761a-b3ba-80f60511ae06',
};

describe('PTY env when the server was launched from an agent or CI shell', () => {
  const saved = Object.fromEntries(Object.keys(LAUNCHER).map((k) => [k, process.env[k]]));
  afterEach(() => {
    killPtySession('env-test');
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('keeps color-disabling launcher variables out of the terminal', () => {
    Object.assign(process.env, LAUNCHER);
    createPtySession('env-test', '/tmp', 80, 24, { command: 'claude', args: ['attach', 'x'] });
    const { env } = spawn.mock.calls.at(-1)[2];
    expect(env).not.toHaveProperty('NO_COLOR');
    expect(env).not.toHaveProperty('FORCE_COLOR');
    expect(env).not.toHaveProperty('CI');
    expect(env.TERM).toBe('xterm-256color');
    expect(env.COLORTERM).toBe('truecolor');
  });

  it('drops the launching terminal’s identity, so TUIs probe xterm.js instead (Kitty graphics)', () => {
    Object.assign(process.env, LAUNCHER);
    createPtySession('env-test', '/tmp', 80, 24, { command: 'claude', args: ['attach', 'x'] });
    const { env } = spawn.mock.calls.at(-1)[2];
    for (const key of ['TERM_PROGRAM', 'TERMINFO', 'GHOSTTY_RESOURCES_DIR', 'PI_SESSION_ID'])
      expect(env).not.toHaveProperty(key);
    expect(env.HOME).toBeTruthy();
  });

  it('still passes them when the caller sets them explicitly', () => {
    Object.assign(process.env, LAUNCHER);
    createPtySession('env-test', '/tmp', 80, 24, {
      command: 'claude',
      args: ['attach', 'x'],
      env: { NO_COLOR: '1' },
    });
    expect(spawn.mock.calls.at(-1)[2].env.NO_COLOR).toBe('1');
  });
});
