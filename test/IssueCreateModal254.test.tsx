// #254: pickers of the "Neues Issue" dialog close each other and on outside clicks; status is choosable
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  createBoardIssue: vi.fn(),
  uploadIssueImage: vi.fn(),
  fetchRepoOptions: vi.fn(),
  errorDetails: () => ({}),
}));
vi.mock('../services/boardApi', () => api);
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));

import { IssueCreateModal } from '../components/BoardView/IssueCreateModal';

const STATUS = [
  { id: 's-backlog', name: 'Backlog' },
  { id: 's-todo', name: 'Todo' },
];

describe('IssueCreateModal pickers and status (#254)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchRepoOptions.mockResolvedValue({
      labels: [{ id: 'l1', name: 'bug', color: 'ff0000' }],
      assignees: [{ id: 'u1', login: 'hpmartini' }],
      milestones: [],
    });
    api.createBoardIssue.mockResolvedValue({ id: 'i1' });
  });
  const open = async () => {
    render(
      <IssueCreateModal
        repo="acme/app"
        statusOptions={STATUS as never}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );
    const trigger = (name: string) => screen.getByRole('button', { name: `${name} ändern` });
    await waitFor(() => expect(trigger('Labels')).toBeEnabled());
    return trigger;
  };
  const lists = () => screen.queryAllByRole('listbox').map((l) => l.getAttribute('aria-label'));
  // usePopover listens on document for the real event, as a click would send it
  const press = (el: HTMLElement) => {
    fireEvent.mouseDown(el);
    fireEvent.click(el);
  };

  it('opening a second picker closes the first', async () => {
    const trigger = await open();
    press(trigger('Labels'));
    expect(lists()).toEqual(['Labels']);
    press(trigger('Assignees'));
    expect(lists()).toEqual(['Assignees']);
    press(trigger('Milestone'));
    expect(lists()).toEqual(['Milestone']);
    // keyboard activation: click without mousedown
    fireEvent.click(trigger('Labels'));
    expect(lists()).toEqual(['Labels']);
  });

  it('a click elsewhere in the dialog closes the picker, its own trigger toggles it', async () => {
    const trigger = await open();
    press(trigger('Labels'));
    expect(lists()).toEqual(['Labels']);
    fireEvent.mouseDown(screen.getByLabelText('Beschreibung'));
    expect(lists()).toEqual([]);
    press(trigger('Labels'));
    press(trigger('Labels'));
    expect(lists()).toEqual([]);
  });

  it('picking inside the list keeps a multi picker open', async () => {
    const trigger = await open();
    press(trigger('Labels'));
    press(screen.getByRole('option', { name: 'bug' }));
    expect(lists()).toEqual(['Labels']);
  });

  it('creates the issue in the chosen status', async () => {
    await open();
    const status = screen.getByLabelText('Status') as HTMLInputElement; // only `.value` is read
    expect(status.value).toBe('s-backlog');
    fireEvent.change(status, { target: { value: 's-todo' } });
    fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Neu' } });
    fireEvent.submit(screen.getByLabelText('Titel').closest('form')!);
    await waitFor(() =>
      expect(api.createBoardIssue).toHaveBeenCalledWith(
        expect.objectContaining({ repo: 'acme/app', title: 'Neu', statusOptionId: 's-todo' })
      )
    );
  });
});
