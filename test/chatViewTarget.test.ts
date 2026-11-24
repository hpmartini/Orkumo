// Cluster mode: the UI view of a pane opens on the pane's instance even while the picker points
// at another one (agents-ui shows the view for every pane and relies on this routing)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openTranscriptView, fetchChatStatus } from '../services/agentsApi';
import { pinTarget, resetAgentTarget, setAgentTarget } from '../utils/agentTarget';
import { API_BASE_URL } from '../utils/apiConfig';

const PEER = '/modules/mesh/peer/laptop';
const body = { harness: 'claude' as const, sessionId: 'uuid-1', cwd: '/w' };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetAgentTarget();
  fetchMock = vi.fn(async (url: string) => {
    const id = url.includes(PEER) ? 'chat-peer' : 'chat-local';
    return new Response(JSON.stringify({ id }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('UI view routing by pane instance', () => {
  it('local pane with the picker on a peer: view and its chat calls stay local', async () => {
    pinTarget('local-pane', '');
    setAgentTarget(PEER);
    const chat = await openTranscriptView('local-pane', body);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE_URL}/agents/chat/view`);
    await fetchChatStatus(chat.id);
    expect(fetchMock.mock.calls[1][0]).toBe(`${API_BASE_URL}/agents/chat/chat-local/status`);
  });

  it('peer pane with the picker back on this machine: view and its chat calls go to the peer', async () => {
    pinTarget('peer-pane', PEER);
    const chat = await openTranscriptView('peer-pane', body);
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE_URL}${PEER}/agents/chat/view`);
    await fetchChatStatus(chat.id);
    expect(fetchMock.mock.calls[1][0]).toBe(`${API_BASE_URL}${PEER}/agents/chat/chat-peer/status`);
  });
});
