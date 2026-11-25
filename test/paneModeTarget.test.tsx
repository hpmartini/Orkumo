// Cluster mode: the Status view inside a peer orchestrator pane reads and instructs the peer
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

type Host = { apiBase: string; instruct: (t: object) => void };
let host: Host | null = null;
vi.mock('../components/ModuleMount', () => ({
  useModuleHost: () => ({ apiBase: '/api', instruct: () => {} }),
  ModuleMount: (p: { host: Host }) => {
    host = p.host;
    return null;
  },
}));
const opened = vi.fn();
vi.mock('../components/InstructDialog', () => ({ openInstruct: (t: object) => opened(t) }));
// the pane's instance says which key its reports are under (role, else session), null: none
const fetchThreads = vi.fn();
vi.mock('../services/orchestratorApi', () => ({ fetchThreads: (s: string) => fetchThreads(s) }));

import { usePaneModes } from '../components/PaneModeActions';
import { pinTarget, resetAgentTarget, setAgentTarget } from '../utils/agentTarget';
import { API_BASE_URL } from '../utils/apiConfig';

const PEER = '/modules/mesh/peer/laptop';
const STATUS = { id: 'status', label: 'Status', icon: 'Layers', orchestratorFilter: true };
const task = { project: 'shop', task: 'checkout' };
const View = ({ id }: { id: string }) => (
  <>
    {usePaneModes([STATUS]).renderPaneView({
      paneId: id,
      orchestrator: true,
      role: null,
      session: { id },
      statusTask: task,
      onClose: () => {},
    })}
  </>
);
// a peer pane mounts once its instance answered the threads call
const view = async (id: string) => {
  render(<View id={id} />);
  await waitFor(() => expect(host).not.toBeNull());
  return host!;
};

beforeEach(() => {
  resetAgentTarget();
  host = null;
  opened.mockReset();
  fetchThreads.mockReset();
});

describe('Status view in a pane', () => {
  it('peer pane: the module talks to the peer and Instruct carries the pane', async () => {
    pinTarget('peer-job', PEER);
    fetchThreads.mockResolvedValue({ orchestrator: 'peer-job', threads: [], tasks: [] });
    const h = await view('peer-job');
    expect(h.apiBase).toBe(`${API_BASE_URL}${PEER}`);
    h.instruct({ orchestrator: 'peer-job', task, title: 'x' });
    expect(opened).toHaveBeenCalledWith({
      orchestrator: 'peer-job',
      task,
      title: 'x',
      session: 'peer-job',
    });
  });

  it('local pane with the picker on a peer: stays local', async () => {
    pinTarget('local-job', '');
    setAgentTarget(PEER);
    expect((await view('local-job')).apiBase).toBe(API_BASE_URL);
  });

  // agents-ui flags orchestrators from this machine's settings: a peer's own are unknown here
  type Pane = { paneId: string; orchestrator: boolean; role: null; session: { id: string } };
  const Actions = ({ p }: { p: Pane }) => <>{usePaneModes([STATUS]).renderPaneActions(p)}</>;
  const peer = (orchestrator: boolean): Pane => ({
    paneId: 'peer-job',
    orchestrator,
    role: null,
    session: { id: 'peer-job' },
  });

  it('peer orchestrator: the button comes from its own instance', async () => {
    pinTarget('peer-job', PEER);
    fetchThreads.mockResolvedValue({ orchestrator: 'release', threads: [], tasks: [] });
    render(<Actions p={peer(false)} />);
    expect(await screen.findByRole('button', { name: 'Show in Status' })).toBeInTheDocument();
    expect(fetchThreads).toHaveBeenCalledWith('peer-job');
    expect(fetchThreads).toHaveBeenCalledTimes(1);
  });

  it('peer orchestrator: the view is filtered on the key its instance names', async () => {
    pinTarget('peer-job', PEER);
    fetchThreads.mockResolvedValue({ orchestrator: 'release', threads: [], tasks: [] });
    const h = await view('peer-job');
    expect(h).toMatchObject({
      search: 'orchestrator=release',
      pane: { orchestrator: 'release', task },
    });
  });

  it('peer offline: one request, not one per render', async () => {
    pinTarget('peer-job', PEER);
    fetchThreads.mockRejectedValue(new Error('offline'));
    const { rerender } = render(<Actions p={peer(true)} />);
    await waitFor(() => expect(fetchThreads).toHaveBeenCalled());
    for (let i = 0; i < 20; i++) {
      await act(async () => {});
      rerender(<Actions p={{ ...peer(true) }} />);
    }
    expect(fetchThreads).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Show in Status' })).toBeNull();
  });

  it('peer agent that is no orchestrator there: no button', async () => {
    pinTarget('peer-job', PEER);
    fetchThreads.mockResolvedValue({ orchestrator: null, threads: [], tasks: [] });
    render(<Actions p={peer(true)} />);
    await waitFor(() => expect(fetchThreads).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Show in Status' })).toBeNull();
  });

  it("local pane: this machine's flag, no extra request", () => {
    pinTarget('local-job', '');
    setAgentTarget(PEER);
    render(
      <Actions
        p={{ paneId: 'local-job', orchestrator: true, role: null, session: { id: 'local-job' } }}
      />
    );
    expect(screen.getByRole('button', { name: 'Show in Status' })).toBeInTheDocument();
    expect(fetchThreads).not.toHaveBeenCalled();
  });
});
