import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AgentsView } from '../components/AgentsView/AgentsView';
import { STORAGE_KEY as RAIL_KEY } from '../hooks/useRailPreferences';
import { STORAGE_KEY as WORKSPACE_KEY } from '../hooks/useAgentWorkspace';
import { summarizeSessions } from '../utils/agentSessions';
import { DEFAULT_AGENT_VIEW_SETTINGS, type AgentSession } from '../types';

// #19 AK-1 / AK-2: "New chat" from /chats runs in the chats folder, with a model per chat

const CHATS = '/data/chats';
// stable values across renders, as the real hook keeps them
const hoisted = vi.hoisted(() => ({
  model: null as string | null,
  sessions: [] as AgentSession[],
  settings: null as object | null,
}));

vi.mock('../hooks/useAgentSessions', () => ({
  useAgentSessions: () => {
    hoisted.settings ??= {
      ...DEFAULT_AGENT_VIEW_SETTINGS,
      dispatch: { ...DEFAULT_AGENT_VIEW_SETTINGS.dispatch, harness: 'claude', model: hoisted.model },
    };
    return {
      sessions: hoisted.sessions,
      daemon: null,
      userSettings: null,
      cliInstalled: true,
      capabilities: null,
      settings: hoisted.settings,
      updateSettings: () => {},
      loading: false,
      error: null,
      connected: true,
      counts: summarizeSessions(hoisted.sessions),
      lastCompleted: null,
      refresh: () => {},
    };
  },
}));
vi.mock('../hooks/useAgentContexts', () => ({ useAgentContexts: () => ({}) }));
vi.mock('../components/CommandPalette', async (orig) => ({
  ...(await orig<object>()),
  useCommandPalette: () => ({ register: () => () => {}, open: () => {}, close: () => {} }),
  useRegisterCommands: () => {},
}));
// the pane shows what it would start: command, args and folder
vi.mock('../components/AgentsView/AgentTerminal', async (orig) => ({
  ...(await orig<object>()),
  AgentTerminal: ({ session }: { session: AgentSession }) => (
    <div
      data-agent-pane={session.id}
      data-command={session.ptyCommand ?? 'claude'}
      data-args={JSON.stringify(session.ptyArgs ?? [])}
      data-cwd={session.cwd}
    />
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

let dispatched: Record<string, unknown>[] = [];

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const showAgents = (state: object) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: '/agents', state }]}>
      <AgentsView active apps={[]} onExit={() => {}} nav={nav} onOpenView={() => {}} />
    </MemoryRouter>
  );
const openNewChat = () => showAgents({ dispatch: '', mode: 'chat', place: 'chats' });

