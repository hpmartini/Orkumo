// #271: Task/Agent/Chat/Issue can be switched while the dialog is open; the draft moves along
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

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
import { TaskComposerModal } from '../components/CommandPalette/TaskComposerModal';
import { issueDraftToTask, taskToIssueDraft } from '../utils/composer';

const tab = (name: string) => screen.getByRole('tab', { name });

describe('draft conversion (#271)', () => {
  it('first line becomes the title, the rest the body, and back', () => {
    const draft = taskToIssueDraft('  Fix login\n\nSteps:\n1. open\n');
    expect(draft).toEqual({ title: 'Fix login', body: 'Steps:\n1. open' });
    expect(issueDraftToTask(draft)).toBe('Fix login\n\nSteps:\n1. open');
    expect(taskToIssueDraft('')).toEqual({ title: '', body: '' });
    expect(issueDraftToTask({ title: '', body: 'only body' })).toBe('only body');
  });
  it('a first line beyond the title limit stays in the body', () => {
    const long = 'x'.repeat(300);
    expect(taskToIssueDraft(long)).toEqual({ title: '', body: long });
  });
});

describe('kind switch in the dialogs (#271)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchRepoOptions.mockResolvedValue({ labels: [], assignees: [], milestones: [] });
  });

  const composer = (variant: 'task' | 'agent' | 'chat', onKindChange = vi.fn()) => {
    render(
      <TaskComposerModal
        open
        onClose={vi.fn()}
        value="Fix login"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onOpenEditor={vi.fn()}
        onPickDirectory={vi.fn()}
        targetCwd="/tmp"
        hint={null}
        subagents={[]}
        repos={[]}
        commands={[]}
        inputRef={createRef()}
        variant={variant}
        images={[]}
        onImagesChange={vi.fn()}
        onKindChange={onKindChange}
      />
    );
    return onKindChange;
  };

  it('composer marks its kind and reports the others', () => {
    const onKindChange = composer('chat');
    expect(tab('Chat')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Task')).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(tab('Chat'));
    expect(onKindChange).not.toHaveBeenCalled();
    for (const [name, kind] of [
      ['Task', 'task'],
      ['Agent', 'agent'],
      ['Issue', 'issue'],
    ]) {
      fireEvent.click(tab(name));
      expect(onKindChange).toHaveBeenLastCalledWith(kind);
    }
  });

  it('issue dialog starts from the draft and hands its current draft back', () => {
    const onKindChange = vi.fn();
    render(
      <IssueCreateModal
        repo="acme/app"
        draft={{ title: 'Fix login', body: 'Steps', images: [] }}
        onKindChange={onKindChange}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );
    expect(tab('Issue')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Titel')).toHaveValue('Fix login');
    expect(screen.getByLabelText('Beschreibung')).toHaveValue('Steps');
    fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Fix logout' } });
    fireEvent.click(tab('Agent'));
    expect(onKindChange).toHaveBeenCalledWith('agent', {
      title: 'Fix logout',
      body: 'Steps',
      images: [],
    });
  });

  it('without onKindChange (board) there is no switch', () => {
    render(<IssueCreateModal repo="acme/app" onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.queryByRole('tablist')).toBeNull();
  });
});
