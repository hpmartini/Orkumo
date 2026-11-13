import { describe, it, expect, vi } from 'vitest';
import { startQuickAgent } from '../server/services/quickAgent.js';

const deps = (over = {}) => ({
  openAgentPty: vi.fn().mockResolvedValue({ success: true }),
  killPanePtys: vi.fn(),
  resolveBinary: vi.fn(() => '/bin/omp'),
  ompArgs: vi.fn(() => ['--config', '/tmp/overlay.yml']),
  findOmpSession: vi.fn().mockResolvedValue(null),
  waitMs: 200,
  pollMs: 10,
  ...over,
});

describe('startQuickAgent (#251)', () => {
  it('starts Claude Code with a session id it knows up front and the prompt as first message', async () => {
    const d = deps();
    const agent = await startQuickAgent(
      { harness: 'claude', prompt: 'hi; $(rm -rf ~)', cwd: '/home/me', model: 'opus' },
      d
    );
    const [ptyId, cwd, , , options] = d.openAgentPty.mock.calls[0];
    expect(ptyId).toMatch(new RegExp(`^agent-${agent.paneId}-\\d+$`));
    expect(agent.paneId).toMatch(/^quick-/);
    expect(cwd).toBe('/home/me');
    // an argument array without a shell: the prompt stays one literal argument
    expect(options).toEqual({
      command: 'claude',
      args: ['--session-id', agent.sessionId, '--model', 'opus', 'hi; $(rm -rf ~)'],
      detachOnClose: true,
    });
  });

  it('waits for omp to name its session, then returns it', async () => {
    const findOmpSession = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue('01a1c095-7edd-72eb-9c97-4afdcd01f56e');
    const d = deps({ findOmpSession });
    const agent = await startQuickAgent({ harness: 'omp', prompt: 'hi', cwd: '/h' }, d);
    expect(agent.sessionId).toBe('01a1c095-7edd-72eb-9c97-4afdcd01f56e');
    expect(findOmpSession).toHaveBeenCalledWith(agent.paneId);
    expect(d.openAgentPty.mock.calls[0][4].args).toEqual([
      '--config',
      '/tmp/overlay.yml',
      '--',
      'hi',
    ]);
  });

  it('stops an omp agent that never reports a session', async () => {
    const d = deps();
    await expect(startQuickAgent({ harness: 'omp', prompt: 'hi', cwd: '/h' }, d)).rejects.toThrow(
      /no session/
    );
    expect(d.killPanePtys).toHaveBeenCalledWith(expect.stringMatching(/^quick-/));
  });

  it('refuses harnesses without a transcript the quick window can read', async () => {
    const d = deps();
    await expect(
      startQuickAgent({ harness: 'codex', prompt: 'hi', cwd: '/h' }, d)
    ).rejects.toMatchObject({ status: 400 });
    expect(d.openAgentPty).not.toHaveBeenCalled();
  });
});
