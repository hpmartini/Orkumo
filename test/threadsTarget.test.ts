// Cluster mode: threads of a pane live on the pane's instance (its orchestrator settings and thread
// store), so thread calls go there like the UI view's chat calls, whatever the picker shows
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createThread, fetchThreads, updateThread } from '../services/orchestratorApi';
import { pinTarget, resetAgentTarget, setAgentTarget } from '../utils/agentTarget';
import { API_BASE_URL } from '../utils/apiConfig';

const PEER = '/modules/mesh/peer/laptop';
const thread = { id: 't1' };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetAgentTarget();
  fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ orchestrator: 'x', threads: [], thread }))
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const urls = () => fetchMock.mock.calls.map((c) => c[0]);

describe('thread calls by pane instance', () => {
  it('peer session: list, create and update go through the peer relay', async () => {
    pinTarget('peer-job', PEER);
    await fetchThreads('peer-job');
    await createThread('peer-job', { name: { project: 'p', task: 't' } });
    await updateThread('peer-job', 't1', { closed: true });
    expect(urls()).toEqual([
      `${API_BASE_URL}${PEER}/orchestrator/threads?session=peer-job`,
      `${API_BASE_URL}${PEER}/orchestrator/threads`,
      `${API_BASE_URL}${PEER}/orchestrator/threads/t1`,
    ]);
  });

  it('local session with the picker on a peer: stays local', async () => {
    pinTarget('local-job', '');
    setAgentTarget(PEER);
    await fetchThreads('local-job');
    expect(urls()).toEqual([`${API_BASE_URL}/orchestrator/threads?session=local-job`]);
  });
});
