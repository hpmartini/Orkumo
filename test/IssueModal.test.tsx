import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type {
  BoardData,
  BoardItem,
  BoardWorkflow,
  IssueComment,
  WorkflowProviderInfo,
} from '../types';

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
  sendGo: vi.fn(),
  getWorkflowProvider: vi.fn(),
  startWorkflow: vi.fn(),
  errorDetails: () => ({}),
}));
vi.mock('../services/boardApi', () => api);
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));

import { IssueModal } from '../components/BoardView/IssueModal';
import { resetWorkflowProvider } from '../hooks/useWorkflowProvider';

// neutral fake provider: labels wf:*
const PROVIDER: WorkflowProviderInfo = {
  name: 'Fake',
  apiVersion: 1,
  stages: [{ id: 'todo', label: 'Todo' }],
  sessionName: null,
  controls: {
    toggles: [
      { label: 'wf:go', text: 'Freigeben', hint: 'Issue freigeben' },
      { label: 'wf:dynamic', text: 'Dynamic', hint: 'Dynamic' },
      { label: 'wf:delegate', text: 'Delegate', hint: 'Delegieren' },
      { label: 'wf:review', text: 'Review', hint: 'Review' },
    ],
    start: {
      label: 'wf:build',
      text: 'Umsetzen',
      hint: 'Briefing freigeben, Umsetzung sofort starten',
    },
    feedback: [
      { label: 'wf:update', text: 'Überarbeiten', hint: 'Vertrag überarbeiten' },
      { label: 'wf:followup', text: 'Nacharbeiten', hint: 'PR nacharbeiten' },
    ],
    modes: {
      options: [
        { text: 'Default', label: null },
        { text: 'Image', label: 'wf:image' },
      ],
      drop: ['wf:legacy'],
    },
    waiting: { label: 'need-input', text: 'wartet auf Antwort' },
  },
};
const pollWorkflow: BoardWorkflow = {
  state: {
    stage: 'todo',
    waitingOn: 'poll',
    reason: '',
    since: null,
    go: { kind: 'poll', text: 'Jetzt starten', panel: true },
    error: null,
  },
  sessionIds: [],
};

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
    { name: 'wf:go', color: '5319e7' },
  ],
  milestone: null,
  assignees: [],
  parent: null,
  subIssues: { total: 0, completed: 0 },
  pullRequests: [],
  workflow: pollWorkflow,
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
    labels: [
      'bug',
      'wf:go',
      'wf:build',
      'wf:dynamic',
      'wf:delegate',
      'wf:image',
      'wf:update',
      'wf:followup',
    ].map((name, i) => ({
      id: `L${i}`,
      name,
      color: '000000',
    })),
    assignees: [],
    milestones: [],
  });
  resetWorkflowProvider();
  api.getWorkflowProvider.mockResolvedValue(PROVIDER);
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
        labels: ['bug', 'wf:go', 'wf:build'],
      })
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Image' }));
    await waitFor(() =>
      expect(api.updateBoardIssue).toHaveBeenLastCalledWith('PVTI_1', {
        labels: ['bug', 'wf:go', 'wf:build', 'wf:image'],
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delegate' }));
    await waitFor(() =>
      expect(api.updateBoardIssue).toHaveBeenLastCalledWith('PVTI_1', {
        labels: ['bug', 'wf:go', 'wf:build', 'wf:image', 'wf:delegate'],
      })
    );
    // #136 AC-6: modes Default and Image only, switches dynamic/delegate/review
    expect(
      within(screen.getByRole('radiogroup', { name: 'Modus' }))
        .getAllByRole('radio')
        .map((b) => b.textContent)
    ).toEqual(['Default', 'Image']);
    expect(screen.getByRole('button', { name: 'Dynamic' })).toBeTruthy();
    // Label missing in the repo: button disabled
    expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('AC-1: Umsetzen with wf:build set leaves the label, twice; without it sets it once', async () => {
    const built = { ...item, labels: [...item.labels, { name: 'wf:build', color: '000000' }] };
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

  it('AC-1: Umsetzen without wf:build sets it (no duplicate), then starts', async () => {
    renderModal();
    const build = (await screen.findByRole('button', { name: 'Umsetzen' })) as HTMLButtonElement;
    await waitFor(() => expect(build.disabled).toBe(false));
    expect(build.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(build);
    await waitFor(() => expect(api.startWorkflow).toHaveBeenCalledTimes(1));
    expect(api.updateBoardIssue).toHaveBeenCalledTimes(1);
    expect(api.updateBoardIssue).toHaveBeenCalledWith('PVTI_1', {
      labels: ['bug', 'wf:go', 'wf:build'],
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
    [{ action: 'resume', reason: 'wf:build' }, 'Umsetzung: gestartet'],
    [
      { action: 'none', reason: 'kein Platz frei (4/4)', full: true },
      'Umsetzung: kein Platz frei (4/4), startet, sobald einer frei wird',
    ],
    [
      { action: 'queued', reason: 'startet mit dem nächsten Poll' },
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
    api.startWorkflow.mockRejectedValue(new Error('wf start: boom'));
    renderModal();
    const build = (await screen.findByRole('button', { name: 'Umsetzen' })) as HTMLButtonElement;
    await waitFor(() => expect(build.disabled).toBe(false));
    fireEvent.click(build);
    expect(await screen.findByText('Umsetzung: Nicht gestartet: wf start: boom')).toBeTruthy();
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
      expect(api.setIssueLabels).toHaveBeenCalledWith('I_9', ['bug', 'wf:build'])
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
    api.sendGo.mockResolvedValue({ ok: true });
    renderModal();
    const start = await screen.findByRole('button', { name: /Jetzt starten/ });
    fireEvent.click(start);
    expect(api.sendGo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Wirklich/ }));
    await waitFor(() => expect(api.sendGo).toHaveBeenCalledWith('PVTI_1', 'poll'));
  });

  it('picked-up issue (session started): no "Jetzt starten"', async () => {
    api.fetchBoard.mockResolvedValue({
      ...board,
      items: [
        { ...item, workflow: { ...pollWorkflow, state: { ...pollWorkflow.state, go: null } } },
      ],
    });
    renderModal();
    await screen.findByText('Rückfrage?');
    expect(screen.queryByRole('button', { name: /Jetzt starten/ })).toBeNull();
  });

  it('without provider: no control flow section, no GO button', async () => {
    api.getWorkflowProvider.mockResolvedValue(null);
    api.fetchBoard.mockResolvedValue({ ...board, items: [{ ...item, workflow: null }] });
    renderModal();
    await screen.findByText('Rückfrage?');
    expect(screen.queryByRole('region', { name: 'Kontrollfluss' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Umsetzen' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Jetzt starten/ })).toBeNull();
  });

  it('Escape closes', async () => {
    const onClose = renderModal();
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

// briefing 2026-11-05: feedback on the contract (Briefed) and on the PR (to Review)
describe.each([
  ['AC-3', 'Überarbeiten', 'wf:update'],
  ['AC-4', 'Nacharbeiten', 'wf:followup'],
])('%s: %s', (_, name, label) => {
  const button = async () => {
    const b = (await screen.findByRole('button', { name })) as HTMLButtonElement;
    await screen.findByText('Rückfrage?');
    return b;
  };

  it('stays disabled without text', async () => {
    renderModal();
    const b = await button();
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Umsetzen' }) as HTMLButtonElement).disabled).toBe(
        false
      )
    );
    expect(b.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Rückmeldung'), { target: { value: '   ' } });
    expect(b.disabled).toBe(true);
  });

  it(`posts the comment, sets ${label}, then starts now`, async () => {
    api.addIssueComment.mockResolvedValue([]);
    renderModal();
    const b = await button();
    const box = screen.getByLabelText('Rückmeldung') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: ' Bitte Abschnitt 2 kürzen ' } });
    await waitFor(() => expect(b.disabled).toBe(false));
    fireEvent.click(b);
    await waitFor(() => expect(api.startWorkflow).toHaveBeenCalledTimes(1));
    expect(api.addIssueComment).toHaveBeenCalledWith('I_1', 'Bitte Abschnitt 2 kürzen');
    expect(api.updateBoardIssue).toHaveBeenCalledWith('PVTI_1', {
      labels: ['bug', 'wf:go', label],
    });
    expect(api.startWorkflow).toHaveBeenCalledWith('https://github.com/o/r/issues/7');
    const order = [api.addIssueComment, api.updateBoardIssue, api.startWorkflow].map(
      (m) => m.mock.invocationCallOrder[0]
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect((await screen.findByRole('status')).textContent).toBe('Rückmeldung: gestartet');
    expect(box.value).toBe('');
  });

  it('a failed comment sets no label and starts nothing', async () => {
    api.addIssueComment.mockRejectedValue(new Error('gh down'));
    renderModal();
    const b = await button();
    fireEvent.change(screen.getByLabelText('Rückmeldung'), { target: { value: 'x' } });
    await waitFor(() => expect(b.disabled).toBe(false));
    fireEvent.click(b);
    expect(await screen.findByText('Rückmeldung: Nicht gestartet: gh down')).toBeTruthy();
    expect(api.updateBoardIssue).not.toHaveBeenCalled();
    expect(api.startWorkflow).not.toHaveBeenCalled();
  });

  it(`is disabled when ${label} is missing in the repo`, async () => {
    api.fetchRepoOptions.mockResolvedValue({
      repositoryId: 'R',
      labels: [{ id: 'L0', name: 'wf:build', color: '000000' }],
      assignees: [],
      milestones: [],
    });
    renderModal();
    const b = await button();
    fireEvent.change(screen.getByLabelText('Rückmeldung'), { target: { value: 'x' } });
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Umsetzen' }) as HTMLButtonElement).disabled).toBe(
        false
      )
    );
    expect(b.disabled).toBe(true);
    expect(b.title).toBe(`Label ${label} gibt es im Repo nicht`);
  });
});
