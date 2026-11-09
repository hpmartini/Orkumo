import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BoardItem, IssueComment } from '../types';

const api = vi.hoisted(() => ({
  fetchIssueDetails: vi.fn(),
  fetchIssueComments: vi.fn(),
  addIssueComment: vi.fn(),
  fetchRepoOptions: vi.fn(),
  getWorkflowProvider: vi.fn(),
  sendGo: vi.fn(),
  errorDetails: () => ({}),
}));
vi.mock('../services/boardApi', () => api);
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));

import { BoardItemPanel } from '../components/BoardView/BoardItemPanel';
import { IssueComments } from '../components/BoardView/IssueComments';
import { resetWorkflowProvider } from '../hooks/useWorkflowProvider';

const ORDER_KEY = 'devorbit:issueCommentsNewestFirst';

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
  labels: [],
  milestone: null,
  assignees: [],
  parent: null,
  subIssues: { total: 1, completed: 0 },
  pullRequests: [
    {
      repo: 'o/r',
      number: 9,
      url: 'https://github.com/o/r/pull/9',
      title: 'Der PR',
      state: 'OPEN',
      checks: null as never,
    },
  ],
  workflow: null,
  updatedAt: '2026-10-01T00:00:00Z',
  closedAt: null,
};

// API order deliberately mixed: middle, oldest, newest
const comments: IssueComment[] = [
  { id: 'C2', author: 'mitte', body: 'b', createdAt: '2026-10-02T00:00:00Z', url: 'u2' },
  { id: 'C1', author: 'alt', body: 'a', createdAt: '2026-10-01T00:00:00Z', url: 'u1' },
  { id: 'C3', author: 'neu', body: 'c', createdAt: '2026-10-03T00:00:00Z', url: 'u3' },
];

const authors = () =>
  screen.getAllByText(/^@(alt|mitte|neu)$/).map((el) => el.textContent?.slice(1));

const before = (a: Node, b: Node) =>
  !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetWorkflowProvider();
  api.getWorkflowProvider.mockResolvedValue({
    name: 'Fake',
    apiVersion: 1,
    stages: [],
    sessionName: null,
    controls: { toggles: [{ label: 'wf:go', text: 'Freigeben', hint: 'h' }] },
  });
  api.fetchIssueDetails.mockResolvedValue({
    body: 'Body',
    subIssues: [{ id: 'S1', number: 8, title: 'Sub', state: 'OPEN', repo: 'o/r' }],
  });
  api.fetchIssueComments.mockResolvedValue(comments);
  api.fetchRepoOptions.mockResolvedValue({
    repositoryId: 'R',
    labels: [],
    assignees: [],
    milestones: [],
  });
});

describe.each(['sidebar', 'modal'] as const)('BoardItemPanel %s (#208 AC-1)', (variant) => {
  it('shows metadata, agents, PRs and sub-issues before body and comments', async () => {
    render(
      <BoardItemPanel
        variant={variant}
        item={item}
        items={[item]}
        options={[{ id: 'A', name: 'Todo', color: 'GRAY' }]}
        links={[{ jobId: 'job1', issueKey: 'o/r#7', via: 'pr' }]}
        sessionsById={new Map()}
        onClose={vi.fn()}
        onStatus={vi.fn()}
        onOpenKey={vi.fn()}
        onAttach={vi.fn()}
        onAgentIssues={vi.fn()}
        onStartAgent={vi.fn()}
        onOpenCode={vi.fn()}
        onSave={vi.fn()}
      />
    );
    await screen.findByText('@neu');
    const order = [
      screen.getByText('Testissue'), // title
      screen.getByDisplayValue('Todo'), // metadata: status select
      await screen.findByRole('button', { name: 'Freigeben' }), // FlowControls
      screen.getByText('Agents an diesem Issue'),
      screen.getByText('Pull Requests'),
      screen.getByText('Sub-Issues'),
      screen.getByText('Beschreibung'),
      screen.getByRole('region', { name: 'Kommentare' }),
    ];
    for (let i = 1; i < order.length; i++) expect(before(order[i - 1], order[i])).toBe(true);
  });
});

describe('IssueComments order (#208)', () => {
  it('AC-2/AC-3: default oldest first, toggle sorts newest first by createdAt', async () => {
    render(<IssueComments issueId="I_1" />);
    await screen.findByText('@neu');
    expect(authors()).toEqual(['alt', 'mitte', 'neu']);
    fireEvent.click(screen.getByRole('button', { name: /Älteste zuerst, umschalten/ }));
    expect(authors()).toEqual(['neu', 'mitte', 'alt']);
    expect(screen.getByRole('button', { name: /Neueste zuerst, umschalten/ })).toBeTruthy();
  });

  it('AC-3: choice survives remount and issue change', async () => {
    const first = render(<IssueComments issueId="I_1" />);
    await screen.findByText('@neu');
    fireEvent.click(screen.getByRole('button', { name: /umschalten/ }));
    expect(localStorage.getItem(ORDER_KEY)).toBe('1');
    first.unmount();
    render(<IssueComments issueId="I_2" />);
    await screen.findByText('@neu');
    expect(api.fetchIssueComments).toHaveBeenLastCalledWith('I_2');
    expect(authors()).toEqual(['neu', 'mitte', 'alt']);
  });

  it('AC-3: broken storage falls back to oldest first without error', async () => {
    const get = vi.spyOn(window.Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<IssueComments issueId="I_1" />);
    await screen.findByText('@neu');
    expect(authors()).toEqual(['alt', 'mitte', 'neu']);
    fireEvent.click(screen.getByRole('button', { name: /umschalten/ }));
    expect(authors()).toEqual(['neu', 'mitte', 'alt']);
    get.mockRestore();
    set.mockRestore();
  });

  it('AC-4: composer sits at the newest end; reply and send work in both modes', async () => {
    api.addIssueComment.mockResolvedValue(comments);
    render(<IssueComments issueId="I_1" />);
    await screen.findByText('@neu');
    for (const newest of [false, true]) {
      if (newest) fireEvent.click(screen.getByRole('button', { name: /umschalten/ }));
      const box = screen.getByLabelText('Neuer Kommentar') as HTMLTextAreaElement;
      const list = screen.getByRole('list');
      expect(before(box, list)).toBe(newest);
      fireEvent.click(screen.getAllByRole('button', { name: 'Antworten' })[0]);
      expect(box.value).toContain(newest ? '@neu' : '@alt');
      fireEvent.click(screen.getByRole('button', { name: 'Kommentieren' }));
      await screen.findByText('Kommentieren');
      expect(api.addIssueComment).toHaveBeenLastCalledWith('I_1', expect.any(String));
      expect(box.value).toBe('');
    }
  });
});

afterEach(cleanup);
