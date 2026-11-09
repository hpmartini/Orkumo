import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { AgentSession, IssueListResponse, RepoIssue } from '../types';
import { ConnectedIssuesPage, IssuesPage } from '../components/IssuesView';
import { PullRequestsDataContext } from '../components/AgentsView/PullRequestsPage';
import { fetchIssues } from '../services/issuesApi';

vi.mock('../services/issuesApi', () => ({ fetchIssues: vi.fn() }));
// The real modal loads the board; the page only has to hand over key and sessions
vi.mock('../components/BoardView/IssueModal', () => ({
  IssueModal: ({
    issueKey,
    sessions,
    onClose,
  }: {
    issueKey: string;
    sessions: AgentSession[];
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label={`Issue ${issueKey}`}>
      sessions: {sessions.length}
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

const issue = (number: number, patch: Partial<RepoIssue> = {}): RepoIssue => ({
  id: `I_${number}`,
  repo: 'o/r',
  number,
  title: `Issue ${number}`,
  url: `https://github.com/o/r/issues/${number}`,
  state: 'open',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: new Date().toISOString(),
  closedAt: null,
  author: 'hape',
  labels: [],
  assignees: [],
  milestone: null,
  comments: 0,
  onBoard: false,
  ...patch,
});

const response: IssueListResponse = {
  repos: ['o/r', 'o/other', 'o/broken'],
  issues: [
    issue(1, { onBoard: true, labels: [{ name: 'bug', color: 'd73a4a' }] }),
    issue(2, { repo: 'o/other', assignees: ['ana'], milestone: 'v1', comments: 4 }),
  ],
  errors: [{ repo: 'o/broken', message: 'GitHub: Could not resolve to a Repository' }],
};

const Location = () => {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname + search}</div>;
};

const renderPage = (ui: React.ReactElement, route = '/issues') =>
  render(ui, {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={[route]}>
        {children}
        <Location />
      </MemoryRouter>
    ),
  });

const rows = () => screen.queryAllByRole('button', { name: /^o\/\w+#\d+ / });

beforeEach(() => {
  vi.mocked(fetchIssues).mockReset();
  vi.mocked(fetchIssues).mockResolvedValue(response);
});

describe('IssuesPage', () => {
  it('lists the context issues with board badge and per-repo errors', async () => {
    renderPage(<IssuesPage active contextId="ctx" sessions={[]} />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(fetchIssues).toHaveBeenCalledWith('ctx', 'open', false);
    expect(screen.getByTestId('issues-count')).toHaveTextContent('2');
    expect(screen.getAllByText('Board', { selector: 'span' })).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'o/broken: GitHub: Could not resolve to a Repository'
    );
  });

  it('does not load while inactive', () => {
    renderPage(<IssuesPage active={false} sessions={[]} />);
    expect(fetchIssues).not.toHaveBeenCalled();
  });

  it('filters narrow the list and live in the URL', async () => {
    renderPage(<IssuesPage active sessions={[]} />);
    await waitFor(() => expect(rows()).toHaveLength(2));

    fireEvent.change(screen.getByRole('combobox', { name: 'Board' }), {
      target: { value: 'off' },
    });
    expect(rows().map((r) => r.getAttribute('aria-label'))).toEqual(['o/other#2 Issue 2']);
    expect(screen.getByTestId('issues-count')).toHaveTextContent('1 of 2');
    expect(screen.getByTestId('location')).toHaveTextContent('/issues?board=off');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search issues' }), {
      target: { value: 'nothing like this' },
    });
    expect(rows()).toHaveLength(0);
    expect(screen.getByText('No issues match')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Reset filters/ }));
    expect(rows()).toHaveLength(2);
  });

  it('switching to closed issues reloads with that state', async () => {
    renderPage(<IssuesPage active sessions={[]} />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.change(screen.getByRole('combobox', { name: 'State' }), {
      target: { value: 'closed' },
    });
    await waitFor(() => expect(fetchIssues).toHaveBeenLastCalledWith(undefined, 'closed', false));
    expect(screen.getByTestId('location')).toHaveTextContent('/issues?state=closed');
  });

  it('refresh bypasses the server cache', async () => {
    renderPage(<IssuesPage active sessions={[]} />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    await userEvent.click(screen.getByRole('button', { name: 'Refresh issues' }));
    expect(fetchIssues).toHaveBeenLastCalledWith(undefined, 'open', true);
  });

  it('a row opens the issue modal with the sessions from the PR data context', async () => {
    const sessions = [{ id: 's1' }, { id: 's2' }] as AgentSession[];
    renderPage(
      <PullRequestsDataContext.Provider value={{ sessions } as never}>
        <ConnectedIssuesPage active />
      </PullRequestsDataContext.Provider>
    );
    await waitFor(() => expect(rows()).toHaveLength(2));
    const row = screen.getByRole('button', { name: 'o/other#2 Issue 2' });
    row.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Issue o/other#2' })).toHaveTextContent(
      'sessions: 2'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(row).toHaveFocus();
  });
});
