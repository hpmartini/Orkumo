import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// `orkumo send` to a busy job must not fork it with `--resume` (a second job in the same worktree)
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-session-'));
process.env.CLAUDE_CONFIG_DIR = home;
process.env.CLAUDE_CLI_PATH = '/bin/sh'; // any executable: execFile and node-pty are mocked

let job = {};
const calls = [];
const ptys = [];

vi.mock('node-pty', () => ({
  spawn: vi.fn((bin, args) => {
    const pty = { args, written: '', data: null, exit: null };
    pty.onData = (cb) => (pty.data = cb);
    pty.onExit = (cb) => (pty.exit = cb);
    pty.write = (s) => (pty.written += s);
    pty.kill = () => clearInterval(pty.spinner);
    // A running turn's spinner redraws every 0.5 s and never goes quiet
    pty.start = (busy) => {
      pty.data('prompt');
      if (busy) pty.spinner = setInterval(() => pty.data('✻'), 500);
    };
    ptys.push(pty);
    return pty;
  }),
}));
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  const execFile = (cmd, args, opts, cb) => {
    calls.push(args);
    if (args[0] === 'agents') cb(null, JSON.stringify([{ kind: 'background', ...job }]), '');
    else cb(null, 'backgrounded · fork1234', '');
  };
  return { ...actual, default: { ...actual, execFile }, execFile };
});

const { replySession } = await import('../server/services/agentService.js');
const resumes = () => calls.filter((a) => a[0] === '--resume');

/** Reply while the attach PTY behaves like a busy or idle session; resolves to the result */
async function reply(busy, options) {
  const result = replySession('job12345', 'line one\nline two', options).then(
    (r) => r,
    (e) => e
  );
  await vi.waitFor(() => expect(ptys.length).toBe(1));
  ptys[0].start(busy);
  await vi.advanceTimersByTimeAsync(15000);
  return result;
}

beforeEach(() => {
  calls.length = 0;
  ptys.length = 0;
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fs.mkdirSync(path.join(home, 'jobs', 'job12345'), { recursive: true });
  fs.writeFileSync(
    path.join(home, 'jobs', 'job12345', 'state.json'),
    JSON.stringify({ sessionId: 'sess-1' })
  );
});
afterEach(() => vi.useRealTimers());

describe('replySession', () => {
  it('busy job: types into the running session, answers "queued", never resumes', async () => {
    job = { id: 'job12345', state: 'working', status: 'busy', pid: 4242 };
    const result = await reply(true);
    expect(result).toEqual({ delivered: false, queued: true, mode: 'attach' });
    expect(ptys[0].args).toEqual(['attach', 'job12345']);
    // multi-line stays one prompt (Shift+Enter), then Enter and detach
    expect(ptys[0].written).toBe('line one\x1b[13;2uline two\r\x1a');
    expect(resumes()).toEqual([]);
  });

  it('idle job: delivers through attach', async () => {
    job = { id: 'job12345', state: 'done', status: 'idle', pid: 4242 };
    expect(await reply(false)).toEqual({ delivered: true, queued: false, mode: 'attach' });
    expect(resumes()).toEqual([]);
  });

  it('running job whose attach fails: an error, no fork', async () => {
    job = { id: 'job12345', state: 'working', status: 'busy', pid: 4242 };
    const result = replySession('job12345', 'hi').then(
      (r) => r,
      (e) => e
    );
    await vi.waitFor(() => expect(ptys.length).toBe(1));
    ptys[0].exit({ exitCode: 1 });
    const error = await result;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/not delivered \(session is running, no --resume\)/);
    expect(resumes()).toEqual([]);
  });

  it('running job, explicit resume: refused with 409', async () => {
    job = { id: 'job12345', state: 'working', status: 'busy', pid: 4242 };
    await expect(replySession('job12345', 'hi', { mode: 'resume' })).rejects.toMatchObject({
      status: 409,
    });
    expect(ptys).toEqual([]);
    expect(resumes()).toEqual([]);
  });

  it('ended job (no process): attach fails, falls back to --resume', async () => {
    job = { id: 'job12345', state: 'done' };
    const result = replySession('job12345', 'weiter').then(
      (r) => r,
      (e) => e
    );
    await vi.waitFor(() => expect(ptys.length).toBe(1));
    ptys[0].exit({ exitCode: 1 });
    expect(await result).toMatchObject({ delivered: true, mode: 'resume' });
    expect(resumes()).toEqual([['--resume', 'sess-1', '--bg', '--', 'weiter']]);
  });
});
