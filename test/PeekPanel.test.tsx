import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentSession } from '../types';

const fetchAgentLogs = vi.fn();
vi.mock('../services/agentsApi', () => ({
  fetchAgentLogs: (...args: unknown[]) => fetchAgentLogs(...args),
  fetchRemoteAgentLogs: vi.fn(),
}));

window.Element.prototype.scrollTo ??= () => {}; // jsdom has no layout

const { PeekPanel } = await import('../components/AgentsView/PeekPanel');

const rawLogs = (name: string) => ({
  source: 'logs' as const,
  text: fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'),
  entries: [],
});

const session = {
  id: 's1',
  sessionId: null,
  kind: 'background',
  cwd: '/home/dev/Orkumo',
  startedAt: 1000,
  name: 'fixture-178',
  state: 'blocked',
  pinned: false,
  order: null,
  links: [],
  displayState: 'needs-input',
} as unknown as AgentSession;

function mount(onReply = vi.fn().mockResolvedValue(undefined)) {
  render(<PeekPanel session={session} onClose={vi.fn()} onAttach={vi.fn()} onReply={onReply} />);
  return onReply;
}

describe('PeekPanel output (#178)', () => {
  beforeEach(() => fetchAgentLogs.mockReset());

  it('AC-1/AC-2: shows the interpreted screen unwrapped, words spaced', async () => {
    fetchAgentLogs.mockResolvedValue(rawLogs('claude-logs-table.txt'));
    mount();
    const pre = await waitFor(
      () => {
        const el = document.querySelector('[data-peek-screen]');
        expect(el?.textContent).toContain('Die verschleppten Favoriten');
        return el as HTMLElement;
      },
      { timeout: 5000 }
    );
    expect(pre.textContent).toContain('│ Agentic Workflow │ Agent f44e021a │ -        │');
    expect(pre.className).toContain('whitespace-pre');
    expect(pre.className).not.toContain('break-words');
  });

  it('AC-3: offers the question options and sends the picked number', async () => {
    fetchAgentLogs.mockResolvedValue(rawLogs('claude-logs-question.txt'));
    const onReply = mount();
    await screen.findByRole('button', { name: /Später entscheiden/ }, { timeout: 5000 });
    fireEvent.keyDown(screen.getByLabelText('Reply to session'), { key: '3' });
    await waitFor(() => expect(onReply).toHaveBeenCalledWith('3'));
  });

  it('AC-4: large view opens as modal with output and reply, Esc returns to the panel', async () => {
    fetchAgentLogs.mockResolvedValue(rawLogs('claude-logs-question.txt'));
    const onReply = mount();
    await screen.findByRole('button', { name: /Backup behalten/ }, { timeout: 5000 });

    fireEvent.click(screen.getByRole('button', { name: 'Open large view' }));
    const dialog = screen.getByRole('dialog', { name: 'fixture-178' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.querySelector('[data-peek-screen]')?.textContent).toContain(
      'Was soll mit dem Backup passieren?'
    );
    const input = screen.getByLabelText('Reply to session');
    expect(dialog.contains(input)).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(input));

    fireEvent.change(input, { target: { value: 'lösch es' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onReply).toHaveBeenCalledWith('lösch es'));

    fireEvent.keyDown(screen.getByLabelText('Reply to session'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText('Reply to session'))
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open large view' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to panel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
