// #228: `#` in the title of the "Neues Issue" dialog picks the repository, like GitHub Projects
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

import { IssueCreateModal, repoHashMatches } from '../components/BoardView/IssueCreateModal';

const REPOS = ['hpmartini/claude-config', 'hpmartini/Orkumo', 'hpmartini/pickyNotes', 'acme/orbit'];

describe('repoHashMatches', () => {
  it('is off unless the whole title is one #token', () => {
    expect(repoHashMatches('', REPOS)).toBeNull();
    expect(repoHashMatches('Fix #12', REPOS)).toBeNull();
    expect(repoHashMatches('#ork fix', REPOS)).toBeNull();
    expect(repoHashMatches('#', REPOS)).toEqual(REPOS);
  });
  it('filters case-insensitively, repo-name prefix first, then anywhere in owner/name', () => {
    expect(repoHashMatches('#or', REPOS)).toEqual(['hpmartini/Orkumo', 'acme/orbit']);
    expect(repoHashMatches('#NOTES', REPOS)).toEqual(['hpmartini/pickyNotes']);
    expect(repoHashMatches('#c', REPOS)).toEqual([
      'hpmartini/claude-config',
      'hpmartini/pickyNotes',
      'acme/orbit',
    ]);
    expect(repoHashMatches('#zzz', REPOS)).toEqual([]);
  });
});

describe('IssueCreateModal repository via #', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchRepoOptions.mockResolvedValue({ labels: [], assignees: [], milestones: [] });
    api.createBoardIssue.mockResolvedValue({ id: 'i1' });
  });
  const open = (repos = REPOS) => {
    const onClose = vi.fn();
    render(
      <IssueCreateModal repo={repos[0]} repos={repos} onClose={onClose} onCreated={vi.fn()} />
    );
    return { title: screen.getByLabelText('Titel') as HTMLInputElement, onClose };
  };
  const repoSelect = () =>
    screen.getByLabelText('Repository', { selector: 'select' }) as HTMLInputElement; // only `.value` is read

  it('typing #, filtering and Enter sets the repository and clears the token', async () => {
    const { title } = open();
    fireEvent.change(title, { target: { value: '#' } });
    expect(
      screen.getAllByRole('option', { hidden: false }).filter((o) => o.tagName === 'LI')
    ).toHaveLength(4);
    fireEvent.change(title, { target: { value: '#or' } });
    const options = screen.getAllByRole('option').filter((o) => o.tagName === 'LI');
    expect(options.map((o) => o.textContent)).toEqual(['hpmartini/Orkumo', 'acme/orbit']);
    fireEvent.keyDown(title, { key: 'ArrowDown' });
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(repoSelect().value).toBe('acme/orbit');
    expect(title.value).toBe('');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(api.createBoardIssue).not.toHaveBeenCalled();

    fireEvent.change(title, { target: { value: 'Neuer Titel' } });
    fireEvent.submit(title.closest('form')!);
    await waitFor(() => expect(api.createBoardIssue).toHaveBeenCalledTimes(1));
    expect(api.createBoardIssue.mock.calls[0][0]).toMatchObject({
      repo: 'acme/orbit',
      title: 'Neuer Titel',
    });
  });

  it('a click picks too; Escape only hides the list and keeps the dialog open', () => {
    const { title, onClose } = open();
    fireEvent.change(title, { target: { value: '#picky' } });
    fireEvent.mouseDown(screen.getByText('hpmartini/pickyNotes', { selector: 'li' }));
    expect(repoSelect().value).toBe('hpmartini/pickyNotes');

    fireEvent.change(title, { target: { value: '#42' } });
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(title, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(title.value).toBe('#42');
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(repoSelect().value).toBe('hpmartini/pickyNotes');
  });

  it('no list when the repository is fixed', () => {
    const { title } = open(['hpmartini/Orkumo']);
    fireEvent.change(title, { target: { value: '#' } });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
