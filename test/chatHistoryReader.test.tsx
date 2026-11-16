import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ChatHistoryPage } from '../components/ChatHistoryView/ChatHistoryPage';
import { CHAT_TABS_KEY } from '../components/ChatHistoryView/useChatTabs';
import {
  fetchChatConversation,
  fetchChatHistory,
  type ChatHistoryConversation,
  type ChatHistoryItem,
} from '../services/chatHistoryApi';
import { parseAs } from '../server/services/chatHistoryService.js';
import { findChatView, typeIntoPage, typeScript } from '../electron/chatPrompt.js';
import { openInSystemBrowser } from '../utils/links';
import type { ElectronAPI } from '../electron/electron';

vi.mock('../services/chatHistoryApi', () => ({
  fetchChatHistory: vi.fn(),
  fetchChatConversation: vi.fn(),
  importChatExport: vi.fn(),
  updateChatMeta: vi.fn(),
}));
vi.mock('../services/agentsApi', () => ({ uploadAgentFile: vi.fn() }));
vi.mock('../utils/links', () => ({ openLink: vi.fn(), openInSystemBrowser: vi.fn() }));

// Invented chats in the shape of the providers' web API (test/fixtures/chat-api), parsed by the server
const fixture = (provider: 'claude' | 'chatgpt', file: string): ChatHistoryConversation => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/chat-api', file), 'utf8'));
  const parsed = parseAs(provider, [raw]).conversations[0];
  return { ...item(parsed.id, provider, parsed.title), messages: parsed.messages };
};
const item = (id: string, provider: 'claude' | 'chatgpt', title: string): ChatHistoryItem => ({
  id,
  provider,
  title,
  createdAt: Date.parse('2026-01-01'),
  updatedAt: Date.parse('2026-01-02'),
  project: null,
  projectName: null,
  topic: null,
  messageCount: 4,
  snippet: '',
  pinned: false,
  folder: null,
  archived: false,
});

const CLAUDE = fixture('claude', 'claude-artifacts.json');
const CHATGPT = fixture('chatgpt', 'chatgpt-canvas.json');
const CHATS = [CLAUDE, CHATGPT];

const show = () =>
  render(
    <MemoryRouter initialEntries={['/chats']}>
      <ChatHistoryPage />
    </MemoryRouter>
  );
const openChat = async (user: ReturnType<typeof userEvent.setup>, title: string) => {
  const list = await screen.findByLabelText('Chat list');
  await user.click(await within(list).findByRole('button', { name: new RegExp(title) }));
  return screen.findByTestId(`reader-${CHATS.find((c) => c.title === title)!.id}`);
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  vi.mocked(fetchChatHistory).mockResolvedValue({
    total: 2,
    counts: { claude: 1, chatgpt: 1, orkumo: 0 },
    projects: [],
    folders: [],
    topics: [],
    items: CHATS.map((c) => ({ ...c, snippet: '' })),
    tookMs: 1,
  });
  vi.mocked(fetchChatConversation).mockImplementation((id) =>
    Promise.resolve(CHATS.find((c) => c.id === id)!)
  );
});
afterEach(() => {
  delete window.electronAPI;
});

