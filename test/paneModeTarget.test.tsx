// Cluster mode: the Status view inside a peer orchestrator pane reads and instructs the peer
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook } from '@testing-library/react';

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

import { usePaneModes } from '../components/PaneModeActions';
import { pinTarget, resetAgentTarget, setAgentTarget } from '../utils/agentTarget';
import { API_BASE_URL } from '../utils/apiConfig';

const PEER = '/modules/mesh/peer/laptop';
const STATUS = { id: 'status', label: 'Status', icon: 'Layers', orchestratorFilter: true };
const task = { project: 'shop', task: 'checkout' };
const view = (id: string) => {
  const { result } = renderHook(() => usePaneModes([STATUS]));
  render(
    <>
      {result.current.renderPaneView({
        paneId: id,
        orchestrator: true,
        role: null,
        session: { id },
        statusTask: task,
        onClose: () => {},
      })}
    </>
  );
  return host!;
};

beforeEach(() => {
  resetAgentTarget();
  host = null;
  opened.mockReset();
});

describe('Status view in a pane', () => {
  it('peer pane: the module talks to the peer and Instruct carries the pane', () => {
    pinTarget('peer-job', PEER);
    const h = view('peer-job');
    expect(h.apiBase).toBe(`${API_BASE_URL}${PEER}`);
    h.instruct({ orchestrator: 'peer-job', task, title: 'x' });
    expect(opened).toHaveBeenCalledWith({
      orchestrator: 'peer-job',
      task,
      title: 'x',
      session: 'peer-job',
    });
  });

  it('local pane with the picker on a peer: stays local', () => {
    pinTarget('local-job', '');
    setAgentTarget(PEER);
    expect(view('local-job').apiBase).toBe(API_BASE_URL);
  });
});
