// #252: keep-alive of the main agent (the martini-workflow main orchestrator session)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  findMainAgent,
  keepMainAgentAlive,
  resetKeepAlive,
  KEEP_ALIVE_GAP_MS,
} from '../server/services/mainAgent.js';

const s = (partial) => ({
  id: 'j1',
  kind: 'background',
  name: 'main-orchestrator',
  state: 'working',
  startedAt: 1,
  ...partial,
});

describe('findMainAgent', () => {
  it('picks the newest background session with the name, nothing else', () => {
    const sessions = [
      s({ id: 'old', startedAt: 1 }),
      s({ id: 'new', startedAt: 5 }),
      s({ id: 'tty', kind: 'interactive', startedAt: 9 }),
      s({ id: 'other', name: 'worker', startedAt: 9 }),
    ];
    expect(findMainAgent(sessions).id).toBe('new');
    expect(findMainAgent(sessions, 'worker').id).toBe('other');
    expect(findMainAgent([], 'x')).toBeNull();
  });
});

describe('keepMainAgentAlive', () => {
  beforeEach(resetKeepAlive);

  it('respawns the stopped main agent, and only that', async () => {
    const respawn = vi.fn().mockResolvedValue({});
    const sessions = [s({ state: 'stopped' }), s({ id: 'w', name: 'worker', state: 'stopped' })];
    expect(await keepMainAgentAlive(sessions, { respawn, now: 1000 })).toBe('j1');
    expect(respawn.mock.calls).toEqual([['j1']]);
  });

  it('leaves a running, finished, failed or missing main agent alone', async () => {
    const respawn = vi.fn();
    for (const state of ['working', 'blocked', 'done', 'failed']) {
      expect(await keepMainAgentAlive([s({ state })], { respawn, now: 1000 })).toBeNull();
    }
    expect(await keepMainAgentAlive([], { respawn, now: 1000 })).toBeNull();
    expect(respawn).not.toHaveBeenCalled();
  });

  it('does nothing when switched off, and follows a configured name', async () => {
    const respawn = vi.fn().mockResolvedValue({});
    const sessions = [s({ state: 'stopped' }), s({ id: 'c', name: 'chief', state: 'stopped' })];
    expect(
      await keepMainAgentAlive(sessions, { respawn, now: 1000, config: { keepAlive: false } })
    ).toBeNull();
    expect(
      await keepMainAgentAlive(sessions, { respawn, now: 1000, config: { name: 'chief' } })
    ).toBe('c');
  });

  it('waits five minutes before the next attempt, also after a failed one', async () => {
    const respawn = vi.fn().mockRejectedValueOnce(new Error('daemon down')).mockResolvedValue({});
    const sessions = [s({ state: 'stopped' })];
    await expect(keepMainAgentAlive(sessions, { respawn, now: 1000 })).rejects.toThrow(
      'daemon down'
    );
    expect(
      await keepMainAgentAlive(sessions, { respawn, now: 1000 + KEEP_ALIVE_GAP_MS - 1 })
    ).toBeNull();
    expect(await keepMainAgentAlive(sessions, { respawn, now: 1000 + KEEP_ALIVE_GAP_MS })).toBe(
      'j1'
    );
    expect(respawn).toHaveBeenCalledTimes(2);
  });
});
