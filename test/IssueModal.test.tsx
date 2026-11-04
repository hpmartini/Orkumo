import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  fetchIssueSummary: vi.fn(),
  setIssueLabels: vi.fn(),
  fetchRepoPath: vi.fn(),
  sendPollGo: vi.fn(),
  startWorkflow: vi.fn(),
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
    labels: ['bug', 'mw:go', 'mw:build', 'mw:dynamic', 'mw:delegate', 'mw:image'].map(
      (name, i) => ({
        id: `L${i}`,
        name,
        color: '000000',
      })
    ),
    assignees: [],
    milestones: [],
  });
  api.startWorkflow.mockResolvedValue({ action: 'start', reason: '' });
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
    fireEvent.click(screen.getByRole('radio', { name: 'Image' }));
    await waitFor(() =>
      expect(api.updateBoardIssue).toHaveBeenLastCalledWith('PVTI_1', {
        labels: ['bug', 'mw:go', 'mw:build', 'mw:image'],
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delegate' }));
    await waitFor(() =>
      expect(api.updateBoardIssue).toHaveBeenLastCalledWith('PVTI_1', {
        labels: ['bug', 'mw:go', 'mw:build', 'mw:image', 'mw:delegate'],
      })
    );
    // #136 AC-6: modes Default and Image only, switches dynamic/delegate/review
    expect(
      within(screen.getByRole('radiogroup', { name: 'mw-Modus' }))
        .getAllByRole('radio')
        .map((b) => b.textContent)
    ).toEqual(['Default', 'Image']);
    expect(screen.getByRole('button', { name: 'Dynamic' })).toBeTruthy();
    // Label missing in the repo: button disabled
    expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('AC-1: Umsetzen with mw:build set leaves the label, twice; without it sets it once', async () => {
    const built = { ...item, labels: [...item.labels, { name: 'mw:build', color: '000000' }] };
    api.fetchBoard.mockResolvedValue({ ...board, items: [built] });
    renderModal();
    const build = (await screen.findByRole('button', { name: 'Umsetzen' })) as HTMLButtonElement;
    await waitFor(() => expect(build.disabled).toBe(false));
    expect(build.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(build);
    await screen.findByText('Umsetzung: gestartet');
    fireEvent.click(build);
    await waitFor(() => expect(api.startWorkflow).toHaveBeenCalledTimes(2));
    expect(api.startWorkflow).toHaveBeenCalledWith('https://github.com/o/r/issues/7');
    expect(api.updateBoardIssue).not.toHaveBeenCalled();
    expect(build.getAttribute('aria-pressed')).toBe('true');
  });

  it('AC-1: Umsetzen without mw:build sets it (no duplicate), then starts', async () => {
    renderModal();
    const build = (await screen.findByRole('button', { name: 'Umsetzen' })) as HTMLButtonElement;
    await waitFor(() => expect(build.disabled).toBe(false));
    expect(build.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(build);
    await waitFor(() => expect(api.startWorkflow).toHaveBeenCalledTimes(1));
    expect(api.updateBoardIssue).toHaveBeenCalledTimes(1);
    expect(api.updateBoardIssue).toHaveBeenCalledWith('PVTI_1', {
      labels: ['bug', 'mw:go', 'mw:build'],
    });
    expect(api.updateBoardIssue.mock.invocationCallOrder[0]).toBeLessThan(
      api.startWorkflow.mock.invocationCallOrder[0]
    );
    await waitFor(() => expect(build.getAttribute('aria-pressed')).toBe('true'));
  });

  it('AC-1: a failed label write starts nothing', async () => {
    api.updateBoardIssue.mockRejectedValue(new Error('gh down'));
    renderModal();
    const build = (await screen.findByRole('button', { name: 'Umsetzen' })) as HTMLButtonElement;
    await waitFor(() => expect(build.disabled).toBe(false));
    fireEvent.click(build);
    await waitFor(() => expect(api.updateBoardIssue).toHaveBeenCalled());
    await waitFor(() => expect(build.disabled).toBe(false));
    expect(api.startWorkflow).not.toHaveBeenCalled();
  });

  it.each([
    [{ action: 'start', reason: 'Todo' }, 'Umsetzung: gestartet'],
    [{ action: 'resume', reason: 'mw:build' }, 'Umsetzung: gestartet'],
    [
      { action: 'none', reason: 'kein Platz frei (4/4)' },
      'Umsetzung: kein Platz frei (4/4), startet, sobald einer frei wird',
    ],
    [
      { action: 'poll', reason: 'startet mit dem nächsten Poll' },
      'Umsetzung: startet mit dem nächsten Poll',
    ],
    [{ action: 'none', reason: 'Issue nicht auf MACC' }, 'Umsetzung: Issue nicht auf MACC'],
  ])('AC-4: dialog reports %j', async (result, text) => {
    api.startWorkflow.mockResolvedValue(result);
    renderModal();
    const build = (await screen.findByRole('button', { name: 'Umsetzen' })) as HTMLButtonElement;
    await waitFor(() => expect(build.disabled).toBe(false));
    fireEvent.click(build);
    expect((await screen.findByRole('status')).textContent).toBe(text);
  });

  it('AC-4: a failed start is reported, the label stays', async () => {
    api.startWorkflow.mockRejectedValue(new Error('mw board go: boom'));
    renderModal();
    const build = (await screen.findByRole('button', { name: 'Umsetzen' })) as HTMLButtonElement;
    await waitFor(() => expect(build.disabled).toBe(false));
    fireEvent.click(build);
    expect(await screen.findByText('Umsetzung: Nicht gestartet: mw board go: boom')).toBeTruthy();
    expect(build.getAttribute('aria-pressed')).toBe('true');
  });

  it('issue not on the board: title, body, labels, control buttons and comments', async () => {
    const summary = {
      issueId: 'I_9',
      repo: 'o/r',
      number: 99,
      title: 'Fremdes Issue',
      body: 'Text',
      url: 'https://github.com/o/r/issues/99',
      state: 'OPEN',
      labels: [{ name: 'bug', color: 'ff0000' }],
    };
    api.fetchIssueSummary.mockResolvedValue(summary);
    api.setIssueLabels.mockImplementation(async (_id, names: string[]) => ({
      ...summary,
      labels: names.map((name) => ({ name, color: '000000' })),
    }));
    renderModal('o/r#99');
    expect(await screen.findByText('Fremdes Issue')).toBeTruthy();
    expect(screen.getByText('Text')).toBeTruthy();
    expect(await screen.findByText('Rückfrage?')).toBeTruthy();
    expect(api.fetchIssueSummary).toHaveBeenCalledWith('o/r', 99);
    expect(api.fetchIssueComments).toHaveBeenCalledWith('I_9');
    expect((screen.getByRole('button', { name: /Board/ }) as HTMLButtonElement).disabled).toBe(
      true
    );
    const build = screen.getByRole('button', { name: 'Umsetzen' }) as HTMLButtonElement;
    await waitFor(() => expect(build.disabled).toBe(false));
    fireEvent.click(build);
    await waitFor(() =>
      expect(api.setIssueLabels).toHaveBeenCalledWith('I_9', ['bug', 'mw:build'])
    );
    await waitFor(() => expect(build.getAttribute('aria-pressed')).toBe('true'));
    await waitFor(() =>
      expect(api.startWorkflow).toHaveBeenCalledWith('https://github.com/o/r/issues/99')
    );
    // a second click keeps the label (#194: the toggle removed it)
    fireEvent.click(build);
    await waitFor(() => expect(api.startWorkflow).toHaveBeenCalledTimes(2));
    expect(api.setIssueLabels).toHaveBeenCalledTimes(1);
    expect(build.getAttribute('aria-pressed')).toBe('true');
  });

  it('released issue waiting on the poll: "Jetzt starten" starts it after confirming (#145)', async () => {
    api.sendPollGo.mockResolvedValue({ ok: true });
    renderModal();
    const start = await screen.findByRole('button', { name: /Jetzt starten/ });
    fireEvent.click(start);
    expect(api.sendPollGo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Wirklich/ }));
    await waitFor(() => expect(api.sendPollGo).toHaveBeenCalledWith('PVTI_1'));
  });

  it('picked-up issue (session started): no "Jetzt starten"', async () => {
    api.fetchBoard.mockResolvedValue({
      ...board,
      items: [{ ...item, mwMarkers: [{ kind: 'start', attrs: { session: 's' }, at: '' }] }],
    });
    renderModal();
    await screen.findByText('Rückfrage?');
    expect(screen.queryByRole('button', { name: /Jetzt starten/ })).toBeNull();
  });

  it('Escape closes', async () => {
    const onClose = renderModal();
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
