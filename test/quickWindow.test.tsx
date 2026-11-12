import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickWindow } from '../components/QuickWindow';
import {
  fetchAgentRepos,
  fetchAgentViewSettings,
  sendChatMessage,
  startChat,
  stopChat,
  subscribeToChat,
  type ChatSummary,
} from '../services/agentsApi';
import { DEFAULT_AGENT_VIEW_SETTINGS } from '../types';

vi.mock('../services/agentsApi', () => ({
  fetchAgentRepos: vi.fn(),
  fetchAgentViewSettings: vi.fn(),
  sendChatMessage: vi.fn(),
  startChat: vi.fn(),
  stopChat: vi.fn(),
  subscribeToChat: vi.fn(),
}));

const api = {
  quickSubmit: vi.fn(),
  quickHide: vi.fn(),
  quickExpand: vi.fn(),
  quickOpenChat: vi.fn(),
};
let emit: (event: unknown) => void = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  vi.mocked(fetchAgentViewSettings).mockResolvedValue({
    ...DEFAULT_AGENT_VIEW_SETTINGS,
    dispatch: { ...DEFAULT_AGENT_VIEW_SETTINGS.dispatch, harness: 'codex' },
  });
  vi.mocked(fetchAgentRepos).mockResolvedValue({ cwd: '/repo', repos: [], home: '/home/me' });
  vi.mocked(startChat).mockResolvedValue({ id: 'chat-1' } as ChatSummary);
  vi.mocked(sendChatMessage).mockResolvedValue({ id: 'chat-1' } as ChatSummary);
  vi.mocked(stopChat).mockResolvedValue({ stopped: true });
  vi.mocked(subscribeToChat).mockImplementation((_id, handlers) => {
    handlers.onOpen();
    emit = handlers.onEvent;
    return () => {};
  });
});

afterEach(() => {
  (window as unknown as { electronAPI?: unknown }).electronAPI = undefined;
});

const answer = (text: string) =>
  act(() => emit({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text }] } }));

describe('QuickWindow (#251)', () => {
  it('small → chat with streamed answer → follow-up in the same chat → Escape resets', async () => {
    const user = userEvent.setup();
    render(<QuickWindow />);
    const input = screen.getByLabelText('Quick prompt');
    expect(screen.queryByLabelText('Answer')).toBeNull();

    await user.type(input, 'Was ist 2+2?{Enter}');
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith('chat-1', 'Was ist 2+2?'));
    // default harness, home folder, no Claude-only options for Codex
    expect(startChat).toHaveBeenCalledWith({
      harness: 'codex',
      cwd: '/home/me',
      name: 'Quick chat',
    });
    expect(api.quickExpand).toHaveBeenCalledWith(true);
    expect(api.quickSubmit).not.toHaveBeenCalled();

    await answer('**Vier**');
    // markdown through ChatMarkdown
    expect((await screen.findByText('Vier')).tagName).toBe('STRONG');

    await user.type(input, 'Und 3+3?{Enter}');
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith('chat-1', 'Und 3+3?'));
    expect(startChat).toHaveBeenCalledTimes(1);

    await user.type(input, '{Escape}');
    expect(api.quickHide).toHaveBeenCalled();
    expect(api.quickExpand).toHaveBeenLastCalledWith(false);
    expect(stopChat).toHaveBeenCalledWith('chat-1');
    expect(screen.queryByLabelText('Answer')).toBeNull();
    expect(input).toHaveValue('');
  });

  it('hands the running chat to the main window without ending it (Cmd+Enter)', async () => {
    const user = userEvent.setup();
    render(<QuickWindow />);
    await user.type(screen.getByLabelText('Quick prompt'), 'Hallo{Enter}');
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalled());
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(api.quickOpenChat).toHaveBeenCalledWith('chat-1');
    expect(stopChat).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Answer')).toBeNull();
  });

  it('falls back to the main window composer when the chat cannot start', async () => {
    vi.mocked(startChat).mockRejectedValue(new Error('harness missing'));
    const user = userEvent.setup();
    render(<QuickWindow />);
    await user.type(screen.getByLabelText('Quick prompt'), 'Hallo{Enter}');
    await waitFor(() => expect(api.quickSubmit).toHaveBeenCalledWith('Hallo'));
    expect(api.quickExpand).not.toHaveBeenCalledWith(true);
  });

  it('ends a chat that finishes starting after the window was hidden', async () => {
    let started: (chat: ChatSummary) => void = () => {};
    vi.mocked(startChat).mockReturnValue(new Promise((r) => (started = r)));
    const user = userEvent.setup();
    render(<QuickWindow />);
    await user.type(screen.getByLabelText('Quick prompt'), 'Hallo{Enter}');
    await waitFor(() => expect(startChat).toHaveBeenCalled());
    await user.keyboard('{Escape}');
    await act(async () => started({ id: 'chat-1' } as ChatSummary));
    expect(stopChat).toHaveBeenCalledWith('chat-1');
    expect(api.quickExpand).not.toHaveBeenCalledWith(true);
    expect(sendChatMessage).not.toHaveBeenCalled();
    expect(api.quickSubmit).not.toHaveBeenCalled();
  });
});
