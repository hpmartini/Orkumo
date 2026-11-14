// Backend target in the shell (docs/MODULES.md, "Backend target"): module host fields, the
// connected bar, and the code-server URL of Code mode.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Backend } from '../utils/backendTarget';
import type * as BackendTargetModule from '../utils/backendTarget';
import { useModuleHost, type ModuleHost } from '../components/ModuleMount';
import { BackendBar } from '../components/BackendBar';
import { WebIDEPanel } from '../components/CodingView/WebIDEPanel';

const PEER: Backend = { prefix: '/modules/mesh/peer/darkbook', label: 'darkbook' };

// Set before apiConfig loads, so API_BASE_URL carries the prefix as after a real connect
const state = vi.hoisted(() => ({
  backend: { prefix: '/modules/mesh/peer/darkbook', label: 'darkbook' } as Backend | null,
  connect: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock('../utils/backendTarget', async (importOriginal) => ({
  ...(await importOriginal<typeof BackendTargetModule>()),
  getBackend: () => state.backend,
  connectBackend: state.connect,
  disconnectBackend: state.disconnect,
}));

beforeEach(() => {
  state.backend = PEER;
  state.connect.mockClear();
  state.disconnect.mockClear();
});

describe('module host', () => {
  const hostOf = () => {
    let host: ModuleHost | null = null;
    const Probe = () => {
      host = useModuleHost(true);
      return null;
    };
    render(
      <MemoryRouter>
        <Probe />
      </MemoryRouter>
    );
    return host as unknown as ModuleHost;
  };

  it('hands modules the backend and the connect/disconnect functions', () => {
    const host = hostOf();
    expect(host.backend).toEqual(PEER);
    expect(host.apiBase).toBe(`/api${PEER.prefix}`);
    host.connectBackend('/modules/mesh/peer/other', 'other');
    expect(state.connect).toHaveBeenCalledWith('/modules/mesh/peer/other', 'other');
    host.disconnectBackend();
    expect(state.disconnect).toHaveBeenCalledTimes(1);
  });

  it('backend is null on this machine', () => {
    state.backend = null;
    expect(hostOf().backend).toBeNull();
  });
});

describe('BackendBar', () => {
  it('shows the connected instance and disconnects on "Trennen"', async () => {
    render(<BackendBar />);
    expect(screen.getByRole('status')).toHaveTextContent('Verbunden mit darkbook');
    await userEvent.click(screen.getByRole('button', { name: /Trennen/ }));
    expect(state.disconnect).toHaveBeenCalledTimes(1);
  });

  it('renders nothing on this machine', () => {
    state.backend = null;
    const { container } = render(<BackendBar />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('WebIDEPanel code-server URL', () => {
  const DIR = '/Users/hape/PROJECTS/demo';
  const iframe = () =>
    document.querySelector('iframe[title="VS Code Server"]') as HTMLIFrameElement;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubEnv('VITE_CODE_SERVER_URL', '');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          String(url).endsWith('/code-server/status') ? { installed: true, running: true } : {},
      }))
    );
  });

  afterEach(async () => {
    // Drain the shared manager's warmup so the next case starts fresh
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const renderReady = async () => {
    render(<WebIDEPanel directory={DIR} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
  };

  it('connected: code-server of that instance through its API, host path as is', async () => {
    await renderReady();
    expect(iframe().getAttribute('src')).toBe(
      `/api${PEER.prefix}/code-server/proxy/?folder=${encodeURIComponent(DIR)}`
    );
    expect(fetch).toHaveBeenCalledWith(`/api${PEER.prefix}/code-server/status`);
  });

  it('this machine: the local code-server as before', async () => {
    state.backend = null;
    await renderReady();
    expect(iframe().getAttribute('src')).toBe(
      `http://127.0.0.1:8080/?folder=${encodeURIComponent(DIR)}`
    );
  });

  it('this machine with code-server on a Unix socket: its proxy, host path as is', async () => {
    state.backend = null;
    vi.mocked(fetch).mockImplementation(
      async (url) =>
        ({
          ok: true,
          json: async () =>
            String(url).endsWith('/code-server/status')
              ? { installed: true, running: true, url: null, socket: true }
              : {},
        }) as Response
    );
    await renderReady();
    // API_BASE_URL carries this file's mocked backend prefix: the proxy follows it
    expect(iframe().getAttribute('src')).toBe(
      `/api${PEER.prefix}/code-server/proxy/?folder=${encodeURIComponent(DIR)}`
    );
  });
});
