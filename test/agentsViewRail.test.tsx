import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AgentsView } from '../components/AgentsView/AgentsView';
import { STORAGE_KEY } from '../hooks/useRailPreferences';
import { summarizeSessions } from '../utils/agentSessions';
import {
  DEFAULT_AGENT_VIEW_SETTINGS,
  type AgentGrouping,
  type AgentSession,
  type PaletteCommand,
} from '../types';

// #50: palette groups.* and the rail keyboard path in AgentsView itself, per grouping

const SESSIONS: AgentSession[] = [
  {
    id: 's1',
    sessionId: null,
    kind: 'background',
    cwd: '/home/dev/alpha',
    startedAt: 1,
    name: 'alpha-worker',
    state: 'working',
    pinned: false,
    order: null,
    links: [],
    displayState: 'working',
  },
  {
    id: 's2',
    sessionId: null,
    kind: 'background',
    cwd: '/home/dev/beta',
    startedAt: 2,
    name: 'beta-asker',
    state: 'blocked',
    pinned: false,
    order: null,
    links: [],
    displayState: 'needs-input',
  },
];

const hoisted = vi.hoisted(() => ({
  grouping: 'project' as string,
  commands: new Map<string, unknown[]>(),
}));

vi.mock('../hooks/useAgentSessions', () => ({
  useAgentSessions: () => ({
    sessions: SESSIONS,
    daemon: null,
    userSettings: null,
    cliInstalled: true,
    capabilities: null,
    settings: { ...DEFAULT_AGENT_VIEW_SETTINGS, grouping: hoisted.grouping },
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
  useRegisterCommands: (source: string, commands: unknown[]) => {
    hoisted.commands.set(source, commands);
  },
}));

const nav = {
  onOpenDashboard: () => {},
  onOpenSettings: () => {},
  onOpenProject: () => {},
  onStartApp: () => {},
  onStopApp: () => {},
};

const MODES: { grouping: AgentGrouping; group: RegExp }[] = [
  { grouping: 'project', group: /alpha$/ },
  { grouping: 'state', group: /^Working$/ },
  { grouping: 'directory', group: /alpha$/ },
];

const headers = () =>
  screen.getAllByRole('option').filter((el) => el.getAttribute('draggable') === 'true');
const chevron = (h: HTMLElement) => within(h).getByRole('button', { name: /^(Expand|Collapse) / });
const headerTitle = (h: HTMLElement) =>
  chevron(h)
    .getAttribute('aria-label')!
    .replace(/^(Expand|Collapse) /, '');
const header = (name: RegExp) => headers().find((h) => name.test(headerTitle(h)))!;
const isOpen = (h: HTMLElement) => chevron(h).getAttribute('aria-label')!.startsWith('Collapse');
const runCommand = (id: string) => {
  const cmds = (hoisted.commands.get('agents') ?? []) as PaletteCommand[];
  const cmd = cmds.find((c) => c.id === id);
  expect(cmd, id).toBeTruthy();
  act(() => {
    cmd!.run();
  });
};

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY);
  hoisted.commands.clear();
  window.HTMLElement.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each(MODES)('AgentsView rail in grouping "$grouping" (#50)', ({ grouping, group }) => {
  const renderView = () => {
    hoisted.grouping = grouping;
    render(
      <MemoryRouter>
        <AgentsView active apps={[]} onExit={() => {}} nav={nav} onOpenView={() => {}} />
      </MemoryRouter>
    );
  };

  it('AC-4: palette groups.collapse / groups.expand collapse and expand every group', () => {
    renderView();
    expect(headers().length).toBeGreaterThan(1);
    runCommand('agents.groups.collapse');
    expect(headers().every((h) => !isOpen(h))).toBe(true);
    runCommand('agents.groups.expand');
    expect(headers().every(isOpen)).toBe(true);
  });

  it('keyboard: Space and Enter toggle the selected group header, Shift+Arrow moves it', () => {
    renderView();
    // Select the header (chevron twice: selected, state unchanged)
    fireEvent.click(chevron(header(group)));
    fireEvent.click(chevron(header(group)));
    expect(header(group).getAttribute('aria-selected')).toBe('true');
    expect(isOpen(header(group))).toBe(true);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: ' ' });
    expect(isOpen(header(group))).toBe(false);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Enter' });
    expect(isOpen(header(group))).toBe(true);

    const before = headers().map(headerTitle);
    const at = before.findIndex((t) => group.test(t));
    const key = at === 0 ? 'ArrowDown' : 'ArrowUp';
    fireEvent.keyDown(document.activeElement ?? document.body, { key, shiftKey: true });
    const after = headers().map(headerTitle);
    expect(after.findIndex((t) => group.test(t))).toBe(at === 0 ? 1 : at - 1);
  });
});
