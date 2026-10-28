import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { BoardData, BoardItem, IssueComment } from '../types';

const api = vi.hoisted(() => ({
  fetchBoard: vi.fn(),
  fetchBoardSettings: vi.fn(),
  setBoardItemStatus: vi.fn(),
  updateBoardSettings: vi.fn(),
  updateBoardIssue: vi.fn(),
  fetchRepoOptions: vi.fn(),
  fetchIssueDetails: vi.fn(),
  fetchIssueComments: vi.fn(),
  addIssueComment: vi.fn(),
  fetchIssueId: vi.fn(),
  fetchRepoPath: vi.fn(),
  errorDetails: () => ({}),
}));
vi.mock('../services/boardApi', () => api);
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));

import { IssueModal } from '../components/BoardView/IssueModal';

const item: BoardItem = {
  itemId: 'PVTI_1',
  type: 'Issue',
  issueId: 'I_1',
  number: 7,
  title: 'Testissue',
  url: 'https://github.com/o/r/issues/7',
  repo: 'o/r',
  state: 'OPEN',
  stateReason: null,
  statusOptionId: 'A',
  labels: [
    { name: 'bug', color: 'ff0000' },
    { name: 'mw:go', color: '5319e7' },
  ],
  milestone: null,
  assignees: [],
  parent: null,
  subIssues: { total: 0, completed: 0 },
  pullRequests: [],
  mwBoardSessions: [],
  mwMarkers: [],
  updatedAt: '2026-10-01T00:00:00Z',
  closedAt: null,
};
const board: BoardData = {
  source: { owner: 'o', number: 1 },
  projectId: 'PVT_1',
  title: 'MACC',
  statusField: { id: 'F', options: [{ id: 'A', name: 'Todo', color: 'GRAY' }] },
  items: [item],
  fetchedAt: 0,
};
const comment: IssueComment = {
  id: 'C1',
  author: 'hpmartini',
  body: 'Rückfrage?',
  createdAt: '2026-10-27T00:00:00Z',
  url: 'https://github.com/o/r/issues/7#c1',
};

let path = '';
const Where = () => {
  path = useLocation().pathname + useLocation().search;
  return null;
};

function renderModal(key = 'o/r#7', onClose = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/agents']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <Where />
              <IssueModal issueKey={key} sessions={[]} onClose={onClose} />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
  return onClose;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchBoard.mockResolvedValue(board);
  api.fetchBoardSettings.mockResolvedValue({
    source: board.source,
    favorites: [],
    order: [],
    hidden: [],
  });
  api.fetchIssueDetails.mockResolvedValue({ body: 'Body', subIssues: [] });
  api.fetchIssueComments.mockResolvedValue([comment]);
  api.fetchRepoOptions.mockResolvedValue({
    repositoryId: 'R',
    labels: ['bug', 'mw:go', 'mw:build', 'mw:dynamic', 'mw:pipeline'].map((name, i) => ({
      id: `L${i}`,
      name,
      color: '000000',
    })),
    assignees: [],
    milestones: [],
  });
  api.updateBoardIssue.mockImplementation(async (_id, patch) => ({
    ...item,
    labels: patch.labels.map((name: string) => ({ name, color: '000000' })),
  }));
});

describe('IssueModal (#104)', () => {
  it('shows the issue as dialog with comments, stays on the route, opens the board', async () => {
    renderModal();
    expect(await screen.findByRole('dialog', { name: 'Issue o/r#7' })).toBeTruthy();
    expect(await screen.findByText('Rückfrage?')).toBeTruthy();
    expect(path).toBe('/agents');
    fireEvent.click(screen.getByRole('button', { name: /Board/ }));
    expect(path).toBe('/board?item=o%2Fr%237');
  });

  it('quote and reply fill the composer, send posts it', async () => {
    renderModal();
    await screen.findByText('Rückfrage?');
    fireEvent.click(screen.getByRole('button', { name: 'Zitieren' }));
    const box = screen.getByLabelText('Neuer Kommentar') as HTMLTextAreaElement;
    expect(box.value).toContain('> Rückfrage?');
    fireEvent.click(screen.getByRole('button', { name: 'Antworten' }));
    expect(box.value.endsWith('@hpmartini ')).toBe(true);
    fireEvent.change(box, { target: { value: 'Ja, so.' } });
    api.addIssueComment.mockResolvedValue([comment, { ...comment, id: 'C2', body: 'Ja, so.' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Kommentieren' }));
    await waitFor(() => expect(api.addIssueComment).toHaveBeenCalledWith('I_1', 'Ja, so.'));
    expect(await screen.findByText('Ja, so.')).toBeTruthy();
    expect(box.value).toBe('');
  });

  it('keeps the draft when sending fails', async () => {
    renderModal();
    await screen.findByText('Rückfrage?');
    const box = screen.getByLabelText('Neuer Kommentar') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Wichtig' } });
    api.addIssueComment.mockRejectedValue(new Error('gh down'));
    fireEvent.click(screen.getByRole('button', { name: 'Kommentieren' }));
    expect(await screen.findByText(/Nicht gesendet: gh down/)).toBeTruthy();
    expect(box.value).toBe('Wichtig');
  });

  it('control buttons set flow labels and keep the others', async () => {
    renderModal();
    const build = await screen.findByRole('button', { name: 'Umsetzen' });
    await waitFor(() => expect((build as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole('button', { name: 'Freigeben' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    fireEvent.click(build);
    await waitFor(() =>
      expect(api.updateBoardIssue).toHaveBeenCalledWith('PVTI_1', {
        labels: ['bug', 'mw:go', 'mw:build'],
      })
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Pipeline' }));
    await waitFor(() =>
      expect(api.updateBoardIssue).toHaveBeenLastCalledWith('PVTI_1', {
        labels: ['bug', 'mw:go', 'mw:build', 'mw:pipeline'],
      })
    );
    // Label missing in the repo: button disabled
    expect((screen.getByRole('radio', { name: 'Image' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('issue not on the board: comments via resolved id, board button disabled', async () => {
    api.fetchIssueId.mockResolvedValue('I_9');
    renderModal('o/r#99');
    expect(await screen.findByText('Rückfrage?')).toBeTruthy();
    expect(api.fetchIssueId).toHaveBeenCalledWith('o/r', 99);
    expect(api.fetchIssueComments).toHaveBeenCalledWith('I_9');
    expect((screen.getByRole('button', { name: /Board/ }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('Escape closes', async () => {
    const onClose = renderModal();
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
