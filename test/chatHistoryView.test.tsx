import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useState } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ChatHistoryPage } from '../components/ChatHistoryView/ChatHistoryPage';
import { RailOutletContext } from '../components/AgentsView/railOutlet';
import {
  fetchChatConversation,
  fetchChatHistory,
  importChatExport,
  updateChatMeta,
  type ChatHistoryConversation,
  type ChatHistoryItem,
  type ChatHistoryList,
} from '../services/chatHistoryApi';
import { uploadAgentFile } from '../services/agentsApi';
import {
  PROVIDER_HARNESS,
  continuePrompt,
  conversationMarkdown,
  conversationUrl,
  dayBound,
  markdownFileName,
  promptLimit,
  recencyOf,
  relativeTime,
} from '../utils/chatHistory';
import { DISPATCH_PROMPT_MAX, MAX_HARNESS_PROMPT } from '../config/limits.js';
import { openInSystemBrowser, openLink } from '../utils/links';
import type { ChatSyncResult, ChatSyncStatus, ElectronAPI } from '../electron/electron';

vi.mock('../services/chatHistoryApi', () => ({
  fetchChatHistory: vi.fn(),
  fetchChatConversation: vi.fn(),
  importChatExport: vi.fn(),
  updateChatMeta: vi.fn(),
}));
vi.mock('../services/agentsApi', () => ({ uploadAgentFile: vi.fn() }));
vi.mock('../utils/links', () => ({ openLink: vi.fn(), openInSystemBrowser: vi.fn() }));

const item = (n: number, patch: Partial<ChatHistoryItem> = {}): ChatHistoryItem => ({
  id: `claude:${n}`,
  provider: 'claude',
  title: `Chat ${n}`,
  createdAt: Date.parse('2026-01-01'),
  updatedAt: Date.parse('2026-01-01') + n * 86_400_000,
  project: null,
  projectName: null,
  topic: 'brot',
  messageCount: 2,
  snippet: `snippet ${n}`,
  pinned: false,
  folder: null,
  archived: false,
  ...patch,
});

const list = (items: ChatHistoryItem[], patch: Partial<ChatHistoryList> = {}): ChatHistoryList => ({
  total: items.length,
  counts: { claude: 2, chatgpt: 1, orkumo: 0 },
  projects: [{ id: 'p1', name: 'Backstube', count: 1 }],
  folders: [],
  topics: [
    { id: 'brot', name: 'brot', count: 2 },
    { id: 'fahrrad', name: 'fahrrad', count: 1 },
  ],
  items,
  tookMs: 1,
  ...patch,
});

const ITEMS = [
  item(3),
  item(2, { id: 'chatgpt:2', provider: 'chatgpt', topic: 'fahrrad', projectName: 'Backstube' }),
  item(1),
];

const Where = () => {
  const location = useLocation();
  return <output data-testid="where">{JSON.stringify([location.pathname, location.state])}</output>;
};
const show = () =>
  render(
    <MemoryRouter initialEntries={['/chats']}>
      <ChatHistoryPage />
      <Where />
    </MemoryRouter>
  );
const lastQuery = () => vi.mocked(fetchChatHistory).mock.lastCall![0];
/** jsdom's Blob has no text() */
const blobText = (blob: Blob) => {
  const { promise, resolve } = Promise.withResolvers<string>();
  const reader = new window.FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.readAsText(blob);
  return promise;
};

const status = (s: ChatSyncStatus['status'], extra: Partial<ChatSyncStatus> = {}) => ({
  status: s,
  added: 0,
  updated: 0,
  ...extra,
});

/** The preload's chatSync, driven by the test */
function mockElectron(result: ChatSyncResult) {
  let progress: ((p: ChatSyncStatus & { provider: 'claude' | 'chatgpt' }) => void) | null = null;
  let navigate: ((s: { url: string }) => void) | null = null;
  const run = vi.fn(() => Promise.resolve(result));
  window.electronAPI = {
    chatSync: {
      run,
      onProgress: (cb) => {
        progress = cb;
        return () => (progress = null);
      },
    },
    browserView: {
      onNavigate: (cb: (s: { url: string }) => void) => {
        navigate = cb;
        return () => (navigate = null);
      },
    },
  } as unknown as ElectronAPI;
  return {
    run,
    progress: (p: ChatSyncStatus & { provider: 'claude' | 'chatgpt' }) => act(() => progress?.(p)),
    navigate: (url: string) => act(() => navigate?.({ url })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchChatHistory).mockResolvedValue(list(ITEMS));
});
afterEach(() => {
  delete window.electronAPI;
});

