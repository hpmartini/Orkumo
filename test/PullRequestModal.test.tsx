// MAGOS#497: a PR pill opens exactly its pull request(s) as a modal, not the overview of the repo
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { AgentPrLink, AgentPullRequest } from '../types';
import type { PullRequestRow } from '../utils/agentSessions';
import { PullRequestModal } from '../components/AgentsView/PullRequestModal';
import { PrPill } from '../components/AgentsView/SessionLinks';

// The embedded browser talks to Electron; the pane only needs to show which URL it got
vi.mock('../components/CodingView/BrowserPreviewPanel', () => ({
  BrowserPreviewPanel: ({ url }: { url: string }) => <div data-testid="pr-pane">{url}</div>,
}));

const pr = (number: number): AgentPullRequest => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
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
  repoSlug: 'o/r',
});
const link = (number: number, state: string | null = 'open'): AgentPrLink => ({
  id: `pr${number}`,
  href: `https://github.com/o/r/pull/${number}`,
  title: `Link ${number}`,
  number,
  provider: 'github',
  state,
});
const rows: PullRequestRow[] = [1, 2, 3].map((n) => ({ pr: pr(n), agents: [] }));

const electron = (on: boolean) => {
  (window as unknown as { electronAPI?: unknown }).electronAPI = on
    ? { browserView: {} }
    : undefined;
};
afterEach(() => electron(false));

const open = (links: AgentPrLink[]) => {
  const handlers = { onOpenOverview: vi.fn(), onClose: vi.fn() };
  render(
    <PullRequestModal
      links={links}
      rows={rows}
      contexts={{ s1: {} } as never}
      onSelectAgent={vi.fn()}
      onOpenCode={vi.fn()}
      {...handlers}
    />
  );
  return handlers;
};

describe('PrPill', () => {
  it('hands the links of its session to onOpenPr instead of opening the repo overview', () => {
    const onOpenPr = vi.fn();
    render(<PrPill session={{ links: [link(2)] }} onOpenPr={onOpenPr} />);
    fireEvent.click(screen.getByRole('button', { name: /#2/ }));
    expect(onOpenPr).toHaveBeenCalledWith([link(2)]);
  });
});

describe('PullRequestModal', () => {
  it('shows only the clicked pull request, with its status', () => {
    open([link(2)]);
    const dialog = screen.getByRole('dialog', { name: 'Pull request #2' });
    expect(within(dialog).getByText('PR 2')).toBeInTheDocument();
    expect(within(dialog).queryByText('PR 1')).toBeNull();
    expect(within(dialog).queryByText('PR 3')).toBeNull();
    expect(within(dialog).getByText('feat/2 to main')).toBeInTheDocument();
    // a plain browser cannot frame GitHub
    expect(screen.queryByTestId('pr-pane')).toBeNull();
  });

  it('desktop app: loads that PR in the built-in browser', () => {
    electron(true);
    open([link(2)]);
    expect(screen.getByTestId('pr-pane')).toHaveTextContent('https://github.com/o/r/pull/2');
  });

  it('a merged PR that is no longer among the open ones is still shown', () => {
    electron(true);
    open([link(9, 'merged')]);
    const dialog = screen.getByRole('dialog', { name: 'Pull request #9' });
    expect(within(dialog).getByText('Link 9')).toBeInTheDocument();
    expect(within(dialog).getByText('merged')).toBeInTheDocument();
    expect(screen.getByTestId('pr-pane')).toHaveTextContent('https://github.com/o/r/pull/9');
  });

  it('several PRs of one session: lists them, the clicked one loads', () => {
    electron(true);
    open([link(1), link(3)]);
    const dialog = screen.getByRole('dialog', { name: '2 pull requests' });
    expect(within(dialog).queryByText('PR 2')).toBeNull();
    expect(screen.getByTestId('pr-pane')).toHaveTextContent('/pull/1');
    fireEvent.click(within(dialog).getByRole('button', { name: /PR 3/ }));
    expect(screen.getByTestId('pr-pane')).toHaveTextContent('/pull/3');
  });

  it('"All open PRs" closes the modal and opens the overview; Escape only closes', () => {
    const h = open([link(2)]);
    fireEvent.click(screen.getByRole('button', { name: /All open PRs/ }));
    expect(h.onOpenOverview).toHaveBeenCalledTimes(1);
    expect(h.onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(h.onClose).toHaveBeenCalledTimes(2);
    expect(h.onOpenOverview).toHaveBeenCalledTimes(1);
  });
});
