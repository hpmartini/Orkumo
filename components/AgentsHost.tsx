/**
 * Orkumo's side of the agents view (`@hpmartini/agents-ui`): its transport and everything the
 * view asks of the app around it — router navigation, toasts, the command palette, the board,
 * the Coding view's browser, the Ghostty terminal look and the Electron quick window.
 */
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  AgentsProvider,
  type AgentIssues,
  type AgentSession,
  type AgentsHost,
  type IssueCreateProps,
} from '@hpmartini/agents-ui';
import { pollWhileVisible } from '@hpmartini/agents-ui/utils/visiblePoll';
import { orkumoTransport } from '../services/agentsTransport';
import { fetchBoard, fetchRepoPath } from '../services/boardApi';
import { deriveAgentLinks, itemKey, linksByAgent } from '../utils/board';
import { boardUrl, codeUrl, modeUrl, pullsUrl } from '../utils/codeTarget';
import { useWorkflowProvider } from '../hooks/useWorkflowProvider';
import { DEFAULT_TERMINAL_OPTIONS, useGhosttyTheme, withGhostty } from '../hooks/useGhosttyTheme';
import { useCommandPalette, useRegisterCommands } from './CommandPalette';
import { openProjectSettings } from './ProjectsSettings';
import { IssueModal } from './BoardView/IssueModal';
import { IssueCreateModal, lastIssueRepo } from './BoardView/IssueCreateModal';
import { BrowserPreviewPanel } from './CodingView/BrowserPreviewPanel';
import type { BoardData } from '../types';

/** Board issue chips are a nice-to-have: refetch at most this often while the view is shown */
const BOARD_REFRESH_MS = 60_000;

// The board as the agents view last loaded it; the issue dialog reads its status options
let board: BoardData | null = null;
const boardListeners = new Set<() => void>();
const subscribeBoard = (listener: () => void) => {
  boardListeners.add(listener);
  return () => boardListeners.delete(listener);
};
const useBoard = () => useSyncExternalStore(subscribeBoard, () => board);

/** Agent -> board issue chips; board fetch failures are ignored so /agents never breaks */
function useAgentIssues(sessions: AgentSession[]): AgentIssues {
  useEffect(() => {
    // server caches the board ~60 s
    const load = () =>
      fetchBoard()
        .then((data) => {
          board = data;
          boardListeners.forEach((l) => l());
        })
        .catch(() => {});
    return pollWhileVisible(load, BOARD_REFRESH_MS);
  }, []);
  const current = useBoard();
  const issueLinks = useMemo(
    () => (current ? deriveAgentLinks(current.items, sessions) : undefined),
    [current, sessions]
  );
  const byAgent = useMemo(() => issueLinks && linksByAgent(issueLinks), [issueLinks]);
  const workflowIssues = useMemo(
    () =>
      new Map(
        (issueLinks || []).filter((l) => l.via === 'workflow').map((l) => [l.jobId, l.issueKey])
      ),
    [issueLinks]
  );
  const titles = useMemo(
    () => new Map((current?.items || []).map((item) => [itemKey(item), item.title])),
    [current]
  );
  const provider = useWorkflowProvider();
  const workflowName = useMemo(() => {
    try {
      return provider?.sessionName ? new RegExp(provider.sessionName) : null;
    } catch {
      return null;
    }
  }, [provider]);
  return useMemo(
    () => ({ byAgent, workflowIssues, titles, workflowName }),
    [byAgent, workflowIssues, titles, workflowName]
  );
}

const usePaletteOpen = () => useCommandPalette().isOpen;

const AgentIssueCreate: React.FC<IssueCreateProps> = ({
  repo,
  repos,
  draft,
  onKindChange,
  onClose,
}) => {
  const navigate = useNavigate();
  const current = useBoard();
  return (
    <IssueCreateModal
      repo={repo || lastIssueRepo(repos)}
      repos={repos}
      draft={draft}
      onKindChange={onKindChange}
      statusOptions={current?.statusField.options}
      onClose={onClose}
      onCreated={(item) => {
        const key = `${item.repo}#${item.number}`;
        toast(
          (t) => (
            <span className="text-xs">
              {`${key} created`}
              <button
                onClick={() => {
                  toast.dismiss(t.id);
                  navigate(`/board?item=${encodeURIComponent(key)}`);
                }}
                className="ml-3 text-cursor hover:underline underline-offset-2"
              >
                Open in board
              </button>
            </span>
          ),
          { duration: 8000 }
        );
      }}
    />
  );
};

/** The window title the agents view replaced, restored when it hands the title back */
let titleBeforeView: string | null = null;

/** Built-in browser pane: the Coding view's preview (Electron BrowserView, else an iframe) */
export const renderOrkumoBrowser: NonNullable<AgentsHost['renderBrowser']> = ({
  url,
  onClose,
  closeLabel,
  dragHandleProps,
  actions,
}) => (
  // No app id: the preview's logger injection is per managed app
  <BrowserPreviewPanel
    url={url}
    appId=""
    onHide={onClose}
    closeLabel={closeLabel}
    dragHandleProps={dragHandleProps}
    actions={actions}
  />
);

/**
 * Transport and host for every agents-ui component below (the view, the dashboard's agent
 * overview, the board, the Chats route, the quick window). Inside the router and the palette.
 */
export const OrkumoAgentsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const ghostty = useGhosttyTheme();
  const terminalOptions = useMemo(() => withGhostty(DEFAULT_TERMINAL_OPTIONS, ghostty), [ghostty]);
  // Created once: the callbacks read the latest navigate through the ref
  const [host] = useState<Omit<AgentsHost, 'terminalOptions'>>(() => ({
    toast: {
      info: (message, options) => toast(message, options),
      success: (message, options) => toast.success(message, options),
      error: (message, options) => toast.error(message, options),
      dismiss: (id) => toast.dismiss(id),
    },
    openCode: (folder) => navigateRef.current(codeUrl(folder)),
    openBoard: (repoSlug, sessionId) => navigateRef.current(boardUrl(repoSlug, sessionId)),
    openMode: (modeId, repoSlug, sessionId) =>
      navigateRef.current(modeUrl(modeId)(repoSlug, sessionId)),
    openPulls: (repo) => navigateRef.current(pullsUrl(repo)),
    openProjectSettings,
    fetchRepoPath,
    useRegisterCommands,
    usePaletteOpen,
    onAttention: (title) => {
      if (title === null) {
        if (titleBeforeView !== null) document.title = titleBeforeView;
        titleBeforeView = null;
        return;
      }
      titleBeforeView ??= document.title;
      document.title = title;
    },
    useIssues: useAgentIssues,
    renderIssueModal: (props) => <IssueModal {...props} />,
    renderIssueCreate: (props) => <AgentIssueCreate {...props} />,
    onQuickPrompt: (listener) => window.electronAPI?.onQuickPrompt?.(listener) ?? (() => {}),
    onQuickChat: (listener) => window.electronAPI?.onQuickChat?.(listener) ?? (() => {}),
    renderBrowser: renderOrkumoBrowser,
  }));
  const value = useMemo(() => ({ ...host, terminalOptions }), [host, terminalOptions]);
  return (
    <AgentsProvider transport={orkumoTransport} host={value}>
      {children}
    </AgentsProvider>
  );
};