describe('ChatHistoryPage (#280)', () => {
  it('lists both providers in the order the server gives (last activity) with counts', async () => {
    show();
    const rows = await screen.findAllByRole('button', { name: /Chat \d/ });
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('ClaudeChat 3'),
      expect.stringContaining('ChatGPTChat 2'),
      expect.stringContaining('ClaudeChat 1'),
    ]);
    expect(screen.getByTestId('chat-counts')).toHaveTextContent(
      '3 matching · Claude 2 · ChatGPT 1'
    );
  });

  it('groups the rail by recency: Today, Yesterday, This week, Older', async () => {
    const now = Date.now();
    vi.mocked(fetchChatHistory).mockResolvedValue(
      list([
        item(1, { title: 'Heute', updatedAt: now - 60_000 }),
        item(2, { title: 'Gestern', updatedAt: new Date(now).setHours(0, 0, 0, 0) - 3_600_000 }),
        item(3, { title: 'Vorhin diese Woche', updatedAt: now - 4 * 86_400_000 }),
        item(4, { title: 'Alt', updatedAt: now - 60 * 86_400_000 }),
      ])
    );
    show();
    await screen.findByText('Heute');
    for (const [label, title] of [
      ['Today', 'Heute'],
      ['Yesterday', 'Gestern'],
      ['This week', 'Vorhin diese Woche'],
      ['Older', 'Alt'],
    ])
      expect(within(screen.getByRole('region', { name: label })).getByText(title)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Today' })).getByText('1m')).toBeTruthy();
  });

  it('AC-3: provider, project, topic and period go to the server as filters', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('Chat 3');
    await user.click(within(screen.getByRole('group', { name: 'Provider' })).getByText('ChatGPT'));
    await waitFor(() => expect(lastQuery()).toMatchObject({ provider: 'chatgpt' }));
    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await user.selectOptions(screen.getByLabelText('Project'), 'p1');
    await user.selectOptions(screen.getByLabelText('Topic'), 'fahrrad');
    await user.type(screen.getByLabelText('Active from'), '2026-02-01');
    await user.type(screen.getByLabelText('Active until'), '2026-02-28');
    await waitFor(() =>
      expect(lastQuery()).toMatchObject({
        provider: 'chatgpt',
        project: 'p1',
        topic: 'fahrrad',
        from: dayBound('2026-02-01'),
        to: dayBound('2026-02-28', true),
      })
    );
    expect(dayBound('2026-02-28', true)! - dayBound('2026-02-28')!).toBe(86_400_000 - 1);
    expect(screen.getByLabelText('Topic')).toHaveTextContent('brot (2)');
    expect(screen.getByRole('button', { name: /Filters \(4\)/ })).toBeTruthy();
    await user.click(within(screen.getByRole('group', { name: 'Provider' })).getByText('All'));
    await waitFor(() => expect(lastQuery().provider).toBeNull());
  });

  it('searches as typed and shows the hit with its snippet', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('Chat 3');
    expect(screen.queryByText('snippet 3')).toBeNull();
    vi.mocked(fetchChatHistory).mockResolvedValue(list([item(7, { snippet: '…die Stockgare' })]));
    await user.type(screen.getByLabelText('Search chats'), 'stockgare');
    expect(await screen.findByText('…die Stockgare')).toBeInTheDocument();
    expect(lastQuery()).toMatchObject({ q: 'stockgare' });
  });

  it('AC-4: groups the list by topic', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('Chat 3');
    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await user.click(screen.getByLabelText('Group by topic'));
    const bread = screen.getByRole('region', { name: 'brot' });
    expect(within(bread).getAllByRole('button')).toHaveLength(2);
    expect(
      within(screen.getByRole('region', { name: 'fahrrad' })).getByText('Chat 2')
    ).toBeInTheDocument();
  });

  it('keyboard: ↓ from the search into the list, ↑/↓ between rows, Enter opens', async () => {
    vi.mocked(fetchChatConversation).mockImplementation((id) =>
      Promise.resolve({ ...ITEMS.find((i) => i.id === id)!, messages: [] })
    );
    const user = userEvent.setup();
    show();
    await screen.findByText('Chat 3');
    await user.click(screen.getByLabelText('Search chats'));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveTextContent('Chat 3');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toHaveTextContent('Chat 1');
    await user.keyboard('{ArrowUp}{Enter}');
    await waitFor(() => expect(fetchChatConversation).toHaveBeenCalledWith('chatgpt:2'));
    expect(await screen.findByRole('heading', { name: 'Chat 2' })).toBeInTheDocument();
  });

  it('reads a conversation (user cards, markdown answers), opens it on the web, continues it', async () => {
    const conversation = {
      ...ITEMS[1],
      messages: [
        { role: 'user' as const, text: 'Wie flicke ich <b>einen</b> Reifen?', at: null },
        { role: 'assistant' as const, text: 'Loch **suchen**.', at: null },
      ],
    };
    vi.mocked(fetchChatConversation).mockResolvedValue(conversation);
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Chat 2/ }));
    // markup in a user message is shown, not rendered; answers are markdown
    expect(await screen.findByText('Wie flicke ich <b>einen</b> Reifen?')).toBeInTheDocument();
    expect(screen.getByText('suchen').tagName).toBe('STRONG');
    expect(fetchChatConversation).toHaveBeenCalledWith('chatgpt:2');

    await user.click(screen.getByRole('button', { name: /Open on chatgpt.com/ }));
    expect(openInSystemBrowser).toHaveBeenCalledWith('https://chatgpt.com/c/2');

    vi.mocked(uploadAgentFile).mockResolvedValue('/data/agent-files/u/Chat-2.md');
    await user.click(screen.getByRole('button', { name: /Continue in Orkumo/ }));
    // the whole conversation goes along as a Markdown file (#19 AK-7)
    const uploaded = vi.mocked(uploadAgentFile).mock.calls[0][0];
    expect(uploaded.name).toBe('Chat-2.md');
    expect(await blobText(uploaded)).toBe(conversationMarkdown(conversation));
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId('where').textContent!)[0]).toBe('/agents')
    );
    const [, state] = JSON.parse(screen.getByTestId('where').textContent!);
    // a ChatGPT conversation continues on the ChatGPT subscription, i.e. Codex, in the chats folder
    expect(state).toEqual({
      dispatch: continuePrompt(conversation, MAX_HARNESS_PROMPT, '/data/agent-files/u/Chat-2.md'),
      mode: 'chat',
      harness: 'codex',
      place: 'chats',
    });
    expect(state.dispatch).toContain('[File: /data/agent-files/u/Chat-2.md]');
    expect(state.dispatch).toContain('ChatGPT: Loch **suchen**.');
  });

  it('web mode: imports a folder, reports the counts and reloads; errors are shown', async () => {
    vi.mocked(importChatExport).mockResolvedValue({
      files: [
        {
          file: 'conversations.json',
          provider: 'claude',
          found: 4,
          imported: 3,
          skipped: { 'no messages': 1 },
        },
      ],
      counts: { claude: 3, chatgpt: 0, orkumo: 0 },
    });
    const user = userEvent.setup();
    show();
    await screen.findByText('Chat 3');
    expect(screen.queryByLabelText('Sync status')).toBeNull();
    const calls = vi.mocked(fetchChatHistory).mock.calls.length;
    await user.type(screen.getByLabelText('Folder of the unpacked export'), '~/Downloads/export');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(
      await screen.findByText(
        'conversations.json (Claude): 3 of 4 imported, skipped: 1 no messages'
      )
    ).toBeInTheDocument();
    expect(importChatExport).toHaveBeenCalledWith('~/Downloads/export');
    await waitFor(() =>
      expect(vi.mocked(fetchChatHistory).mock.calls.length).toBeGreaterThan(calls)
    );

    vi.mocked(importChatExport).mockRejectedValue(new Error('Path not found'));
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Path not found');
  });

  it('web mode: explains where the exports come from while nothing is imported', async () => {
    vi.mocked(fetchChatHistory).mockResolvedValue(
      list([], { counts: { claude: 0, chatgpt: 0, orkumo: 0 }, projects: [], topics: [] })
    );
    show();
    expect(await screen.findByText(/Settings → Privacy → Export data/)).toBeInTheDocument();
  });

  it('desktop: syncs on opening, shows per-provider status, logs in through the built-in browser', async () => {
    const electron = mockElectron({
      claude: status('ok', { added: 2, syncedAt: Date.now() }),
      chatgpt: status('needs-login', { reason: 'Log in to chatgpt.com in the built-in browser' }),
    });
    const user = userEvent.setup();
    show();
    await screen.findByText('Chat 3');
    expect(electron.run).toHaveBeenCalledTimes(1);
    const chips = screen.getByLabelText('Sync status');
    expect(await within(chips).findByText(/Claude · Up to date/)).toBeTruthy();
    // the import is a secondary action now
    expect(screen.queryByLabelText('Folder of the unpacked export')).toBeNull();

    await user.click(within(chips).getByRole('button', { name: 'Log in to ChatGPT' }));
    expect(openLink).toHaveBeenCalledWith('https://chatgpt.com/auth/login', undefined, 'builtin');
    // still on the login page: no sync; landed on the start page: sync now
    electron.navigate('https://chatgpt.com/auth/login?next=1');
    expect(electron.run).toHaveBeenCalledTimes(1);
    electron.navigate('https://chatgpt.com/');
    await waitFor(() => expect(electron.run).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole('button', { name: 'More chat actions' }));
    await user.click(screen.getByRole('menuitem', { name: /Import a data export/ }));
    expect(screen.getByLabelText('Folder of the unpacked export')).toBeInTheDocument();
  });

  it('desktop: progress shows syncing, reloads the list as chats arrive, errors name the reason', async () => {
    const finished = Promise.withResolvers<ChatSyncResult>();
    const electron = mockElectron({} as ChatSyncResult);
    electron.run.mockImplementation(() => finished.promise);
    show();
    await screen.findByText('Chat 3');
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled();
    const loads = vi.mocked(fetchChatHistory).mock.calls.length;
    electron.progress({ provider: 'claude', ...status('syncing', { added: 10, pending: 30 }) });
    expect(await screen.findByText(/Claude · Syncing \(30 left\)/)).toBeTruthy();
    await waitFor(() =>
      expect(vi.mocked(fetchChatHistory).mock.calls.length).toBeGreaterThan(loads)
    );
    await act(async () =>
      finished.resolve({
        claude: status('ok', { added: 40 }),
        chatgpt: status('error', { reason: 'chatgpt.com answered HTTP 500' }),
      })
    );
    expect(await screen.findByText('ChatGPT: chatgpt.com answered HTTP 500')).toBeTruthy();
    expect(screen.getByText(/ChatGPT · Sync failed/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeEnabled();
  });

  it('desktop: tells what to do while nothing is synced yet', async () => {
    mockElectron({
      claude: status('needs-login'),
      chatgpt: status('needs-login'),
    });
    vi.mocked(fetchChatHistory).mockResolvedValue(
      list([], { counts: { claude: 0, chatgpt: 0, orkumo: 0 }, projects: [], topics: [] })
    );
    show();
    expect(await screen.findByText(/Log in to claude.ai or chatgpt.com/)).toBeInTheDocument();
    expect(screen.queryByText(/Settings → Privacy/)).toBeNull();
  });

  it('lists in the rail column the agents view hands over', async () => {
    const Host = () => {
      const [outlet, setOutlet] = useState<HTMLDivElement | null>(null);
      return (
        <MemoryRouter>
          <div data-testid="rail" ref={setOutlet} />
          <RailOutletContext.Provider value={outlet}>
            <ChatHistoryPage />
          </RailOutletContext.Provider>
        </MemoryRouter>
      );
    };
    const narrow = window.matchMedia;
    window.matchMedia = (query: string) =>
      ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }) as never;
    render(<Host />);
    window.matchMedia = narrow;
    const rail = screen.getByTestId('rail');
    expect(await within(rail).findByText('Chat 3')).toBeInTheDocument();
    expect(within(rail).getByLabelText('Search chats')).toBeInTheDocument();
  });

  it('#19 AK-7: continuing a long conversation stays under the start prompt limit', () => {
    const long: ChatHistoryConversation = {
      ...ITEMS[0],
      title: 'T'.repeat(500),
      messages: Array.from({ length: 60 }, (_, i) => ({
        role: i % 2 ? ('assistant' as const) : ('user' as const),
        text: `${i === 0 ? 'START ' : ''}${'x'.repeat(1000)}${i === 59 ? ' the END' : ''}`,
        at: null,
      })),
    };
    for (const harness of ['claude', 'codex'] as const) {
      const max = promptLimit(harness);
      for (const file of [null, '/data/agent-files/0f/T.md']) {
        const prompt = continuePrompt(long, max, file);
        // room is left for what the user adds before sending
        expect(prompt.length).toBeLessThanOrEqual(max - Math.min(2000, max / 5));
        expect(prompt).not.toContain('START');
        expect(prompt).toContain('the END');
        if (file) expect(prompt).toContain(`[File: ${file}]`);
      }
    }
    expect(promptLimit('claude')).toBe(DISPATCH_PROMPT_MAX);
    expect(promptLimit('omp')).toBe(MAX_HARNESS_PROMPT);
    // a short one goes whole
    const short = continuePrompt({ ...ITEMS[0], messages: [{ role: 'user', text: 'hi', at: null }] });
    expect(short).toContain('This is the conversation so far:\n\nUser: hi');
  });

  it('#19 AK-6: Markdown export with source, dates and every message', () => {
    const md = conversationMarkdown({
      ...ITEMS[0],
      title: 'Brot: Sauerteig?',
      messages: [
        { role: 'user', text: 'Wie?', at: Date.parse('2026-01-02T10:30:00Z') },
        { role: 'assistant', text: '```py\nprint(1)\n```', at: null },
      ],
    });
    expect(md).toBe(
      [
        '# Brot: Sauerteig?',
        '',
        '- Source: Claude',
        '- Started: 2026-01-01',
        '- Last activity: 2026-01-04',
        '- Link: https://claude.ai/chat/3',
        '',
        '---',
        '',
        '## User · 2026-01-02 10:30',
        '',
        'Wie?',
        '',
        '## Claude',
        '',
        '```py\nprint(1)\n```',
        '',
      ].join('\n')
    );
    expect(markdownFileName({ title: 'Brot: Sauerteig? / Teil 2' })).toBe('Brot-Sauerteig-Teil-2.md');
    expect(markdownFileName({ title: '???' })).toBe('chat.md');
  });

  it('#251: continues each provider on the CLI of its subscription', () => {
    expect(PROVIDER_HARNESS).toEqual({ claude: 'claude', chatgpt: 'codex' });
  });

  it('web links and rail times', () => {
    expect(conversationUrl({ id: 'claude:abc-1', provider: 'claude' })).toBe(
      'https://claude.ai/chat/abc-1'
    );
    const now = new Date(2026, 10, 13, 15, 0).getTime();
    expect(relativeTime(now - 30_000, now)).toBe('now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h');
    expect(recencyOf(new Date(2026, 10, 12, 23, 0).getTime(), now)).toBe('Yesterday');
    expect(recencyOf(new Date(2026, 10, 6, 1, 0).getTime(), now)).toBe('This week');
    expect(recencyOf(new Date(2026, 10, 5, 23, 0).getTime(), now)).toBe('Older');
    expect(recencyOf(null, now)).toBe('Older');
  });
});

