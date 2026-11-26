import { describe, it, expect, vi, afterEach } from 'vitest';

// C4/C5: every agent pane PTY gets ORKUMO_PANE_ID=<paneId> at spawn, held (outlives the server)
// or not. Spawn specs are captured; nothing runs.
const heldSpecs = vi.hoisted(() => []);
vi.mock('../server/services/heldPty.js', () => ({
  heldPtySockets: () => [],
  removeStaleSocket: () => {},
  connectHeldPty: async () => null,
  spawnHeldPty: async (spec) => {
    heldSpecs.push(spec);
    return {
      pid: 4343,
      hello: {
        id: spec.id,
        cwd: spec.cwd,
        file: spec.file,
        createdAt: Date.now(),
        backlog: '',
        envPaneId: spec.env.ORKUMO_PANE_ID ?? null,
      },
      start() {},
      onData() {},
      onExit() {},
      write() {},
      kill() {},
    };
  },
}));
const spawn = vi.hoisted(() =>
  vi.fn(() => ({ pid: 4242, write() {}, kill() {}, onData() {}, onExit() {} }))
);
vi.mock('node-pty', () => ({ spawn, default: { spawn } }));

const { openAgentPty, createPtySession, killPtySession, getAllPtySessions } =
  await import('../server/services/ptyService.js');

describe('ORKUMO_PANE_ID on agent pane PTYs', () => {
  afterEach(() => {
    delete process.env.ORKUMO_PANE_ID;
    killPtySession('agent-orch-abc-1');
    killPtySession('plain-shell');
  });

  it('a held agent PTY (any harness command) carries its pane id', async () => {
    for (const command of ['claude', 'omp', 'pi', 'codex']) {
      await openAgentPty(`agent-orch-${command}-1`, '/tmp', 80, 24, { command, args: [] });
      expect(heldSpecs.at(-1).env.ORKUMO_PANE_ID).toBe(`orch-${command}`);
      killPtySession(`agent-orch-${command}-1`);
    }
  });

  it('a non-held agent PTY and an agent shell carry it too', () => {
    createPtySession('agent-work-7-99', '/tmp', 80, 24, { command: 'claude' });
    expect(spawn.mock.calls.at(-1)[2].env.ORKUMO_PANE_ID).toBe('work-7');
    killPtySession('agent-work-7-99');
    createPtySession('agent-quick-x-5', '/tmp', 80, 24); // login shell in an agent pane
    expect(spawn.mock.calls.at(-1)[2].env.ORKUMO_PANE_ID).toBe('quick-x');
    killPtySession('agent-quick-x-5');
  });

  it('a plain terminal gets none, and never the launcher’s', () => {
    process.env.ORKUMO_PANE_ID = 'orch-launcher';
    createPtySession('plain-shell', '/tmp', 80, 24);
    expect(spawn.mock.calls.at(-1)[2].env).not.toHaveProperty('ORKUMO_PANE_ID');
  });

  it('the launcher’s pane id never overrides the pane’s own', async () => {
    process.env.ORKUMO_PANE_ID = 'orch-launcher';
    await openAgentPty('agent-orch-abc-1', '/tmp', 80, 24, { command: 'claude', args: [] });
    expect(heldSpecs.at(-1).env.ORKUMO_PANE_ID).toBe('orch-abc');
  });

  it('the server records that it set the env (held: via the holder’s hello), for handoff + reset', async () => {
    await openAgentPty('agent-orch-rec-1', '/tmp', 80, 24, { command: 'claude', args: [] });
    createPtySession('agent-work-rec-2', '/tmp', 80, 24, { command: 'claude' });
    const rec = (id) => getAllPtySessions().find((x) => x.id === id)?.paneEnvSet;
    expect(rec('agent-orch-rec-1')).toBe(true);
    expect(rec('agent-work-rec-2')).toBe(true);
    killPtySession('agent-orch-rec-1');
    killPtySession('agent-work-rec-2');
  });
});
