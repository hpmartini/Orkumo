import { describe, expect, it } from 'vitest';
import { composerStartCwd } from '../utils/composer';

const dirs = {
  picked: null,
  opened: null,
  taskCwd: '/home/MAGOS',
  targetCwd: '/proj',
  homeDir: '/home',
};

describe('composerStartCwd', () => {
  it('task starts in the task default, else the rail target', () => {
    expect(composerStartCwd('task', dirs)).toBe('/home/MAGOS');
    expect(composerStartCwd('task', { ...dirs, taskCwd: null })).toBe('/proj');
  });
  it('agent and chat ignore the task default; the directory handed over on open wins', () => {
    expect(composerStartCwd('agent', dirs)).toBe('/home');
    expect(composerStartCwd('chat', dirs)).toBe('/proj');
    expect(composerStartCwd('agent', { ...dirs, opened: '/grp' })).toBe('/grp');
    expect(composerStartCwd('chat', { ...dirs, opened: '/chats' })).toBe('/chats');
  });
  it('a pick in the composer holds for every kind', () => {
    for (const kind of ['task', 'agent', 'chat'] as const)
      expect(composerStartCwd(kind, { ...dirs, picked: '/x', opened: '/grp' })).toBe('/x');
  });
});
