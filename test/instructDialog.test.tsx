// AC-15: Instruct from a Status card: text plus pasted image, sent to the orchestrator; an offline
// orchestrator shows the server's message in the dialog
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const upload = vi.fn();
const instruct = vi.fn();
vi.mock('../services/agentsApi', () => ({ uploadAttachment: (f: File) => upload(f) }));
vi.mock('../services/orchestratorApi', () => ({
  instructOrchestrator: (id: string, body: unknown) => instruct(id, body),
}));

import { InstructDialog, openInstruct } from '../components/InstructDialog';

const target = {
  orchestrator: 'release',
  orchestratorName: 'Release',
  entry: 'limit',
  title: 'Limit discount codes',
  project: 'Example Shop',
};

beforeEach(() => {
  upload.mockReset();
  instruct.mockReset();
  globalThis.URL.createObjectURL ??= () => 'blob:x';
  globalThis.URL.revokeObjectURL ??= () => {};
});

describe('InstructDialog', () => {
  it('sends text and a pasted image for an entry and shows delivery', async () => {
    upload.mockResolvedValue({ path: '/data/agent-images/a.png', kind: 'image' });
    instruct.mockResolvedValue({ delivered: true });
    render(<InstructDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => openInstruct(target));

    expect(screen.getByRole('dialog', { name: 'Instruct Release' })).toBeInTheDocument();
    expect(
      screen.getByText('[Status] Example Shop · Limit discount codes (entry limit)')
    ).toBeInTheDocument();
    const box = screen.getByLabelText('Message to Release');
    fireEvent.change(box, { target: { value: '  Take the per-code variant.  ' } });
    const image = new File(['x'], 'shot.png', { type: 'image/png' });
    fireEvent.paste(box, { clipboardData: { files: [image] } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(/Delivered to Release/)).toBeInTheDocument();
    expect(upload).toHaveBeenCalledWith(image);
    expect(instruct).toHaveBeenCalledWith('release', {
      entry: 'limit',
      text: 'Take the per-code variant.',
      attachments: [{ path: '/data/agent-images/a.png', kind: 'image' }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('addresses a task and keeps the text when the orchestrator is offline', async () => {
    instruct.mockRejectedValue(new Error('The orchestrator is not running'));
    render(<InstructDialog />);
    act(() =>
      openInstruct({ ...target, entry: undefined, task: { project: 'shop', task: 'checkout' } })
    );
    const box = screen.getByLabelText('Message to Release');
    fireEvent.change(box, { target: { value: 'Pause this.' } });
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not delivered: The orchestrator is not running'
    );
    expect(instruct).toHaveBeenCalledWith('release', {
      task: { project: 'shop', task: 'checkout' },
      text: 'Pause this.',
      attachments: [],
    });
    expect(box).toHaveValue('Pause this.');
    expect(screen.getByRole('button', { name: 'Send again' })).toBeEnabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
