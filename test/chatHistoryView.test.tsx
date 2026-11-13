import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ChatHistoryPage } from '../components/ChatHistoryView/ChatHistoryPage';
import {
  fetchChatConversation,
  fetchChatHistory,
  importChatExport,
  type ChatHistoryItem,
  type ChatHistoryList,
} from '../services/chatHistoryApi';
import { PROVIDER_HARNESS, continuePrompt, dayBound } from '../utils/chatHistory';

vi.mock('../services/chatHistoryApi', () => ({
  fetchChatHistory: vi.fn(),
  fetchChatConversation: vi.fn(),
  importChatExport: vi.fn(),
}));

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
  ...patch,
});

const list = (items: ChatHistoryItem[], patch: Partial<ChatHistoryList> = {}): ChatHistoryList => ({
  total: items.length,
  counts: { claude: 2, chatgpt: 1 },
  projects: [{ id: 'p1', name: 'Backstube', count: 1 }],
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchChatHistory).mockResolvedValue(list(ITEMS));
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

  it('AC-3: provider, project, topic and period go to the server as filters', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('Chat 3');
    await user.selectOptions(screen.getByLabelText('Provider'), 'chatgpt');
    await waitFor(() => expect(lastQuery()).toMatchObject({ provider: 'chatgpt' }));
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
  });

  it('searches as typed and shows the hit with its snippet', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('Chat 3');
    vi.mocked(fetchChatHistory).mockResolvedValue(list([item(7, { snippet: '…die Stockgare' })]));
    await user.type(screen.getByLabelText('Search chats'), 'stockgare');
    expect(await screen.findByText('…die Stockgare')).toBeInTheDocument();
    expect(lastQuery()).toMatchObject({ q: 'stockgare' });
  });

  it('AC-4: groups the list by topic', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('Chat 3');
    await user.click(screen.getByLabelText('Group by topic'));
    const bread = screen.getByRole('region', { name: 'brot' });
    expect(within(bread).getAllByRole('button')).toHaveLength(2);
    expect(
      within(screen.getByRole('region', { name: 'fahrrad' })).getByText('Chat 2')
    ).toBeInTheDocument();
  });

  it('opens a conversation as plain text and continues it as an Orkumo chat', async () => {
    const conversation = {
      ...ITEMS[1],
      messages: [
        { role: 'user' as const, text: 'Wie flicke ich <b>einen</b> Reifen?', at: null },
        { role: 'assistant' as const, text: 'Loch suchen.', at: null },
      ],
    };
    vi.mocked(fetchChatConversation).mockResolvedValue(conversation);
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: /Chat 2/ }));
    // markup in a message is shown, not rendered
    expect(await screen.findByText('Wie flicke ich <b>einen</b> Reifen?')).toBeInTheDocument();
    expect(fetchChatConversation).toHaveBeenCalledWith('chatgpt:2');
    await user.click(screen.getByRole('button', { name: /Continue in Orkumo/ }));
    const [path, state] = JSON.parse(screen.getByTestId('where').textContent!);
    expect(path).toBe('/agents');
    // a ChatGPT conversation continues on the ChatGPT subscription, i.e. Codex
    expect(state).toEqual({
      dispatch: continuePrompt(conversation),
      mode: 'chat',
      harness: 'codex',
    });
    expect(state.dispatch).toContain('ChatGPT: Loch suchen.');
  });

  it('imports a folder, reports the counts and reloads; errors are shown', async () => {
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
      counts: { claude: 3, chatgpt: 0 },
    });
    const user = userEvent.setup();
    show();
    await screen.findByText('Chat 3');
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

  it('explains where the exports come from while nothing is imported', async () => {
    vi.mocked(fetchChatHistory).mockResolvedValue(
      list([], { counts: { claude: 0, chatgpt: 0 }, projects: [], topics: [] })
    );
    show();
    expect(await screen.findByText(/Settings → Privacy → Export data/)).toBeInTheDocument();
  });

  it('keeps the end of a long conversation when continuing', () => {
    const prompt = continuePrompt({
      ...ITEMS[0],
      messages: [
        { role: 'user', text: `START ${'x'.repeat(30000)}`, at: null },
        { role: 'assistant', text: 'the END', at: null },
      ],
    });
    expect(prompt).not.toContain('START');
    expect(prompt).toContain('the END');
    expect(prompt.length).toBeLessThan(25000);
  });

  it('#251: continues each provider on the CLI of its subscription', () => {
    expect(PROVIDER_HARNESS).toEqual({ claude: 'claude', chatgpt: 'codex' });
  });
});
