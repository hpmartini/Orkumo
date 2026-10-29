import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { AgentPullRequest, AgentSession } from '../types';
import type { PullRequestRow } from '../utils/agentSessions';
import { PullRequestsPanel } from '../components/AgentsView/PullRequestsPanel';
import { PullRequestsPage } from '../components/AgentsView/PullRequestsPage';

// The embedded browser talks to Electron; the pane only needs to show which URL it got
vi.mock('../components/CodingView/BrowserPreviewPanel', () => ({
  BrowserPreviewPanel: ({ url }: { url: string }) => <div data-testid="pr-pane">{url}</div>,
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
  it('AC-2: renders all PRs with count, repo filter and code buttons', () => {
    const { rerender } = render(<PullRequestsPage {...listProps} />);
    expect(screen.getByText('Open pull requests')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Code/ })).toHaveLength(3);
    rerender(<PullRequestsPage {...listProps} repoFilter="o/other" />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.queryByText('PR 1')).not.toBeInTheDocument();
    expect(screen.getByText('PR 3')).toBeInTheDocument();
  });

  it('AC-2: agent and code buttons call their handlers', () => {
    const onSelectAgent = vi.fn();
    const onOpenCode = vi.fn();
    const agentRows = [{ pr: pr(1), agents: [{ id: 'a1', name: 'Agent One' } as AgentSession] }];
    render(
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
    render(<PullRequestsPage {...listProps} />);
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
    render(<PullRequestsPage {...listProps} />);
    fireEvent.click(screen.getByRole('button', { name: /PR 1$/ }));
    const pane = screen.getByTestId('pr-pane').closest('div.rounded') as HTMLElement;
    fireEvent.click(within(pane).getByRole('button', { name: 'Close browser' }));
    expect(screen.queryByTestId('pr-pane')).not.toBeInTheDocument();
  });

  it('AC-5: without Electron a PR opens in a new tab, no pane', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<PullRequestsPage {...listProps} />);
    fireEvent.click(screen.getByRole('button', { name: /PR 1$/ }));
    expect(open).toHaveBeenCalledWith(rows[0].pr.url, '_blank', 'noopener,noreferrer');
    expect(screen.queryByTestId('pr-pane')).not.toBeInTheDocument();
  });

  it('keeps an external link icon next to each PR', () => {
    render(<PullRequestsPage {...listProps} />);
    expect(screen.getByRole('link', { name: 'Open #1 in browser' })).toHaveAttribute(
      'href',
      rows[0].pr.url
    );
  });
});
