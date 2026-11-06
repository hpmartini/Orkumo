import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AgentsView } from '../components/AgentsView/AgentsView';
import { STORAGE_KEY as RAIL_KEY } from '../hooks/useRailPreferences';
import { STORAGE_KEY as WORKSPACE_KEY } from '../hooks/useAgentWorkspace';
import { summarizeSessions } from '../utils/agentSessions';
import { DEFAULT_AGENT_VIEW_SETTINGS, type AgentSession } from '../types';

// #207 AC-3: "Open terminal here" in the rail's group and row menus, by mouse and keyboard

const SESSIONS: AgentSession[] = [
  {
    id: 's1',
    sessionId: null,
    kind: 'background',
    cwd: '/home/dev/alpha/.claude/worktrees/feat-x',
    startedAt: 1,
    name: 'alpha-worker',
    state: 'working',
    pinned: false,
    order: null,
    links: [],
    displayState: 'working',
  },
];

const hoisted = vi.hoisted(() => ({ grouping: 'directory' as string, cardDetails: 'click' }));

vi.mock('../hooks/useAgentSessions', () => ({
  useAgentSessions: () => ({
    sessions: SESSIONS,
    daemon: null,
    userSettings: null,
    cliInstalled: true,
    capabilities: null,
    settings: {
      ...DEFAULT_AGENT_VIEW_SETTINGS,
      grouping: hoisted.grouping,
      cardDetails: hoisted.cardDetails,
    },
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
// xterm needs a canvas; here the pane is proven by its id, scripts/review/207-e2e.cjs runs the real one
vi.mock('../components/AgentsView/AgentTerminal', async (orig) => ({
  ...(await orig<object>()),
  AgentTerminal: ({ session }: { session: AgentSession }) => (
    <div data-agent-pane={session.id}>{session.name}</div>
  ),
}));

const nav = {
  onOpenDashboard: () => {},
  onOpenContextDashboard: () => {},
  onOpenSettings: () => {},
  onOpenProject: () => {},
  onStartApp: () => {},
  onStopApp: () => {},
};

const renderView = (grouping: string, cardDetails = 'click') => {
  hoisted.grouping = grouping;
  hoisted.cardDetails = cardDetails;
  render(
    <MemoryRouter>
      <AgentsView active apps={[]} onExit={() => {}} nav={nav} onOpenView={() => {}} />
    </MemoryRouter>
  );
};
// a lone group is not draggable: headers are the options with a collapse chevron
const headers = () =>
  screen
    .getAllByRole('option', { hidden: true })
    .filter((el) =>
      el.querySelector('button[aria-label^="Expand "], button[aria-label^="Collapse "]')
    );
const headerTitle = (h: HTMLElement) =>
  h
    .querySelector('button[aria-label^="Expand "], button[aria-label^="Collapse "]')!
    .getAttribute('aria-label')!
    .replace(/^(Expand|Collapse) /, '');
const header = (name: RegExp) => headers().find((h) => name.test(headerTitle(h)))!;
const menuLabels = () => screen.queryAllByRole('menuitem').map((b) => b.textContent?.trim());
const shellPanes = () =>
  Array.from(document.querySelectorAll('[data-agent-pane^="shell:"]')).map((el) =>
    el.getAttribute('data-agent-pane')
  );

beforeEach(() => {
  localStorage.removeItem(RAIL_KEY);
  localStorage.removeItem(WORKSPACE_KEY);
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

describe('Open terminal here (#207)', () => {
  it('right-click on a project group opens a shell pane in its directory', () => {
    renderView('directory');
    fireEvent.contextMenu(header(/feat-x$/));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open terminal here' }));
    expect(shellPanes()).toEqual([`shell:1:${SESSIONS[0].cwd}`]);
  });

  it('Shift+F10 on a session row offers it and opens the shell in the session folder', () => {
    renderView('directory');
    const row = screen.getByText('alpha-worker');
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: 'F10', shiftKey: true });
    const item = screen.getByRole('menuitem', { name: 'Open terminal here' });
    expect(item.hasAttribute('disabled')).toBe(false);
    fireEvent.click(item);
    expect(shellPanes()).toEqual([`shell:1:${SESSIONS[0].cwd}`]);
  });

  it('is missing for groups without a directory and in the Favorites section', () => {
    renderView('state');
    fireEvent.contextMenu(header(/^Working$/));
    expect(menuLabels().length).toBeGreaterThan(0);
    expect(menuLabels()).not.toContain('Open terminal here');

    cleanup();
    renderView('directory');
    // a favorite session moves into the leading Favorites section
    fireEvent.contextMenu(screen.getByText('alpha-worker'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to favorites' }));
    fireEvent.contextMenu(header(/^Favorites$/));
    expect(menuLabels().length).toBeGreaterThan(0);
    expect(menuLabels()).not.toContain('Open terminal here');
  });
});

// #242 AC-5: "Keep details open" only where a click does not already keep them open
describe('Keep details open (#242)', () => {
  it.each([
    ['hover', true],
    ['click', false],
    ['always', false],
  ])('in %s mode the row menu offers it: %s', (mode, offered) => {
    renderView('directory', mode);
    fireEvent.contextMenu(screen.getByText('alpha-worker'));
    expect(menuLabels()).toContain('Rename');
    expect(menuLabels().includes('Keep details open')).toBe(offered);
  });

  it('a card pinned in hover mode can still be unpinned after switching to click', () => {
    renderView('directory', 'hover');
    fireEvent.contextMenu(screen.getByText('alpha-worker'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Keep details open' }));
    cleanup();
    renderView('directory', 'click');
    fireEvent.contextMenu(screen.getByText('alpha-worker'));
    expect(menuLabels()).toContain('Hide details');
  });
});