describe('chat view: artifacts, files, tools, sources in place', () => {
  it('claude.ai: uploads, thinking, artifacts that open in place, code results, sources', async () => {
    const asset = vi.fn(() => Promise.resolve('data:image/png;base64,AAAA'));
    window.electronAPI = {
      chatSync: { run: vi.fn(() => new Promise(() => {})), onProgress: () => () => {}, asset },
    } as unknown as ElectronAPI;
    const user = userEvent.setup();
    show();
    const pane = await openChat(user, CLAUDE.title);
    const reader = within(pane);
    // uploaded file with the text the provider extracted from it
    const file = await reader.findByRole('button', { name: /auftraege\.csv/ });
    await user.click(file);
    expect(reader.getByText(/Meyer;Gazelle;Kette/)).toBeInTheDocument();
    // the uploaded image comes through the main process (login stays there)
    expect(await reader.findByRole('img', { name: 'werkstatt.png' })).toHaveAttribute(
      'src',
      'data:image/png;base64,AAAA'
    );
    expect(asset).toHaveBeenCalledWith('claude', '/api/org-1/files/img-1/preview');
    // thinking stays folded
    expect(reader.getAllByRole('button', { name: /Thinking/ })[0]).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    // the web page artifact runs sandboxed, without access to Orkumo's origin
    const page = reader
      .getAllByRole('button', { name: /Open$/ })
      .find((b) => b.textContent?.includes('Web page'))!;
    await user.click(page);
    const frame = pane.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    // an updated artifact shows its version
    expect(reader.getByText(/Document · version 2/)).toBeInTheDocument();
    // code run with its result
    await user.click(reader.getByRole('button', { name: /repl/ }));
    expect(reader.getByText('75')).toBeInTheDocument();
    expect(reader.getAllByRole('link').map((a) => a.getAttribute('href'))).toContain(
      'https://example.org/bremse'
    );
  });

  it('ChatGPT: canvas, attachments, python output, generated image; no javascript: links', async () => {
    const user = userEvent.setup();
    show();
    const reader = within(await openChat(user, CHATGPT.title));
    // the canvas in its first and its updated version, each where it happened
    await reader.findByRole('heading', { name: CHATGPT.title });
    expect(reader.getByText('Document')).toBeInTheDocument();
    expect(reader.getByText('Document · version 2')).toBeInTheDocument();
    // attachments: a file and an image (named placeholder without the desktop app)
    expect(reader.getByRole('button', { name: /preise\.pdf/ })).toBeInTheDocument();
    expect(reader.getByText('rad.jpg')).toBeInTheDocument();
    await user.click(reader.getByRole('button', { name: /^Code/ }));
    expect(reader.getByText('64')).toBeInTheDocument();
    for (const link of reader.queryAllByRole('link'))
      expect(link.getAttribute('href')).toMatch(/^https?:/);
  });
});