describe('ChatHistoryPage: Orkumo chats, order, export (#19)', () => {
  const ORKUMO = item(9, {
    id: 'orkumo:claude:0f0f0f0f-0000-4000-8000-000000000009',
    provider: 'orkumo',
    title: 'Eigener Chat',
    harness: 'claude',
    sessionId: '0f0f0f0f-0000-4000-8000-000000000009',
    cwd: '/data/chats',
    pinned: true,
    folder: 'Arbeit',
  });
  const conversation = {
    ...ORKUMO,
    messages: [
      { role: 'user' as const, text: 'Hallo', at: null },
      { role: 'assistant' as const, text: 'Hi', at: null },
    ],
  };

  it('AK-1: "New chat" opens the chat composer in the chats folder, no project to pick', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('Chat 3');
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(JSON.parse(screen.getByTestId('where').textContent!)).toEqual([
      '/agents',
      { dispatch: '', mode: 'chat', place: 'chats' },
    ]);
  });

  it('AK-4: Orkumo chats are listed with their source, filterable, and open in Agents', async () => {
    vi.mocked(fetchChatHistory).mockResolvedValue(
      list([ORKUMO, ...ITEMS], { counts: { claude: 2, chatgpt: 1, orkumo: 1 } })
    );
    vi.mocked(fetchChatConversation).mockResolvedValue(conversation);
    const user = userEvent.setup();
    show();
    const row = await screen.findByRole('button', { name: /Eigener Chat/ });
    expect(row).toHaveTextContent('Orkumo');
    expect(within(row).getByLabelText('Pinned')).toBeTruthy();
    expect(row).toHaveTextContent('Arbeit');
    expect(screen.getByTestId('chat-counts')).toHaveTextContent(
      '4 matching · Claude 2 · ChatGPT 1 · Orkumo 1'
    );
    await user.click(within(screen.getByRole('group', { name: 'Provider' })).getByText('Orkumo'));
    await waitFor(() => expect(lastQuery()).toMatchObject({ provider: 'orkumo' }));

    await user.click(row);
    expect(await screen.findByRole('heading', { name: 'Eigener Chat' })).toBeInTheDocument();
    // no web page and no "continue": it is an Orkumo session already
    expect(screen.queryByRole('button', { name: /Open on/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Continue in Orkumo/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Open in Agents/ }));
    expect(JSON.parse(screen.getByTestId('where').textContent!)).toEqual([
      '/agents',
      {
        openChat: {
          harness: 'claude',
          sessionId: ORKUMO.sessionId,
          cwd: '/data/chats',
          title: 'Eigener Chat',
        },
      },
    ]);
  });

  it('AK-5: pin, rename, folder and archive go to the server; folder and archive filter', async () => {
    vi.mocked(fetchChatConversation).mockResolvedValue({ ...ITEMS[0], messages: [] });
    vi.mocked(updateChatMeta).mockImplementation((id, patch) =>
      Promise.resolve({
        ...ITEMS[0],
        ...(patch.title !== undefined && { title: patch.title ?? ITEMS[0].title }),
        ...(patch.pinned !== undefined && { pinned: patch.pinned }),
        ...(patch.folder !== undefined && { folder: patch.folder }),
        ...(patch.archived !== undefined && { archived: patch.archived }),
      })
    );
    vi.mocked(fetchChatHistory).mockResolvedValue(
      list(ITEMS, { folders: [{ id: 'Arbeit', name: 'Arbeit', count: 2 }] })
    );
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Chat 3/ }));
    await screen.findByRole('heading', { name: 'Chat 3' });
    const loads = vi.mocked(fetchChatHistory).mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Pin' }));
    expect(updateChatMeta).toHaveBeenLastCalledWith('claude:3', { pinned: true });
    expect(await screen.findByRole('button', { name: 'Unpin' })).toBeInTheDocument();
    // the list follows
    await waitFor(() => expect(vi.mocked(fetchChatHistory).mock.calls.length).toBeGreaterThan(loads));

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const title = screen.getByLabelText('Chat title');
    await user.clear(title);
    await user.type(title, 'Steuern 2026{Enter}');
    expect(updateChatMeta).toHaveBeenLastCalledWith('claude:3', { title: 'Steuern 2026' });
    expect(await screen.findByRole('heading', { name: 'Steuern 2026' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Move to folder' }));
    await user.type(screen.getByLabelText('Folder'), 'Arbeit{Enter}');
    expect(updateChatMeta).toHaveBeenLastCalledWith('claude:3', { folder: 'Arbeit' });

    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(updateChatMeta).toHaveBeenLastCalledWith('claude:3', { archived: true });
    expect(await screen.findByRole('button', { name: 'Unarchive' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Folder' }), 'Arbeit');
    await user.click(screen.getByLabelText('Archived only'));
    await waitFor(() => expect(lastQuery()).toMatchObject({ folder: 'Arbeit', archived: true }));
  });

  it('AK-6: exports the open conversation as a Markdown download', async () => {
    vi.mocked(fetchChatConversation).mockResolvedValue(conversation);
    vi.mocked(fetchChatHistory).mockResolvedValue(list([ORKUMO]));
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:md';
    });
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    let downloaded: { href: string; download: string } | null = null;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloaded = { href: this.href, download: this.download };
      });
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Eigener Chat/ }));
    await user.click(await screen.findByRole('button', { name: 'Export as Markdown' }));
    expect(downloaded).toEqual({ href: 'blob:md', download: 'Eigener-Chat.md' });
    const text = await blobText(blobs[0]);
    expect(text).toBe(conversationMarkdown(conversation));
    expect(text).toContain('- Source: Orkumo (claude)');
    click.mockRestore();
  });
});
