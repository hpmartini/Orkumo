import { describe, it, expect, beforeEach } from 'vitest';
import {
  agentApiUrl,
  agentWsUrl,
  getAgentTarget,
  pinTarget,
  resetAgentTarget,
  setAgentTarget,
  targetOf,
} from './agentTarget';
import { API_BASE_URL } from './apiConfig';

const PEER = '/modules/mesh/peer/darkbook';

beforeEach(resetAgentTarget);

describe('agentTarget', () => {
  it('accepts only "" or a module prefix', () => {
    for (const bad of ['/agents', 'http://evil', '/modules/../x', '/modules/Mesh', '//x']) {
      setAgentTarget(bad);
      expect(getAgentTarget()).toBe('');
    }
    setAgentTarget(PEER);
    expect(getAgentTarget()).toBe(PEER);
  });

  it('routes /agents paths to the current target, ids to the target they were seen on', () => {
    pinTarget('local1', '');
    setAgentTarget(PEER);
    pinTarget('peer1', PEER);
    expect(agentApiUrl('/agents?cwd=x')).toBe(`${API_BASE_URL}${PEER}/agents?cwd=x`);
    expect(agentApiUrl('/agents/local1/stop')).toBe(`${API_BASE_URL}/agents/local1/stop`);
    setAgentTarget('');
    expect(agentApiUrl('/agents/peer1/logs?lines=60')).toBe(
      `${API_BASE_URL}${PEER}/agents/peer1/logs?lines=60`
    );
    expect(agentApiUrl('/agents/chat/view', 'peer1')).toBe(
      `${API_BASE_URL}${PEER}/agents/chat/view`
    );
    expect(agentWsUrl('peer1')).toMatch(new RegExp(`${PEER}/pty$`));
    expect(agentWsUrl('local1')).toMatch(/\/api\/pty$/);
  });

  it('chat ids: /agents/chat/<id>/... uses the chat id; first seen target wins', () => {
    pinTarget('c1', PEER);
    pinTarget('c1', '');
    expect(targetOf('c1')).toBe(PEER);
    expect(agentApiUrl('/agents/chat/c1/stream')).toBe(
      `${API_BASE_URL}${PEER}/agents/chat/c1/stream`
    );
    expect(agentApiUrl('/agents/chat')).toBe(`${API_BASE_URL}/agents/chat`);
  });
});
