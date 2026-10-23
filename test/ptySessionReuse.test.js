import { describe, it, expect, vi } from 'vitest';

// Fake PTYs: record writes and let the test fire onExit by hand
const spawned = [];
vi.mock('node-pty', () => {
  let nextPid = 1000;
  const spawn = vi.fn(() => {
    const p = {
      pid: nextPid++,
      writes: [],
      killed: false,
      exit: null,
      write(data) {
        this.writes.push(data);
      },
      kill() {
        this.killed = true;
      },
      onData() {},
      onExit(cb) {
        this.exit = cb;
      },
    };
    spawned.push(p);
    return p;
  });
  return { spawn, default: { spawn } };
});

const { createPtySession, writeToPty, killPtySession, ptyEvents } =
  await import('../server/services/ptyService.js');

describe('PTY session reuse (terminal remount reconnects with the same sessionId)', () => {
  it('keeps input flowing to the new PTY after the replaced one exits and its socket closes', () => {
    const exits = [];
    ptyEvents.on('exit', (e) => exits.push(e));

    const first = createPtySession('s1', '/tmp');
    const second = createPtySession('s1', '/tmp');
    const [oldPty, newPty] = spawned.slice(-2);
    expect(oldPty.killed).toBe(true);

    // the killed PTY exits after its successor was registered ...
    oldPty.exit({ exitCode: 0, signal: 1 });
    // ... and the old WebSocket's close handler cleans up by sessionId
    expect(killPtySession('s1', first.pid)).toBe(false);

    expect(writeToPty('s1', 'ls\r')).toBe(true);
    expect(newPty.writes).toEqual(['ls\r']);
    expect(newPty.killed).toBe(false);
    expect(exits).toEqual([]);

    expect(killPtySession('s1', second.pid)).toBe(true);
    expect(newPty.killed).toBe(true);
  });
});
