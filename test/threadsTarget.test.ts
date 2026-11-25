// Cluster mode: threads of a pane live on the pane's instance (its orchestrator settings and thread
// store), so thread calls go there like the UI view's chat calls, whatever the picker shows
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createThread,
  fetchThreads,
  instructOrchestrator,
  updateThread,
} from '../services/orchestratorApi';
import { uploadAttachment } from '../services/agentsApi';
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

describe('instruct and uploads by pane instance', () => {
  it('instruct with the pane session goes to its instance; without one it stays local', async () => {
    pinTarget('peer-job', PEER);
    setAgentTarget(PEER);
    await instructOrchestrator('peer-job', { text: 'hi' }, 'peer-job');
    await instructOrchestrator('local-orch', { text: 'hi' });
    expect(urls()).toEqual([
      `${API_BASE_URL}${PEER}/orchestrator/reports/peer-job/instruct`,
      `${API_BASE_URL}/orchestrator/reports/local-orch/instruct`,
    ]);
  });

  it('an attachment for a session is stored on its instance, not the picker', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ path: '/x/a.txt' })));
    pinTarget('local-job', '');
    pinTarget('peer-job', PEER);
    setAgentTarget(PEER);
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    await uploadAttachment(file, 'local-job');
    setAgentTarget('');
    await uploadAttachment(file, 'peer-job');
    expect(urls()).toEqual([
      `${API_BASE_URL}/agents/files?name=a.txt`,
      `${API_BASE_URL}${PEER}/agents/files?name=a.txt`,
    ]);
  });
});
