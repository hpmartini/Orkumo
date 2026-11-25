// #254: pickers of the "Neues Issue" dialog close each other and on outside clicks; status is choosable
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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
    const trigger = (name: string) => screen.getByRole('button', { name: `Change ${name}` });
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
    // keyboard activation: click without mousedown
    fireEvent.click(trigger('Labels'));
    expect(lists()).toEqual(['Labels']);
  });

  it('a click elsewhere in the dialog closes the picker, its own trigger toggles it', async () => {
    const trigger = await open();
    press(trigger('Labels'));
    expect(lists()).toEqual(['Labels']);
    fireEvent.mouseDown(screen.getByLabelText('Description'));
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
    // two statuses: a Choice radio group
    expect(screen.getByRole('radio', { name: 'Backlog' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Todo' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Neu' } });
    fireEvent.submit(screen.getByLabelText('Title').closest('form')!);
    await waitFor(() =>
      expect(api.createBoardIssue).toHaveBeenCalledWith(
        expect.objectContaining({ repo: 'acme/app', title: 'Neu', statusOptionId: 's-todo' })
      )
    );
  });
});

describe('IssueCreateModal milestone on Choice', () => {
  it('sends the picked milestone and nothing after "No milestone"', async () => {
    api.fetchRepoOptions.mockResolvedValue({
      labels: [],
      assignees: [],
      milestones: [{ id: 'm1', title: 'v1' }],
    });
    api.createBoardIssue.mockResolvedValue({ id: 'i1' });
    render(<IssueCreateModal repo="acme/app" onClose={vi.fn()} onCreated={vi.fn()} />);
    const group = await screen.findByRole('radiogroup', { name: 'Milestone' });
    await waitFor(() => expect(within(group).getByRole('radio', { name: 'v1' })).toBeEnabled());
    fireEvent.click(within(group).getByRole('radio', { name: 'v1' }));
    fireEvent.click(within(group).getByRole('radio', { name: 'No milestone' }));
    fireEvent.click(within(group).getByRole('radio', { name: 'v1' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Neu' } });
    fireEvent.submit(screen.getByLabelText('Title').closest('form')!);
    await waitFor(() =>
      expect(api.createBoardIssue).toHaveBeenCalledWith(
        expect.objectContaining({ milestone: 'v1' })
      )
    );
  });
});
