import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { AgentPullRequest, AgentSession } from '../types';
import type { PullRequestRow } from '../utils/agentSessions';
import { PullRequestsPanel } from '../components/AgentsView/PullRequestsPanel';
import {
  ConnectedPullRequestsPage,
  PullRequestsDataContext,
  PullRequestsPage,
} from '../components/AgentsView/PullRequestsPage';

// The embedded browser talks to Electron; the pane only needs to show which URL it got
vi.mock('../components/CodingView/BrowserPreviewPanel', () => ({
  BrowserPreviewPanel: ({
    url,
    onHide,
    closeLabel,
  }: {
    url: string;
    onHide?: () => void;
    closeLabel?: string;
  }) => (
    <div data-testid="pr-pane">
      {url}
      <button onClick={onHide}>{closeLabel}</button>
    </div>
  ),
}));

const pr = (number: number, repoSlug = 'o/r'): AgentPullRequest => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/${repoSlug}/pull/${number}`,
  author: 'hape',
  isDraft: false,
  headRef: `feat/${number}`,
  baseRef: 'main',
  updatedAt: new Date().toISOString(),
  reviewDecision: null,
  mergeable: 'MERGEABLE',
  ci: 'success',
  ciPassed: 1,
  ciFailed: 0,
  ciPending: 0,
  mergeReady: true,
  repoSlug,
});

const rows: PullRequestRow[] = [
  { pr: pr(1), agents: [] },
  { pr: pr(2), agents: [] },
  { pr: pr(3, 'o/other'), agents: [] },
];
const session = { id: 's1' } as AgentSession;
// A non-empty contexts map means "loaded"
const listProps = {
  rows,
  sessions: [session],
  contexts: { s1: { repo: { slug: 'o/r' }, pulls: [] } } as never,
  repoFilter: null,
  onSelectAgent: vi.fn(),
  onOpenCode: vi.fn(),
  onClearRepo: vi.fn(),
};

const electron = (on: boolean) => {
  (window as unknown as { electronAPI?: unknown }).electronAPI = on
    ? { browserView: {} }
    : undefined;
};

const Location = () => {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname + search}</div>;
};

/** /pulls keeps its filters in the URL, so the page renders inside a router */
const renderPage = (ui: React.ReactElement, route = '/pulls') =>
  render(ui, {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={[route]}>
        {children}
        <Location />
      </MemoryRouter>
    ),
  });

afterEach(() => {
  electron(false);
  vi.restoreAllMocks();
});

describe('PullRequestsPanel (popover)', () => {
  it('AC-1: maximize button opens the full view and closes the popover', () => {
    const onMaximize = vi.fn();
    const onClose = vi.fn();
    render(<PullRequestsPanel {...listProps} onMaximize={onMaximize} onClose={onClose} />);
    const button = screen.getByRole('button', { name: 'Maximize pull requests' });
    expect(button).toHaveAttribute('title', 'Open as full view');
    fireEvent.click(button);
    expect(onMaximize).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps PR titles as external links in the popover', () => {
    render(<PullRequestsPanel {...listProps} onMaximize={vi.fn()} onClose={vi.fn()} />);
    const link = screen.getByRole('link', { name: /PR 1$/ });
    expect(link).toHaveAttribute('href', rows[0].pr.url);
    expect(link).toHaveAttribute('target', '_blank');
  });
});

describe('PullRequestsPage (/pulls)', () => {
  it('AC-2: renders all PRs with count, repo filter (from the URL) and code buttons', () => {
    const { unmount } = renderPage(<PullRequestsPage {...listProps} />);
    expect(screen.getByText('Open pull requests')).toBeInTheDocument();
    expect(screen.getByTestId('pulls-count')).toHaveTextContent(/^3$/);
    expect(screen.getAllByRole('button', { name: /Code/ })).toHaveLength(3);
    unmount();
    renderPage(<PullRequestsPage {...listProps} />, '/pulls?repo=o/other');
    expect(screen.getByTestId('pulls-count')).toHaveTextContent('1 of 3');
    expect(screen.queryByText('PR 1')).not.toBeInTheDocument();
    expect(screen.getByText('PR 3')).toBeInTheDocument();
  });

  it('AC-2: agent and code buttons call their handlers', () => {
    const onSelectAgent = vi.fn();
    const onOpenCode = vi.fn();
    const agentRows = [{ pr: pr(1), agents: [{ id: 'a1', name: 'Agent One' } as AgentSession] }];
    renderPage(
      <PullRequestsPage
        {...listProps}
        rows={agentRows}
        onSelectAgent={onSelectAgent}
        onOpenCode={onOpenCode}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Agent One' }));
    expect(onSelectAgent).toHaveBeenCalledWith('a1');
    fireEvent.click(screen.getByRole('button', { name: /Code/ }));
    expect(onOpenCode).toHaveBeenCalledWith(agentRows[0]);
  });

  it('AC-3: a PR opens one pane, the next PR replaces it', () => {
    electron(true);
    renderPage(<PullRequestsPage {...listProps} />);
    expect(screen.queryByTestId('pr-pane')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /PR 1$/ }));
    expect(screen.getAllByTestId('pr-pane')).toHaveLength(1);
    expect(screen.getByTestId('pr-pane')).toHaveTextContent(rows[0].pr.url);
    fireEvent.click(screen.getByRole('button', { name: /PR 2$/ }));
    expect(screen.getAllByTestId('pr-pane')).toHaveLength(1);
    expect(screen.getByTestId('pr-pane')).toHaveTextContent(rows[1].pr.url);
    expect(screen.getByRole('button', { name: /PR 2$/ })).toHaveAttribute('aria-current', 'true');
  });

  it('AC-4: closing the pane removes it', () => {
    electron(true);
    renderPage(<PullRequestsPage {...listProps} />);
    fireEvent.click(screen.getByRole('button', { name: /PR 1$/ }));
    const pane = screen.getByTestId('pr-pane').closest('div.rounded') as HTMLElement;
    fireEvent.click(within(pane).getByRole('button', { name: 'Close browser' }));
    expect(screen.queryByTestId('pr-pane')).not.toBeInTheDocument();
  });

  it('AC-5: without Electron a PR opens in a new tab, no pane', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderPage(<PullRequestsPage {...listProps} />);
    fireEvent.click(screen.getByRole('button', { name: /PR 1$/ }));
    expect(open).toHaveBeenCalledWith(rows[0].pr.url, '_blank', 'noopener,noreferrer');
    expect(screen.queryByTestId('pr-pane')).not.toBeInTheDocument();
  });

  it('App.tsx container renders the page from the AgentsView context, nothing without it', () => {
    const { rerender } = renderPage(<ConnectedPullRequestsPage />);
    expect(screen.queryByText('Open pull requests')).not.toBeInTheDocument();
    rerender(
      <PullRequestsDataContext.Provider value={listProps}>
        <ConnectedPullRequestsPage />
      </PullRequestsDataContext.Provider>
    );
    expect(screen.getByText('Open pull requests')).toBeInTheDocument();
    expect(screen.getByText('PR 1')).toBeInTheDocument();
  });

  it('focuses the view on arrival and keeps the list mounted when the pane opens and closes', () => {
    electron(true);
    renderPage(<PullRequestsPage {...listProps} />);
    expect(document.activeElement).toHaveAttribute('data-pulls-view');
    const list = screen.getByText('PR 3').closest('ul, div.overflow-y-auto');
    fireEvent.click(screen.getByRole('button', { name: /PR 1$/ }));
    expect(screen.getByText('PR 3').closest('ul, div.overflow-y-auto')).toBe(list);
    fireEvent.click(screen.getByRole('button', { name: 'Close browser' }));
    expect(screen.getByText('PR 3').closest('ul, div.overflow-y-auto')).toBe(list);
  });

  it('embeds only https://github.com/, opens other https hosts externally, ignores the rest', () => {
    electron(true);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const other = [
      { pr: { ...pr(8), url: 'https://ghe.example/o/r/pull/8' }, agents: [] },
      { pr: { ...pr(9), url: 'javascript:alert(1)' }, agents: [] },
    ];
    renderPage(<PullRequestsPage {...listProps} rows={other} />);
    fireEvent.click(screen.getByRole('button', { name: /PR 8$/ }));
    expect(open).toHaveBeenCalledWith(other[0].pr.url, '_blank', 'noopener,noreferrer');
    fireEvent.click(screen.getByRole('button', { name: /PR 9$/ }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('pr-pane')).not.toBeInTheDocument();
  });

  it('narrow Electron window (< md) opens the PR externally, no split', () => {
    electron(true);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(500);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderPage(<PullRequestsPage {...listProps} />);
    fireEvent.click(screen.getByRole('button', { name: /PR 1$/ }));
    expect(open).toHaveBeenCalledWith(rows[0].pr.url, '_blank', 'noopener,noreferrer');
    expect(screen.queryByTestId('pr-pane')).not.toBeInTheDocument();
  });

  it('keeps an external link icon next to each PR', () => {
    renderPage(<PullRequestsPage {...listProps} />);
    expect(screen.getByRole('link', { name: 'Open #1 in browser' })).toHaveAttribute(
      'href',
      rows[0].pr.url
    );
  });
});

describe('/pulls filters, clusters and sorting (#191)', () => {
  const agentOne = { id: 'a1', name: 'Agent One' } as AgentSession;
  const richRows: PullRequestRow[] = [
    { pr: { ...pr(1), title: 'Fix login', author: 'alice' }, agents: [agentOne] },
    { pr: { ...pr(2), ci: 'failure', mergeReady: false }, agents: [] },
    { pr: pr(3, 'o/other'), agents: [] },
  ];
  // Through the App.tsx container, as the route renders it
  const page = (route = '/pulls') =>
    renderPage(
      <PullRequestsDataContext.Provider value={{ ...listProps, rows: richRows }}>
        <ConnectedPullRequestsPage />
      </PullRequestsDataContext.Provider>,
      route
    );
  const titles = () => screen.queryAllByRole('button', { name: /^#\d+/ }).map((b) => b.textContent);
  const select = (label: string, value: string) =>
    fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value } });
  const location = () => screen.getByTestId('location').textContent;

  it('AC-5: filters narrow the list and the count, reset restores everything', () => {
    page();
    expect(titles()).toHaveLength(3);
    select('CI', 'failure');
    expect(titles()).toEqual(['#2PR 2']);
    expect(screen.getByTestId('pulls-count')).toHaveTextContent('1 of 3');
    select('CI', '');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search pull requests' }), {
      target: { value: 'alice' },
    });
    expect(titles()).toEqual(['#1Fix login']);
    select('Has agent', 'no');
    expect(screen.getByText('No pull requests match the filters.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Reset filters/ }));
    expect(titles()).toHaveLength(3);
    expect(screen.getByTestId('pulls-count')).toHaveTextContent(/^3$/);
    expect(screen.queryByRole('button', { name: /Reset filters/ })).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Search pull requests' })).toHaveFocus();
  });

  it('AC-5: clustering shows a header with the count per group', () => {
    page();
    select('Group by', 'repo');
    const other = screen.getByRole('region', { name: 'o/other (1)' });
    const main = screen.getByRole('region', { name: 'o/r (2)' });
    expect(within(other).getByText('PR 3')).toBeInTheDocument();
    expect(within(main).getByText('Fix login')).toBeInTheDocument();
    select('Group by', 'agent');
    expect(screen.getByRole('region', { name: 'Agent One (1)' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'No agent (2)' })).toBeInTheDocument();
  });

  it('AC-5: sort select and direction button reorder the list', () => {
    page();
    select('Sort by', 'number');
    expect(titles()).toEqual(['#3PR 3', '#2PR 2', '#1Fix login']);
    fireEvent.click(screen.getByRole('button', { name: 'Sort descending' }));
    expect(titles()).toEqual(['#1Fix login', '#2PR 2', '#3PR 3']);
    expect(screen.getByRole('button', { name: 'Sort ascending' })).toBeInTheDocument();
  });

  it('AC-6: the state is written to the URL and restored from it', () => {
    const { unmount } = page();
    select('Merge', 'blocked');
    select('Group by', 'repo');
    select('Sort by', 'title');
    fireEvent.click(screen.getByRole('button', { name: 'Sort descending' }));
    const url = location()!;
    expect(url).toBe('/pulls?merge=blocked&group=repo&sort=title&dir=asc');
    unmount();
    page(url);
    expect(screen.getByRole('combobox', { name: 'Merge' })).toHaveValue('blocked');
    expect(screen.getByRole('combobox', { name: 'Group by' })).toHaveValue('repo');
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('title');
    expect(screen.getByRole('region', { name: 'o/r (1)' })).toBeInTheDocument();
    expect(titles()).toEqual(['#2PR 2']);
  });

  it('AC-6: the repo filter of the popover arrives as ?repo= and is clearable', () => {
    page('/pulls?repo=o%2Fother');
    expect(screen.getByRole('combobox', { name: 'Repo' })).toHaveValue('o/other');
    expect(titles()).toEqual(['#3PR 3']);
    select('Repo', '');
    expect(location()).toBe('/pulls');
    expect(titles()).toHaveLength(3);
  });
});
