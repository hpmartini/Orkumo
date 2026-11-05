import { describe, it, expect } from 'vitest';
import { resumableSessionId } from '../utils/agentSessions';
import type { AgentSession } from '../types';

const ID = '0b6f2c1e-1111-4222-8333-944455556666';
const s = (p: Partial<AgentSession>) =>
  ({ id: 'x', sessionId: null, kind: 'interactive', ...p }) as AgentSession;

describe('resumableSessionId', () => {
  it('uses the known session id of a background agent', () => {
    expect(resumableSessionId(s({ kind: 'background', sessionId: ID }))).toBe(ID);
  });
  it('reads --resume or --session-id from a local terminal pane', () => {
    expect(resumableSessionId(s({ ptyArgs: ['--resume', ID] }))).toBe(ID);
    expect(resumableSessionId(s({ ptyArgs: ['--session-id', ID] }))).toBe(ID);
  });
  it('is null when nothing identifies the session or it runs elsewhere', () => {
    expect(resumableSessionId(s({ ptyArgs: [] }))).toBeNull();
    expect(resumableSessionId(s({ ptyArgs: ['--cloud', 'x', '--resume', ID] }))).toBeNull();
    expect(resumableSessionId(s({ sessionId: ID, host: 'mac' }))).toBeNull();
    expect(resumableSessionId(s({ ptyCommand: 'ssh', ptyArgs: ['--resume', ID] }))).toBeNull();
    expect(resumableSessionId(s({ chat: true, sessionId: ID }))).toBeNull();
  });
});