describe('chat view: header, scroll, tabs, composer', () => {
  it('header stays on top and the chat opens at its end', async () => {
    const user = userEvent.setup();
    const heights = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(5000);
    show();
    const reader = await openChat(user, CLAUDE.title);
    await within(reader).findByRole('heading', { name: CLAUDE.title });
    expect(reader.querySelector('[data-chat-header]')!.className).toMatch(/sticky top-0/);
    const scroller = reader.querySelector('[data-chat-header]')!.parentElement!.parentElement!;
    expect(scroller.scrollTop).toBe(5000);
    heights.mockRestore();
  });

  it('every chat opens in its own tab; tabs persist', async () => {
    const user = userEvent.setup();
    const { unmount } = show();
    await openChat(user, CLAUDE.title);
    await openChat(user, CHATGPT.title);
    const strip = screen.getByRole('tablist');
    expect(
      within(strip)
        .getAllByRole('tab')
        .map((t) => t.textContent)
    ).toEqual([expect.stringContaining(CLAUDE.title), expect.stringContaining(CHATGPT.title)]);
    // opening an open chat focuses its tab instead of a second one
    await openChat(user, CLAUDE.title);
    expect(within(strip).getAllByRole('tab')).toHaveLength(2);
    expect(within(strip).getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
    expect(JSON.parse(localStorage.getItem(CHAT_TABS_KEY)!).workspace.tabs).toHaveLength(2);
    unmount();
    show();
    expect(await screen.findAllByRole('tab')).toHaveLength(2);
  });

  it('two chats side by side in one tab (same tiling as agent panes)', async () => {
    localStorage.setItem(
      CHAT_TABS_KEY,
      JSON.stringify({
        workspace: {
          tabs: [
            {
              id: 't1',
              root: {
                id: 's1',
                dir: 'row',
                children: [
                  { id: 's2', pane: `history:${CLAUDE.id}` },
                  { id: 's3', pane: `history:${CHATGPT.id}` },
                ],
              },
              panes: [`history:${CLAUDE.id}`, `history:${CHATGPT.id}`],
              layout: 'columns',
              activeSessionId: `history:${CLAUDE.id}`,
            },
          ],
          activeTabId: 't1',
        },
        titles: { [CLAUDE.id]: CLAUDE.title, [CHATGPT.id]: CHATGPT.title },
      })
    );
    show();
    expect(await screen.findByTestId(`reader-${CLAUDE.id}`)).toBeInTheDocument();
    expect(await screen.findByTestId(`reader-${CHATGPT.id}`)).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    // no terminal (and so no process) for a chat pane
    expect(document.querySelector('.xterm')).toBeNull();
    expect(screen.getByRole('group', { name: 'Pane layout' })).toBeInTheDocument();
  });

  it('composer sends into the provider page of this chat and syncs the answer', async () => {
    const typePrompt = vi.fn(() => Promise.resolve('sent' as const));
    window.electronAPI = {
      chatSync: { run: vi.fn(() => new Promise(() => {})), onProgress: () => () => {}, typePrompt },
      browserView: { onNavigate: () => () => {} },
    } as unknown as ElectronAPI;
    const user = userEvent.setup();
    show();
    const reader = within(await openChat(user, CLAUDE.title));
    const input = await reader.findByRole('textbox', { name: 'Message' });
    await user.type(input, 'Und am Samstag?{Enter}');
    await waitFor(() =>
      expect(typePrompt).toHaveBeenCalledWith('claude', CLAUDE.id.slice(7), 'Und am Samstag?')
    );
    expect(await reader.findByText(/^Sent\./)).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('web app: the prompt goes to the clipboard and the chat opens on the site', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    // after setup: user-event brings its own clipboard
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    show();
    const reader = within(await openChat(user, CHATGPT.title));
    await user.type(await reader.findByRole('textbox', { name: 'Message' }), 'Danke{Enter}');
    expect(writeText).toHaveBeenCalledWith('Danke');
    expect(openInSystemBrowser).toHaveBeenCalledWith(
      `https://chatgpt.com/c/${CHATGPT.id.slice(8)}`
    );
  });
});

describe('chatPrompt.js (types into the provider page)', () => {
  it('finds the browser view that shows exactly this conversation', () => {
    const views = [
      { url: 'https://claude.ai/chat/other', target: 'a' },
      { url: 'https://evil.example/chat/abc', target: 'b' },
      { url: 'https://claude.ai/chat/abc', target: 'c' },
      { url: '', target: 'd' },
    ];
    expect(findChatView(views, 'claude', 'abc')).toBe('c');
    expect(findChatView(views, 'chatgpt', 'abc')).toBeNull();
    expect(findChatView(views, 'claude', '../x')).toBeNull();
  });

  it('textarea page: types and presses send', async () => {
    document.body.innerHTML =
      '<textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button>';
    const click = vi.fn();
    document.querySelector('button')!.addEventListener('click', click);
    const input = vi.fn();
    document.querySelector('textarea')!.addEventListener('input', input);
    await expect(typeIntoPage('Hallo "du"', true)).resolves.toBe('sent');
    expect(document.querySelector('textarea')!.value).toBe('Hallo "du"');
    expect(input).toHaveBeenCalled();
    expect(click).toHaveBeenCalledOnce();
  });

  it('editor page: types; a send button that stays disabled leaves it typed', async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<div class="ProseMirror" contenteditable="true"></div><button aria-label="Send message" disabled></button>';
    const result = typeIntoPage('Zeile', true);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBe('typed');
    expect(document.querySelector('.ProseMirror')!.textContent).toBe('Zeile');
    vi.useRealTimers();
  });

  it('no prompt field: nothing typed', async () => {
    document.body.innerHTML = '<p>Log in</p>';
    await expect(typeIntoPage('x', true)).resolves.toBe('no-field');
  });

  it('the script carries the text as a JSON literal, never as code', () => {
    const script = typeScript('"); alert(1); ("', true);
    expect(script.endsWith(`(${JSON.stringify('"); alert(1); ("')}, true)`)).toBe(true);
  });
});
