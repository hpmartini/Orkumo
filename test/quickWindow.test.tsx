import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickWindow } from '../components/QuickWindow';
import {
  openTranscriptView,
  sendToPane,
  startQuickAgent,
  stopPane,
  subscribeToChat,
  type ChatSummary,
  type QuickAgent,
} from '../services/agentsApi';

vi.mock('../services/agentsApi', () => ({
  openTranscriptView: vi.fn(),
  sendToPane: vi.fn(),
  startQuickAgent: vi.fn(),
  stopPane: vi.fn(),
  subscribeToChat: vi.fn(),
}));

const api = {
  quickSubmit: vi.fn(),
  quickHide: vi.fn(),
  quickExpand: vi.fn(),
  quickOpenChat: vi.fn(),
};
let emit: (event: unknown) => void = () => {};
const agent: QuickAgent = {
  paneId: 'quick-1',
  harness: 'omp',
  sessionId: '01a1c095-7edd-72eb-9c97-4afdcd01f56e',
  cwd: '/home/me',
};

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  vi.mocked(startQuickAgent).mockResolvedValue(agent);
  vi.mocked(openTranscriptView).mockResolvedValue({ id: 'view-1' } as ChatSummary);
  vi.mocked(sendToPane).mockResolvedValue({ delivered: true });
  vi.mocked(stopPane).mockResolvedValue({ stopped: 1 });
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
  it('starts an agent with the prompt, shows its transcript, types follow-ups, Escape stops it', async () => {
    const user = userEvent.setup();
    render(<QuickWindow />);
    const input = screen.getByLabelText('Quick prompt');
    expect(screen.queryByLabelText('Answer')).toBeNull();

    await user.type(input, 'Was ist 2+2?{Enter}');
    await waitFor(() => expect(api.quickExpand).toHaveBeenCalledWith(true));
    expect(startQuickAgent).toHaveBeenCalledWith('Was ist 2+2?');
    expect(openTranscriptView).toHaveBeenCalledWith('quick-1', { ...agent, name: 'Quick chat' });
    expect(subscribeToChat).toHaveBeenCalledWith('view-1', expect.anything());
    // the first prompt is the agent's start argument, not typed a second time
    expect(sendToPane).not.toHaveBeenCalled();
    expect(api.quickSubmit).not.toHaveBeenCalled();

    await answer('**Vier**');
    expect((await screen.findByText('Vier')).tagName).toBe('STRONG');

    await user.type(input, 'Und 3+3?{Enter}');
    await waitFor(() => expect(sendToPane).toHaveBeenCalledWith('quick-1', 'Und 3+3?'));
    expect(startQuickAgent).toHaveBeenCalledTimes(1);

    await user.type(input, '{Escape}');
    expect(api.quickHide).toHaveBeenCalled();
    expect(api.quickExpand).toHaveBeenLastCalledWith(false);
    expect(stopPane).toHaveBeenCalledWith('quick-1');
    expect(screen.queryByLabelText('Answer')).toBeNull();
    expect(input).toHaveValue('');
  });

  it('hands the running agent pane to the main window without ending it (Cmd+Enter)', async () => {
    const user = userEvent.setup();
    render(<QuickWindow />);
    await user.type(screen.getByLabelText('Quick prompt'), 'Hallo{Enter}');
    await waitFor(() => expect(openTranscriptView).toHaveBeenCalled());
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(api.quickOpenChat).toHaveBeenCalledWith('quick-1');
    expect(stopPane).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Answer')).toBeNull();
  });

  it('falls back to the main window composer when no agent can start', async () => {
    vi.mocked(startQuickAgent).mockRejectedValue(new Error('harness missing'));
    const user = userEvent.setup();
    render(<QuickWindow />);
    await user.type(screen.getByLabelText('Quick prompt'), 'Hallo{Enter}');
    await waitFor(() => expect(api.quickSubmit).toHaveBeenCalledWith('Hallo'));
    expect(api.quickExpand).not.toHaveBeenCalledWith(true);
  });

  it('stops an agent that finishes starting after the window was hidden', async () => {
    const start = Promise.withResolvers<QuickAgent>();
    vi.mocked(startQuickAgent).mockReturnValue(start.promise);
    const user = userEvent.setup();
    render(<QuickWindow />);
    await user.type(screen.getByLabelText('Quick prompt'), 'Hallo{Enter}');
    await waitFor(() => expect(startQuickAgent).toHaveBeenCalled());
    await user.keyboard('{Escape}');
    await act(async () => start.resolve(agent));
    expect(stopPane).toHaveBeenCalledWith('quick-1');
    expect(api.quickExpand).not.toHaveBeenCalledWith(true);
    expect(openTranscriptView).not.toHaveBeenCalled();
    expect(api.quickSubmit).not.toHaveBeenCalled();
  });
});
