import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useStoredToggle } from '../hooks/useStoredToggle';
import { MemoryRouter } from 'react-router-dom';
import { AgentsView } from '../components/AgentsView/AgentsView';
import { summarizeSessions } from '../utils/agentSessions';
import { DEFAULT_AGENT_VIEW_SETTINGS, type AgentSession } from '../types';

// Terminal sessions no Orkumo pane runs are hidden in the rail by default, of every harness;
// Claude app sessions are not interactive

const base = { pinned: false, order: null, links: [], state: null, startedAt: 1 };
const SESSIONS: AgentSession[] = [
  {
    ...base,
    id: 'job1',
    sessionId: null,
    kind: 'background',
    cwd: '/home/dev/alpha',
    name: 'alpha-worker',
    state: 'working',
    displayState: 'working',
  },
  {
    ...base,
    id: 'interactive-11',
    sessionId: '11111111-1111-4111-8111-111111111111',
    kind: 'interactive',
    cwd: '/home/dev/beta',
    name: 'terminal-beta',
    pid: 11,
    displayState: 'interactive',
  },
  {
    ...base,
    id: 'interactive-22',
    sessionId: '22222222-2222-4222-8222-222222222222',
    kind: 'app',
    cwd: '/home/dev/.claude',
    name: 'Issues abarbeiten',
    pid: 22,
    displayState: 'idle',
    app: { url: 'https://claude.ai/code/session_01abcdefgh', origin: 'ios', statusCategory: null },
  },
  {
    ...base,
    id: 'omp-01a1a647-401a-7036-94eb-69d3a3ca1b37',
    sessionId: '01a1a647-401a-7036-94eb-69d3a3ca1b37',
    kind: 'interactive',
    ptyCommand: 'omp',
    ptyArgs: ['-r', '01a1a647-401a-7036-94eb-69d3a3ca1b37'],
    cwd: '/home/dev/alpha',
    name: 'Fix omp resume',
    state: 'done',
    displayState: 'completed',
  },
  {
    ...base,
    id: 'omp-02b2b647-401a-7036-94eb-69d3a3ca1b37',
    sessionId: '02b2b647-401a-7036-94eb-69d3a3ca1b37',
    kind: 'interactive',
    ptyCommand: 'omp',
    ptyArgs: ['-r', '02b2b647-401a-7036-94eb-69d3a3ca1b37'],
    cwd: '/home/dev/alpha',
    name: 'omp in a pane',
    paneId: 'interactive-1794214000000',
    displayState: 'working',
  },
];

vi.mock('../hooks/useAgentSessions', () => ({
  useAgentSessions: () => ({
    sessions: SESSIONS,
    daemon: null,
    userSettings: null,
    cliInstalled: true,
    capabilities: null,
    settings: { ...DEFAULT_AGENT_VIEW_SETTINGS, grouping: 'state' },
    updateSettings: () => {},
    loading: false,
    error: null,
    connected: true,
    counts: summarizeSessions(SESSIONS),
    lastCompleted: null,
    refresh: () => {},
  }),
}));
vi.mock('../hooks/useRemoteAgents', () => ({
  useRemoteAgents: () => ({ hosts: [], sessions: [], refresh: () => {} }),
}));
vi.mock('../hooks/useAgentContexts', () => ({ useAgentContexts: () => ({}) }));
vi.mock('../components/CommandPalette', async (orig) => ({
  ...(await orig<object>()),
  useCommandPalette: () => ({ register: () => () => {}, open: () => {}, close: () => {} }),
  useRegisterCommands: () => {},
}));

const nav = {
  onOpenDashboard: () => {},
  onOpenContextDashboard: () => {},
  onOpenSettings: () => {},
  onOpenProject: () => {},
};

const renderView = () =>
  render(
    <MemoryRouter>
      <AgentsView active apps={[]} onExit={() => {}} nav={nav} onOpenView={() => {}} />
    </MemoryRouter>
  );
const toggle = () => screen.getByRole('switch', { name: 'Interactive sessions' });
const rowNames = () =>
  screen
    .getAllByRole('option', { hidden: true })
    .map((el) => el.textContent ?? '')
    .join('\n');

beforeEach(() => {
  localStorage.clear();
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.scrollTo = () => {};
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {}))
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('interactive sessions switch', () => {
  it('hides terminals no Orkumo pane runs by default but keeps Claude app sessions', () => {
    renderView();
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(rowNames()).toContain('alpha-worker');
    expect(rowNames()).toContain('Issues abarbeiten');
    // omp (#195) too: a session another agent started, or one that ended, is hidden
    expect(rowNames()).not.toContain('Fix omp resume');
    expect(rowNames()).not.toContain('terminal-beta');
    // a session an Orkumo pane runs (also detached) stays
    expect(rowNames()).toContain('omp in a pane');
    expect(screen.getByText('2 hidden')).toBeTruthy();
  });

  it('shows them when switched on and remembers the choice', () => {
    renderView();
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(rowNames()).toContain('terminal-beta');
    expect(rowNames()).toContain('Fix omp resume');
    cleanup();
    renderView();
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(rowNames()).toContain('terminal-beta');
  });

  // AgentsView reads other keys unguarded; the switch's own storage must still never throw
  it('stays hidden and toggles in memory when localStorage throws', () => {
    vi.spyOn(window.Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const { result } = renderHook(() => useStoredToggle('devOrbitAgentInteractive'));
      expect(result.current[0]).toBe(false);
      act(() => result.current[1]());
      expect(result.current[0]).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
