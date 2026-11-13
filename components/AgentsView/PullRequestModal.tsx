import React, { useRef, useState } from 'react';
import { ExternalLink, GitPullRequest, List, X } from 'lucide-react';
import type { AgentPrLink } from '../../types';
import { useDialogA11y } from '../CommandPalette/useDialogA11y';
import { BrowserPane } from './AgentWorkspace';
import { PullRequestList, type PullRequestListProps } from './PullRequestsPanel';

const noop = () => {};
const embeddable = (href: string) => href.startsWith('https://github.com/');

/**
 * The pull request(s) behind one PR pill as a modal over the current view, like IssueModal for
 * issue pills. The overview of all open PRs stays behind the "open PRs" chip of the summary bar.
 * In the desktop app the PR page loads in the built-in browser; a plain browser cannot frame GitHub.
 */
export const PullRequestModal: React.FC<
  Pick<PullRequestListProps, 'rows' | 'contexts' | 'onSelectAgent' | 'onOpenCode'> & {
    /** PR links of the clicked session */
    links: AgentPrLink[];
    onOpenOverview: () => void;
    onClose: () => void;
  }
> = ({ links, rows, contexts, onSelectAgent, onOpenCode, onOpenOverview, onClose }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const trapTab = useDialogA11y(true, dialogRef, () =>
    dialogRef.current?.querySelector<HTMLElement>('button[aria-label="Close"]')
  );
  const canEmbed = typeof window !== 'undefined' && !!window.electronAPI?.browserView;
  const [url, setUrl] = useState(links.map((l) => l.href).find(embeddable) ?? null);
  const open = rows.filter((r) => links.some((l) => l.href === r.pr.url));
  // Merged or closed PRs are not among the open rows; they keep what the session reports
  const rest = links.filter((l) => !open.some((r) => r.pr.url === l.href));
  const prefix = (l: AgentPrLink) => (l.provider === 'gitlab' ? '!' : '#');
  const title =
    links.length === 1
      ? `Pull request ${links[0].number ? `${prefix(links[0])}${links[0].number}` : ''}`.trim()
      : `${links.length} pull requests`;
  const embed = canEmbed && !!url;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={(e) => {
          trapTab(e);
          if (e.key === 'Escape' && !e.defaultPrevented) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        className={`outline-none flex flex-col min-h-0 max-h-full rounded-lg border border-gray-700 bg-gray-900 shadow-2xl ${
          embed ? 'w-[min(1200px,96vw)] h-[88vh]' : 'w-[min(720px,96vw)]'
        }`}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 shrink-0 text-sm">
          <GitPullRequest size={14} className="text-gray-400" aria-hidden />
          <h2 className="font-medium text-gray-100">{title}</h2>
          <div className="flex-1" />
          <button
            onClick={() => {
              onClose();
              onOpenOverview();
            }}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-300 hover:text-white hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
          >
            <List size={13} aria-hidden /> All open PRs
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
            aria-label="Close"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>
        <div className="shrink-0 max-h-[40vh] overflow-y-auto thin-scrollbar">
          {open.length > 0 && (
            <PullRequestList
              rows={open}
              // no sessions: "unavailable" notes of other repositories do not belong here
              sessions={[]}
              contexts={contexts}
              repoFilter={null}
              onSelectAgent={onSelectAgent}
              onOpenCode={onOpenCode}
              onOpenPr={canEmbed ? (pr) => embeddable(pr.url) && setUrl(pr.url) : undefined}
              openUrl={embed && links.length > 1 ? url : null}
              onDone={onClose}
            />
          )}
          {rest.length > 0 && (
            <ul className="divide-y divide-gray-800 border-t border-gray-800 first:border-t-0">
              {rest.map((l) => (
                <li key={l.id} className="flex items-center gap-2 min-w-0 px-3 py-2 text-xs">
                  {canEmbed && embeddable(l.href) ? (
                    <button
                      onClick={() => setUrl(l.href)}
                      aria-current={(links.length > 1 && url === l.href) || undefined}
                      className="flex items-center gap-1 min-w-0 text-left text-gray-100 hover:text-blue-300 hover:underline"
                    >
                      {l.number && (
                        <span className="font-mono shrink-0">{`${prefix(l)}${l.number}`}</span>
                      )}
                      <span className="truncate">{l.title || l.href}</span>
                    </button>
                  ) : (
                    <span className="flex items-center gap-1 min-w-0 text-gray-100">
                      {l.number && (
                        <span className="font-mono shrink-0">{`${prefix(l)}${l.number}`}</span>
                      )}
                      <span className="truncate">{l.title || l.href}</span>
                    </span>
                  )}
                  {l.state && (
                    <span className="px-1 rounded border border-gray-600 text-gray-400 shrink-0">
                      {l.state}
                    </span>
                  )}
                  <a
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-gray-400 hover:text-blue-300"
                    title="Open in browser"
                    aria-label={`Open ${l.number ? `${prefix(l)}${l.number}` : 'pull request'} in browser`}
                  >
                    <ExternalLink size={11} />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        {embed && (
          <div className="flex-1 min-h-0 p-1 border-t border-gray-800">
            <BrowserPane url={url} active onFocus={noop} onClose={onClose} />
          </div>
        )}
      </div>
    </div>
  );
};
