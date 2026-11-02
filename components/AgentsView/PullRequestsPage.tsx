import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { AgentPullRequest } from '../../types';
import { BrowserPane } from './AgentWorkspace';
import {
  PullRequestList,
  PullRequestsHeader,
  filterPullRows,
  type PullRequestListProps,
} from './PullRequestsPanel';
import { getLinkTarget, openLink } from '../../utils/links';

export interface PullRequestsPageProps extends Omit<
  PullRequestListProps,
  'onOpenPr' | 'openUrl' | 'onDone'
> {
  onClearRepo: () => void;
}

/** PR data and handlers, provided by AgentsView around the main area of the other routes */
export const PullRequestsDataContext = createContext<PullRequestsPageProps | null>(null);

/** /pulls container in App.tsx: reads the PR data AgentsView already holds (no second data path) */
export const ConnectedPullRequestsPage: React.FC = () => {
  const data = useContext(PullRequestsDataContext);
  return data ? <PullRequestsPage {...data} /> : null;
};

const noop = () => {};

/**
 * Full view of the open PRs (route /pulls). A PR opens in one split pane to the right;
 * the next PR replaces it. Without Electron GitHub refuses to be framed, so PRs open in a tab.
 */
export const PullRequestsPage: React.FC<PullRequestsPageProps> = ({ onClearRepo, ...list }) => {
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  const canEmbed = typeof window !== 'undefined' && !!window.electronAPI?.browserView;
  const viewRef = useRef<HTMLDivElement>(null);

  // Arriving from the popover: its trigger is hidden here, so focus lands on the view
  useEffect(() => viewRef.current?.focus(), []);

  const openPr = (pr: AgentPullRequest) => {
    if (!pr.url.startsWith('https://')) return;
    // Only GitHub pages load in the embedded browser; narrow windows (md breakpoint) and other hosts open externally
    if (
      canEmbed &&
      getLinkTarget() === 'builtin' &&
      pr.url.startsWith('https://github.com/') &&
      window.innerWidth >= 768
    ) {
      setOpenUrl(pr.url);
    } else openLink(pr.url);
  };

  return (
    <div
      ref={viewRef}
      tabIndex={-1}
      aria-label="Open pull requests"
      className="absolute inset-0 flex flex-col min-h-0 bg-gray-900 outline-none"
      data-pulls-view
    >
      {/* The list panel stays mounted when the pane opens or closes, so scroll and focus survive */}
      <Group orientation="horizontal" className="h-full w-full">
        {/* v4: plain numbers are pixels, so sizes are given in percent */}
        <Panel id="pulls-list" minSize="20%" defaultSize="40%" className="min-h-0 min-w-0">
          <div className="h-full flex flex-col min-h-0">
            <PullRequestsHeader
              count={filterPullRows(list.rows, list.repoFilter).length}
              repoFilter={list.repoFilter}
              onClearRepo={onClearRepo}
            />
            <div className="flex-1 overflow-y-auto min-h-0">
              <PullRequestList {...list} onOpenPr={openPr} openUrl={openUrl} />
            </div>
          </div>
        </Panel>
        {openUrl && (
          <>
            <Separator className="w-1 cursor-col-resize bg-gray-800 hover:bg-blue-500/50 transition-colors" />
            <Panel id="pulls-pr" minSize="20%" className="min-h-0 min-w-0 p-1">
              <BrowserPane url={openUrl} active onFocus={noop} onClose={() => setOpenUrl(null)} />
            </Panel>
          </>
        )}
      </Group>
    </div>
  );
};
