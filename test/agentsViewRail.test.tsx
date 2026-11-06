import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
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
  onOpenContextDashboard: () => {},
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

// #200: hot locators skip role/name resolution; it runs jsdom getComputedStyle on every element and
// ancestor and made these tests ~10x slower under CPU load, past the 5 s timeout
const headers = () =>
  screen
    .getAllByRole('option', { hidden: true })
    .filter((el) => el.getAttribute('draggable') === 'true');
const chevron = (h: HTMLElement) =>
  h.querySelector<HTMLElement>('button[aria-label^="Expand "], button[aria-label^="Collapse "]')!;
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
  window.HTMLElement.prototype.scrollTo = () => {};
  // Never settles: board/repo loaders keep their empty state, async tests (user-event) stay stable
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {}))
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
  // #164: real focus via user-event; the chevron is a <button>, which the global handler used to skip
  const selectedTitle = () => {
    const sel = screen
      .getAllByRole('option')
      .find((o) => o.getAttribute('aria-selected') === 'true');
    return sel
      ? (within(sel)
          .queryByRole('button', { name: /^(Expand|Collapse) / })
          ?.getAttribute('aria-label') ?? sel.textContent)
      : null;
  };

  it('#164 AC-1: arrow keys move the selection after a click on a group chevron', async () => {
    const user = userEvent.setup();
    renderView();
    const first = headers()[0];
    await user.click(chevron(first));
    await user.click(chevron(first)); // reopen, keep selected
    expect(document.activeElement).toBe(chevron(headers()[0]));
    const start = selectedTitle();
    await user.keyboard('{ArrowDown}');
    const moved = selectedTitle();
    expect(moved).not.toBe(start);
    await user.keyboard('{ArrowUp}');
    expect(selectedTitle()).toBe(start);
  });

  it('#164 AC-2: Tab onto the chevron, Space/Enter toggle once, then ArrowDown moves the selection', async () => {
    const user = userEvent.setup();
    renderView();
    const target = chevron(header(group));
    // Tab from the element right before the chevron in DOM order
    const focusables = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])'
      )
    );
    focusables[focusables.indexOf(target) - 1].focus();
    await user.tab();
    expect(document.activeElement).toBe(target);
    expect(isOpen(header(group))).toBe(true);
    await user.keyboard(' ');
    expect(isOpen(header(group))).toBe(false);
    await user.keyboard('{Enter}');
    expect(isOpen(header(group))).toBe(true);
    expect(header(group).getAttribute('aria-selected')).toBe('true');
    const start = selectedTitle();
    await user.keyboard('{ArrowDown}');
    expect(selectedTitle()).not.toBe(start);
    // Space now acts on the new selection, not on the chevron that had focus
    await user.keyboard(' ');
    expect(isOpen(header(group))).toBe(true);
    expect(chevron(header(group)).getAttribute('aria-expanded')).toBe('true');
  });

  it('#164 AC-3: with the context menu open, ArrowDown moves menu focus, not the rail selection', async () => {
    const user = userEvent.setup();
    renderView();
    const h = header(group);
    await user.click(chevron(h));
    await user.click(chevron(h));
    const start = selectedTitle();
    fireEvent.contextMenu(h);
    const menu = screen.getByRole('menu');
    const items = within(menu)
      .getAllByRole('menuitem')
      .filter((b) => !(b as HTMLButtonElement).disabled);
    items[0].focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(items[1 % items.length]);
    expect(selectedTitle()).toBe(start);
  });

  it('#164 AC-3: Alt+Arrow on a focused chevron moves the group, the selection stays on it', async () => {
    const user = userEvent.setup();
    renderView();
    const h = header(group);
    await user.click(chevron(h));
    await user.click(chevron(h));
    const before = headers().map(headerTitle);
    const at = before.findIndex((t) => group.test(t));
    await user.keyboard(at === 0 ? '{Alt>}{ArrowDown}{/Alt}' : '{Alt>}{ArrowUp}{/Alt}');
    const after = headers().map(headerTitle);
    expect(after.findIndex((t) => group.test(t))).toBe(at === 0 ? 1 : at - 1);
    expect(header(group).getAttribute('aria-selected')).toBe('true');
  });
});