beforeEach(() => {
  localStorage.removeItem(RAIL_KEY);
  localStorage.removeItem(WORKSPACE_KEY);
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.scrollTo = () => {};
  hoisted.model = null;
  hoisted.settings = null;
  dispatched = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      // the discovery data, where the chats folder comes from
      if (String(url).includes('/agents/repos'))
        return json({ cwd: '/p', repos: [], home: '/home/dev', chats: CHATS });
      if (String(url).includes('/agents/subagents')) return json({ agents: [] });
      if (String(url).includes('/agents/commands')) return json({ commands: [] });
      if (String(url).includes('/agents/dispatch')) {
        dispatched.push(JSON.parse(String(init?.body)));
        return json({ id: 'job-1', name: 'chat', alreadyRunning: false, output: '' }, 201);
      }
      return new Promise<Response>(() => {});
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const dialog = async () => screen.findByRole('dialog', { name: 'New chat' });

describe('New chat without a project (#19)', () => {
  it('AK-1: opens the chat composer in the chats folder and sends the first prompt there', async () => {
    openNewChat();
    const composer = await dialog();
    expect(within(composer).getByText(CHATS)).toBeInTheDocument();
    fireEvent.change(within(composer).getByLabelText('Task description'), {
      target: { value: 'Was ist Sauerteig?' },
    });
    fireEvent.click(within(composer).getByRole('button', { name: /Start chat/ }));
    await waitFor(() => expect(dispatched).toHaveLength(1));
    expect(dispatched[0]).toMatchObject({ prompt: 'Was ist Sauerteig?', cwd: CHATS, idle: true });
  });

  it('AK-2: the model picked for the chat goes along; empty keeps the global default', async () => {
    hoisted.model = 'sonnet';
    openNewChat();
    const composer = await dialog();
    const model = within(composer).getByRole('combobox', { name: 'Model' });
    expect(model).toHaveAttribute('placeholder', 'default (sonnet)');
    const options = [...document.querySelectorAll('#model-suggestions-claude option')].map((o) =>
      o.getAttribute('value')
    );
    expect(options).toEqual(['opus', 'sonnet', 'haiku']);
    fireEvent.change(within(composer).getByLabelText('Task description'), {
      target: { value: 'Hallo' },
    });
    fireEvent.change(model, { target: { value: 'opus' } });
    fireEvent.click(within(composer).getByRole('button', { name: /Start chat/ }));
    await waitFor(() => expect(dispatched).toHaveLength(1));
    expect(dispatched[0]).toMatchObject({ prompt: 'Hallo', cwd: CHATS, model: 'opus' });

    cleanup();
    dispatched = [];
    openNewChat();
    const again = await dialog();
    fireEvent.change(within(again).getByLabelText('Task description'), {
      target: { value: 'Hallo' },
    });
    fireEvent.click(within(again).getByRole('button', { name: /Start chat/ }));
    await waitFor(() => expect(dispatched).toHaveLength(1));
    // the dispatch defaults (settings.dispatch) carry the global model
    expect(dispatched[0]).toMatchObject({ model: 'sonnet', cwd: CHATS });
  });

  it('AK-2: Codex gets --model before its first message, in the chats folder', async () => {
    openNewChat();
    const composer = await dialog();
    fireEvent.change(within(composer).getByRole('combobox', { name: /Harness/ }), {
      target: { value: 'codex' },
    });
    const model = within(composer).getByRole('combobox', { name: 'Model' });
    expect(model).toHaveAttribute('placeholder', 'default');
    fireEvent.change(model, { target: { value: 'gpt-5-codex' } });
    fireEvent.change(within(composer).getByLabelText('Task description'), {
      target: { value: 'Hallo' },
    });
    fireEvent.click(within(composer).getByRole('button', { name: /Start chat/ }));
    const pane = await waitFor(() => {
      const el = document.querySelector('[data-command="codex"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(JSON.parse(pane.getAttribute('data-args')!)).toEqual([
      '--model',
      'gpt-5-codex',
      '--',
      'Hallo',
    ]);
    expect(pane.getAttribute('data-cwd')).toBe(CHATS);
    expect(dispatched).toHaveLength(0);
  });
});

describe('Open an Orkumo chat from /chats (#19 AK-4)', () => {
  const id = '0f0f0f0f-0000-4000-8000-000000000009';

  it('a Claude chat no pane runs resumes in its folder, in the UI view', async () => {
    showAgents({ openChat: { harness: 'claude', sessionId: id, cwd: CHATS, title: 'Brot' } });
    await waitFor(() => expect(dispatched).toHaveLength(1));
    expect(dispatched[0]).toMatchObject({ resume: id, cwd: CHATS });
  });

  it('a Codex chat resumes in a terminal pane with its own resume form', async () => {
    showAgents({ openChat: { harness: 'codex', sessionId: id, cwd: CHATS, title: 'Steuer' } });
    const pane = await waitFor(() => {
      const el = document.querySelector('[data-command="codex"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(JSON.parse(pane.getAttribute('data-args')!)).toEqual(['resume', id]);
    expect(pane.getAttribute('data-cwd')).toBe(CHATS);
  });
});
