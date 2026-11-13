import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Bot,
  Settings,
  Settings2,
  HelpCircle,
  RefreshCw,
  Braces,
  AlertTriangle,
  Power,
  X,
  ArrowLeft,
} from 'lucide-react';
import type { AgentConfigLike } from './types';
import type {
  AgentSession,
  AgentHarness,
  AgentSubagent,
  AgentRepo,
  AgentSlashCommand,
  AgentPastSession,
  AgentPrLink,
} from '../../types';
import { useAgentSessions } from '../../hooks/useAgentSessions';
import { useAgentWorkspace, type PaneView } from '../../hooks/useAgentWorkspace';
import { getAgentTarget, pinTarget, targetOf, useAgentTarget } from '../../utils/agentTarget';
import { useAgentContexts } from '../../hooks/useAgentContexts';
import { useWorkflowProvider } from '../../hooks/useWorkflowProvider';
import {
  useRailPreferences,
  groupNeighbour,
  isFoldedAway,
  FAVORITES_GROUP_KEY,
} from '../../hooks/useRailPreferences';
import { FOCUS_CHORD_LABEL, useAgentFocusZone } from '../../hooks/useAgentFocusZone';
import {
  dispatchAgent,
  fetchAgentsRawJson,
  fetchSubagents,
  fetchAgentRepos,
  fetchAgentCommands,
  pinAgent,
  renameAgent,
  reorderAgents,
  removeAgent,
  replyToAgent,
  respawnAgent,
  stopAgent,
  stopPane,
  sendToPane,
  openCloudSession,
  uploadAgentImage,
  fetchHarnesses,
} from '../../services/agentsApi';
import { useStoredToggle } from '../../hooks/useStoredToggle';
import { openInSystemBrowser } from '../../utils/links';
import { RailSwitch } from './RailSwitch';
import { RailOutletContext } from './railOutlet';
import { fetchRepoPath } from '../../services/boardApi';
import { confirmDelete } from '../../utils/agentDelete';
import { agentFolder, boardUrl, codeUrl, modeUrl, pullsUrl } from '../../utils/codeTarget';
import {
  parseDispatchInput,
  parseFilter,
  applySessionFilter,
  isUntrustedWorkspaceError,
} from '../../utils/agentInput';
import {
  groupSessions,
  railItems,
  documentTitle,
  applyQuickFilters,
  applyTextQuery,
  applyLinkFilter,
  collectLinkEntries,
  sessionsInContext,
  matchesQuickFilter,
  mergeServers,
  collectPullRequests,
  type PullRequestRow,
  summarizeContext,
  formatModelName,
  groupRepoSlug,
  DEFAULT_SORT,
  QUICK_FILTERS,
  SORT_OPTIONS,
  AgentQuickFilter,
  AgentSort,
  NavItem,
  SessionGroup,
  harnessLabel,
  HARNESSES,
  sessionHarness,
  withBranchPullRequests,
  sessionsWithBranchPullRequests,
  terminalResumeArgs,
  UI_VIEW_HARNESSES,
  isOmpStoreSession,
  withOrchestratorSessions,
  isOrchestrator,
  orchestratorKey,
  withoutOrchestrator,
  ORCHESTRATORS_GROUP_KEY,
} from '../../utils/agentSessions';
import { fetchOrchestratorWorkspace, startOrchestrator } from '../../services/orchestratorApi';
import { AgentList, AgentRowAction } from './AgentList';
import { FoldButtons, GroupingPicker, ProjectsSection, RailNavProps } from './ProjectsRail';
import { NewTaskButton } from './NewTaskButton';
import { ModeSwitcher } from '../ModeSwitcher';
import { AgentsRailSlot } from '../ModuleSlot';
import { AgentSummaryBar, AgentFilterBar } from './AgentSummaryBar';
import { PullRequestsPanel } from './PullRequestsPanel';
import { PullRequestModal } from './PullRequestModal';
import { PullRequestsDataContext, type PullRequestsPageProps } from './PullRequestsPage';
import { ServersPanel, type ServerRow } from './ServersPanel';
import { TaskComposerModal, useCommandPalette, useRegisterCommands } from '../CommandPalette';
import type { PaletteCommand } from '../../utils/commandPalette';
import { CloudSessionBar } from './CloudSessionBar';
import { PeekPanel } from './PeekPanel';
import { AgentWorkspace } from './AgentWorkspace';
import { SessionLinks } from './SessionLinks';
import { ResumePicker } from './ResumePicker';
import { CopyWarningDialog } from './CopyWarningDialog';
import {
  collapseCopies,
  openPlan,
  resumeMakesCopy,
  transcriptHolder,
} from '../../utils/sessionCopies';
import { ShortcutsHelp } from './ShortcutsHelp';
import { AgentSettingsPanel } from './AgentSettingsPanel';
import { useLocation, useNavigate } from 'react-router-dom';
import { fetchBoard } from '../../services/boardApi';
import { deriveAgentLinks, itemKey as boardItemKey, linksByAgent } from '../../utils/board';
import type { BoardData } from '../../types';
import { IssueCreateModal, lastIssueRepo, type IssueDraft } from '../BoardView/IssueCreateModal';
import { IssueModal } from '../BoardView/IssueModal';
import { issueDraftToTask, promptWithImages, taskToIssueDraft } from '../../utils/composer';
import { pollWhileVisible } from '../../utils/visiblePoll';
import { DirectoryPicker } from './DirectoryPicker';
import { MainAgentDialog } from './MainAgentDialog';
import { MAIN_AGENT_EVENT } from '../TitleBar';
import { openProjectSettings } from '../ProjectsSettings';

/** Board issue chips are a nice-to-have: refetch at most this often while the view is active */
const BOARD_REFRESH_MS = 60_000;

interface AgentsViewProps {
  /** Whether the agents route is shown (keyboard handling, workspace); the rail itself is always live */
  active: boolean;
  /** Discovered apps - offered as dispatch directories */
  apps: AgentConfigLike[];
  /** Leave the agents view (Ctrl+C twice) */
  onExit: () => void;
  /** App navigation for the merged left rail (replaces the separate app sidebar) */
  nav: RailNavProps;
  /** Make this view the visible route (palette command "New task" from another page) */
  onOpenView: () => void;
  /** Active project context (#97): its stored workspace and rail prefs are reloaded on change */
  contextId?: string;
  /** Member apps of the active context; null shows every session (#133) */
  contextAppIds?: string[] | null;
  /** Main area of the other routes (dashboard, board, code, ...): replaces the workspace while not active */
  children?: React.ReactNode;
  /** The route below lists its own items in the rail column (Chats mode): agents hidden meanwhile */
  railOutlet?: boolean;
}

const noop = () => {};
const DISPATCH_CWD_STORAGE_KEY = 'devOrbitAgentDispatchCwd';
const SORT_STORAGE_KEY = 'devOrbitAgentSort';
const INTERACTIVE_STORAGE_KEY = 'devOrbitAgentInteractive';
/**
 * Terminal session no Orkumo pane runs (started elsewhere, often by another agent, or ended):
 * hidden in the rail unless switched on. `panes`: this view's own pane rows, never hidden.
 */
const isHiddenInteractive = (s: AgentSession, panes: Set<string>) =>
  s.kind === 'interactive' && !s.paneId && !panes.has(s.id);

function loadSort(): AgentSort {
  try {
    const parsed = JSON.parse(localStorage.getItem(SORT_STORAGE_KEY) || 'null');
    if (SORT_OPTIONS.some((o) => o.key === parsed?.key) && /^(asc|desc)$/.test(parsed?.dir)) {
      return parsed;
    }
  } catch {
    // unavailable or corrupt storage: use the default
  }
  return DEFAULT_SORT;
}

function isEditableTarget(target: EventTarget | null): target is HTMLElement {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

function isInsideTerminal(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.closest?.('.xterm');
}

/**
 * Browser counterpart of `claude agents`: session list, dispatch input, peek panel
 * and attached sessions in tabs / tiles.
 */
export const AgentsView: React.FC<AgentsViewProps> = ({
  active,
  apps,
  onExit,
  nav,
  onOpenView,
  contextId,
  contextAppIds,
  children,
  railOutlet = false,
}) => {
  const palette = useCommandPalette();
  const {
    sessions: listed,
    listTarget,
    daemon,
    userSettings,
    cliInstalled,
    capabilities,
    settings,
    updateSettings,
    loading,
    error,
    connected,
    counts,
    lastCompleted,
    refresh,
  } = useAgentSessions({ active: true });
  const contexts = useAgentContexts(true, listed);
  // Every harness gets the PRs of its branch, not only Claude jobs that report links
  const sessions = useMemo(
    () => sessionsWithBranchPullRequests(listed, contexts),
    [listed, contexts]
  );

  const [input, setInput] = useState('');
  const [hint, setHint] = useState<{ text: string; tone: 'info' | 'error' | 'success' } | null>(
    null
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);
  // Issue pill clicked: issue as modal over the agents view (#104)
  const [issueModalKey, setIssueModalKey] = useState<string | null>(null);
  const {
    workspace,
    parked,
    openIds: openIdSet,
    attach: attachPane,
    closePane,
    prune: pruneMissing,
    views: paneViews,
    setView: setPaneView,
    ...workspaceActions
  } = useAgentWorkspace(contextId);
  const { openShell } = workspaceActions;
  const [expandedCompleted, setExpandedCompleted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // chat: the picked session opens in the UI view (#189)
  const [resumePicker, setResumePicker] = useState<{
    open: boolean;
    query: string;
    chat?: boolean;
  }>({
    open: false,
    query: '',
  });
  const [composerOpen, setComposerOpen] = useState(false);
  // 'agent' = New agent (#105): interactive session in agentCwd, attached right away
  // 'chat' = New chat (#189): the same agent, shown in the UI view
  const [composerMode, setComposerMode] = useState<'task' | 'agent' | 'chat'>('task');
  const [agentCwd, setAgentCwd] = useState<string | null>(null);
  // Harness of the next agent (#195), preset from the default on every open
  // null follows the default harness, also when the settings arrive after the composer opened
  const [pickedHarness, setComposerHarness] = useState<AgentHarness | null>(null);
  const composerHarness = pickedHarness ?? settings.dispatch.harness;
  const [harnessInstalled, setHarnessInstalled] = useState<Record<string, boolean | null>>({});
  useEffect(() => {
    fetchHarnesses()
      .then((list) => setHarnessInstalled(Object.fromEntries(list.map((h) => [h.id, h.installed]))))
      .catch(() => {});
  }, []);
  const [composerImages, setComposerImages] = useState<File[]>([]);
  const [homeDir, setHomeDir] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pickDirOpen, setPickDirOpen] = useState(false);
  /** Main agent dialog (#252): opened from the title bar or the palette in every view */
  const [mainAgentOpen, setMainAgentOpen] = useState(false);
  useEffect(() => {
    const open = () => setMainAgentOpen(true);
    window.addEventListener(MAIN_AGENT_EVENT, open);
    return () => window.removeEventListener(MAIN_AGENT_EVENT, open);
  }, []);
  /** Directory picker for a new fixed project (#253) */
  const [pickFixedOpen, setPickFixedOpen] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [subagents, setSubagents] = useState<AgentSubagent[]>([]);
  const [repos, setRepos] = useState<AgentRepo[]>([]);
  const [commands, setCommands] = useState<AgentSlashCommand[]>([]);
  const [defaultCwd, setDefaultCwd] = useState<string | null>(null);
  // Cloud/remote PTY tabs live client-side only (not in the `claude agents` list)
  const [cloudSessions, setCloudSessions] = useState<AgentSession[]>([]);
  // #220: panes opened on another instance stay renderable (and unpruned) after the picker
  // switches; `seen` keeps the last known copy of every session
  const agentTarget = useAgentTarget();
  const [seen, setSeen] = useState<ReadonlyMap<string, AgentSession>>(new Map());
  useEffect(() => {
    setSeen((prev) => {
      const next = new Map(prev);
      sessions.forEach((s) => next.set(s.id, s));
      return next;
    });
  }, [sessions]);
  const foreignPanes = useMemo(
    () => [...seen.values()].filter((s) => targetOf(s.id) !== agentTarget),
    [seen, agentTarget]
  );
  const [dispatchCwd, setDispatchCwd] = useState<string | null>(() =>
    localStorage.getItem(DISPATCH_CWD_STORAGE_KEY)
  );
  const [now, setNow] = useState(Date.now());
  // Terminal sessions no Orkumo pane runs (often started by other agents) crowd the rail: hidden until switched on
  const [showInteractive, toggleInteractive] = useStoredToggle(INTERACTIVE_STORAGE_KEY);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const ctrlCRef = useRef<number>(0);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------

  const filter = useMemo(() => parseFilter(input), [input]);
  // Harness agents (#195) started here are listed from this view's state until the server lists
  // their session (omp: from its session store, matched to the pane that runs it)
  const listedSessions = useMemo(() => {
    const claimed = new Set(sessions.map((s) => s.paneId).filter(Boolean));
    return [
      ...sessions,
      ...cloudSessions.filter((s) => sessionHarness(s) !== 'claude' && !claimed.has(s.id)),
    ];
  }, [sessions, cloudSessions]);
  // After a reload the client rows of panes are gone while their agents still run (closing or
  // reloading only detaches): the server rows that name a pane stand in for it, so it reattaches
  const paneStandIns = useMemo(() => {
    const known = new Set(cloudSessions.map((s) => s.id));
    return sessions.flatMap((s): AgentSession[] => {
      if (s.kind !== 'interactive' || !s.paneId || known.has(s.paneId)) return [];
      pinTarget(s.paneId, targetOf(s.id));
      return [
        {
          ...s,
          id: s.paneId,
          paneId: null,
          // only used if the agent ended meanwhile: the pane then resumes its session
          ptyArgs: s.ptyArgs ?? (s.sessionId ? ['--resume', s.sessionId] : []),
        },
      ];
    });
  }, [sessions, cloudSessions]);
  const visibleSessions = useMemo(
    () => applySessionFilter(listedSessions, filter),
    [listedSessions, filter]
  );
  const railRef = useRef<HTMLDivElement>(null);
  // Rail column handed to `children` while `railOutlet` (RailOutletContext)
  const [outlet, setOutlet] = useState<HTMLDivElement | null>(null);
  const outletShown = railOutlet && !active;
  const { zone: focusZone, focusZone: moveFocus } = useAgentFocusZone(active, railRef);
  const servers = useMemo(
    () => new Map(sessions.map((s) => [s.id, mergeServers(s, apps, contexts[s.id])])),
    [sessions, apps, contexts]
  );
  // Agent -> board issue chips. Board fetch failures are ignored so /agents never breaks.
  const [board, setBoard] = useState<BoardData | null>(null);
  useEffect(() => {
    // server caches the board ~60 s
    const load = () =>
      fetchBoard()
        .then(setBoard)
        .catch(() => {});
    return pollWhileVisible(load, BOARD_REFRESH_MS);
  }, []);
  const issueLinks = useMemo(
    () => (board ? deriveAgentLinks(board.items, sessions) : undefined),
    [board, sessions]
  );
  const issuesByAgent = useMemo(() => issueLinks && linksByAgent(issueLinks), [issueLinks]);
  const workflowIssues = useMemo(
    () =>
      new Map(
        (issueLinks || []).filter((l) => l.via === 'workflow').map((l) => [l.jobId, l.issueKey])
      ),
    [issueLinks]
  );
  const provider = useWorkflowProvider();
  const workflowName = useMemo(() => {
    try {
      return provider?.sessionName ? new RegExp(provider.sessionName) : null;
    } catch {
      return null;
    }
  }, [provider]);
  const lookup = useMemo(
    () => ({ contexts, servers, workflowIssues, workflowName, now }),
    [contexts, servers, workflowIssues, workflowName, now]
  );
  const [panel, setPanel] = useState<'prs' | 'servers' | null>(null);
  useEffect(() => {
    if (!active) setPanel(null);
  }, [active]);
  const [prRepo, setPrRepo] = useState<string | null>(null);
  // PR pill -> exactly that session's PR(s); the overview opens from the summary bar
  const [prModal, setPrModal] = useState<AgentPrLink[] | null>(null);
  const pullRows = useMemo(() => collectPullRequests(sessions, contexts), [sessions, contexts]);
  const serverRows = useMemo(() => {
    const seen = new Set<number>();
    const rows: ServerRow[] = [];
    for (const s of sessions) {
      for (const server of servers.get(s.id) || []) {
        if (!server.running || seen.has(server.port)) continue;
        seen.add(server.port);
        rows.push({ server, agentId: s.id, agentName: s.name });
      }
    }
    return rows.sort((a, b) => a.server.port - b.server.port);
  }, [sessions, servers]);
  const [sort, setSortState] = useState<AgentSort>(loadSort);
  const setSort = useCallback((next: AgentSort) => {
    setSortState(next);
    try {
      localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // sort stays in memory only
    }
  }, []);
  const [quickFilters, setQuickFilters] = useState<Set<AgentQuickFilter>>(() => new Set());
  const toggleQuickFilter = useCallback((key: AgentQuickFilter) => {
    setQuickFilters((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);
  const [linkFilter, setLinkFilter] = useState<Set<string>>(() => new Set());
  const toggleLinkFilter = useCallback((key: string) => {
    setLinkFilter((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);
  const [textQuery, setTextQuery] = useState('');
  const filterActive = quickFilters.size > 0 || linkFilter.size > 0 || !!textQuery.trim();
  const contextSessions = useMemo(
    () => sessionsInContext(visibleSessions, apps, contextAppIds, lookup),
    [visibleSessions, apps, contextAppIds, lookup]
  );
  const issueTitles = useMemo(
    () => new Map((board?.items || []).map((item) => [boardItemKey(item), item.title])),
    [board]
  );
  const linkEntries = useMemo(
    () => collectLinkEntries(contextSessions, issuesByAgent, lookup, issueTitles),
    [contextSessions, issuesByAgent, lookup, issueTitles]
  );
  // One row per agent; terminal sessions no Orkumo pane runs only when switched on
  const agentRows = useMemo(() => collapseCopies(contextSessions), [contextSessions]);
  const paneRowIds = useMemo(() => new Set(cloudSessions.map((s) => s.id)), [cloudSessions]);
  const railSessions = useMemo(
    () =>
      showInteractive ? agentRows : agentRows.filter((s) => !isHiddenInteractive(s, paneRowIds)),
    [agentRows, showInteractive, paneRowIds]
  );
  const interactiveCount = useMemo(
    () => agentRows.filter((s) => isHiddenInteractive(s, paneRowIds)).length,
    [agentRows, paneRowIds]
  );
  const shownSessions = useMemo(
    () =>
      applyTextQuery(
        applyQuickFilters(
          applyLinkFilter(railSessions, linkFilter, issuesByAgent, lookup),
          quickFilters,
          lookup
        ),
        textQuery,
        issuesByAgent,
        lookup,
        issueTitles
      ),
    [railSessions, linkFilter, issuesByAgent, quickFilters, lookup, textQuery, issueTitles]
  );
  const chipCounts = useMemo(() => {
    const result = {} as Record<AgentQuickFilter, number>;
    for (const { key } of QUICK_FILTERS) {
      result[key] = sessions.filter((s) => matchesQuickFilter(key, s, lookup)).length;
    }
    return result;
  }, [sessions, lookup]);
  const totals = useMemo(() => summarizeContext(sessions, lookup), [sessions, lookup]);
  // An active quick filter must not hide its matches inside collapsed groups
  const rail = useRailPreferences(settings.grouping, contextId);
  const {
    arrange,
    toggleCollapsed,
    moveGroup,
    toggleFavoriteGroup,
    toggleFavoriteSession,
    favoriteGroups,
  } = rail;
  const collapsed = useMemo(
    () => (filterActive ? new Set<string>() : rail.collapsed),
    [rail.collapsed, filterActive]
  );
  const groups = useMemo(
    () =>
      // Orchestrators stay pinned above everything, favorites included
      withOrchestratorSessions(
        arrange(
          groupSessions(shownSessions, settings.grouping, {
            // Filtering for Completed means the user wants all of them, not "… N more"
            expandedCompleted: expandedCompleted || quickFilters.has('completed'),
            sort,
            lookup,
            apps,
            // A filter asks for agents: empty fixed projects would only be in the way
            fixedProjects: filterActive ? [] : rail.fixedProjects,
          })
        ),
        settings.orchestrators
      ),
    [
      shownSessions,
      filterActive,
      settings.grouping,
      settings.orchestrators,
      expandedCompleted,
      quickFilters,
      sort,
      lookup,
      apps,
      arrange,
      rail.fixedProjects,
    ]
  );
  // Session of the active workspace tab: marked and revealed in the rail
  const activeSessionId = useMemo(() => {
    const id = workspace.tabs.find((t) => t.id === workspace.activeTabId)?.activeSessionId;
    // A harness pane started here is represented by the server row that claimed it (#195)
    return (id && sessions.find((s) => s.id === id || s.paneId === id)?.id) || null;
  }, [workspace.tabs, workspace.activeTabId, sessions]);
  const appsById = useMemo(() => new Map(apps.map((a) => [a.id, a])), [apps]);
  const items = useMemo(
    () => railItems(groups, collapsed, settings.grouping),
    [groups, collapsed, settings.grouping]
  );

  const itemKey = (item: NavItem): string =>
    item.type === 'group'
      ? `group:${item.group.key}`
      : item.type === 'more'
        ? `more:${item.group.key}`
        : item.session.id;

  const selectedIndex = useMemo(() => {
    const index = items.findIndex((item) => itemKey(item) === selectedKey);
    if (index >= 0) return index;
    const firstSession = items.findIndex((item) => item.type === 'session');
    return firstSession >= 0 ? firstSession : items.length > 0 ? 0 : -1;
  }, [items, selectedKey]);
  const selectedItem: NavItem | null = selectedIndex >= 0 ? items[selectedIndex] : null;
  const selectedSession = selectedItem?.type === 'session' ? selectedItem.session : null;
  const peekSession = peekId ? (sessions.find((s) => s.id === peekId) ?? null) : null;

  // Item that was selected when a directory was chosen explicitly: that choice beats the selection's cwd until the selection changes
  const [cwdPickedFor, setCwdPickedFor] = useState<string | null>(null);
  const selectedItemKey = selectedItem ? itemKey(selectedItem) : null;
  const pickDispatchCwd = useCallback(
    (cwd: string | null) => {
      setDispatchCwd(cwd);
      setCwdPickedFor(selectedItemKey);
    },
    [selectedItemKey]
  );

  const targetCwd: string | null = useMemo(() => {
    if (
      (settings.grouping === 'directory' || settings.grouping === 'project') &&
      selectedItem &&
      cwdPickedFor !== selectedItemKey
    ) {
      if (selectedItem.type === 'group' && selectedItem.group.cwd) return selectedItem.group.cwd;
      if (selectedItem.type === 'session') return selectedItem.session.cwd;
    }
    return dispatchCwd || settings.scopeCwd || defaultCwd;
  }, [
    settings.grouping,
    selectedItem,
    selectedItemKey,
    cwdPickedFor,
    dispatchCwd,
    settings.scopeCwd,
    defaultCwd,
  ]);

  const openComposer = useCallback((mode: 'task' | 'agent' | 'chat', cwd: string | null = null) => {
    setComposerMode(mode);
    if (mode !== 'task') setAgentCwd(cwd);
    setComposerHarness(null);
    setComposerOpen(true);
  }, []);
  // Quick window (#251): its prompt opens the chat composer here, ready to send
  useEffect(
    () =>
      window.electronAPI?.onQuickPrompt?.((text) => {
        onOpenView();
        setInput(text);
        openComposer('chat');
      }),
    [onOpenView, openComposer]
  );
  const composerCwd =
    composerMode === 'agent'
      ? agentCwd || homeDir
      : composerMode === 'chat'
        ? agentCwd || targetCwd
        : targetCwd;

  // GitHub repos of the known sessions
  const issueRepos = useMemo(
    () =>
      [...new Set(Object.values(contexts).map((c) => c.repo?.slug))].filter(
        (slug): slug is string => !!slug
      ),
    [contexts]
  );
  const selectedRepo =
    selectedItem?.type === 'group'
      ? groupRepoSlug(selectedItem.group, contexts)
      : selectedItem?.type === 'session'
        ? contexts[selectedItem.session.id]?.repo?.slug || null
        : null;
  const openIssueDialog = useCallback(
    (repo: string | null) => setIssueDialog({ repo: repo || lastIssueRepo(issueRepos) }),
    [issueRepos]
  );

  const directoryChoices = useMemo(() => {
    const seen = new Map<string, { name: string; path: string; source: string }>();
    for (const repo of repos) seen.set(repo.path, repo);
    for (const app of apps)
      if (!seen.has(app.path))
        seen.set(app.path, { name: app.name, path: app.path, source: 'app' });
    for (const session of sessions)
      if (!seen.has(session.cwd))
        seen.set(session.cwd, {
          name: session.cwd.split('/').pop() || session.cwd,
          path: session.cwd,
          source: 'session',
        });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [repos, apps, sessions]);

  // ---------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (dispatchCwd) localStorage.setItem(DISPATCH_CWD_STORAGE_KEY, dispatchCwd);
    else localStorage.removeItem(DISPATCH_CWD_STORAGE_KEY);
  }, [dispatchCwd]);

  // Tick for ages
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(interval);
  }, []);

  // Browser tab title
  useEffect(() => {
    if (!active) return;
    const previous = document.title;
    document.title = documentTitle(counts.awaitingInput);
    return () => {
      document.title = previous;
    };
  }, [active, counts.awaitingInput]);

  // Discovery data (subagents, repos, slash commands) follows the scope
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const scope = settings.scopeCwd;
    Promise.all([
      fetchSubagents(scope).catch(() => []),
      fetchAgentRepos(scope).catch(() => ({ cwd: null, repos: [], home: undefined })),
      fetchAgentCommands(scope).catch(() => []),
    ]).then(([agentsList, repoData, commandList]) => {
      if (cancelled) return;
      setSubagents(agentsList);
      setRepos(repoData.repos);
      setDefaultCwd(repoData.cwd);
      if (repoData.home) setHomeDir(repoData.home);
      setCommands(commandList);
    });
    return () => {
      cancelled = true;
    };
  }, [active, settings.scopeCwd, sessions.length]);

  // Drop tabs for sessions that no longer exist; right after a switch `sessions` still holds the
  // previous instance's list for one render, so only a list of the picked target counts
  const listIsCurrent = listTarget === agentTarget;
  useEffect(() => {
    if (loading || !listIsCurrent || sessions.length === 0) return;
    pruneMissing(
      new Set([...sessions, ...cloudSessions, ...paneStandIns, ...foreignPanes].map((s) => s.id))
    );
  }, [sessions, cloudSessions, paneStandIns, foreignPanes, loading, listIsCurrent, pruneMissing]);

  // Forget open row details of removed sessions; a scoped (--cwd) or failed list is incomplete
  const { pruneExpandedSessions } = rail;
  useEffect(() => {
    if (loading || !listIsCurrent || error || settings.scopeCwd || sessions.length === 0) return;
    pruneExpandedSessions([...sessions, ...cloudSessions].map((s) => s.id));
  }, [
    sessions,
    cloudSessions,
    loading,
    listIsCurrent,
    error,
    settings.scopeCwd,
    pruneExpandedSessions,
  ]);

  const showHint = useCallback(
    (text: string, tone: 'info' | 'error' | 'success' = 'info', ttl = 4000) => {
      setHint({ text, tone });
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
      hintTimerRef.current = setTimeout(() => setHint(null), ttl);
    },
    []
  );

  // ---------------------------------------------------------------------
  // Workspace (tabs)
  // ---------------------------------------------------------------------

  // Small screens show either the session list or the workspace; attaching switches to the workspace
  const [narrowWorkspace, setNarrowWorkspace] = useState(false);
  const attach = useCallback(
    (id: string) => {
      attachPane(id);
      setSelectedKey(id);
      setNarrowWorkspace(true);
      // From board/code/module modes/dashboard: the tab only shows on the agents route
      if (!active) onOpenView();
    },
    [attachPane, active, onOpenView]
  );
  // Quick window (#251) handing over its agent pane: opened here once the session list names the
  // pane (its stand-in), which reattaches to the same process
  const [quickPane, setQuickPane] = useState<string | null>(null);
  useEffect(
    () =>
      window.electronAPI?.onQuickChat?.((paneId) => {
        onOpenView();
        setQuickPane(paneId);
      }),
    [onOpenView]
  );
  const quickPaneListed = !!quickPane && paneStandIns.some((s) => s.id === quickPane);
  useEffect(() => {
    if (!quickPane) return;
    if (quickPaneListed) {
      setQuickPane(null);
      attach(quickPane);
      return;
    }
    const timer = setTimeout(() => {
      setQuickPane(null);
      showHint('The quick window agent did not show up here', 'error');
    }, 20000);
    return () => clearTimeout(timer);
  }, [quickPane, quickPaneListed, attach, showHint]);

  // "New orchestrator": the server starts the default harness as an agent pane in the
  // orchestrator workspace; it is marked right away and opened once the list names its pane
  const [orchestratorPane, setOrchestratorPane] = useState<string | null>(null);
  const [startingOrchestrator, setStartingOrchestrator] = useState(false);
  const orchestratorPaneListed =
    !!orchestratorPane && paneStandIns.some((s) => s.id === orchestratorPane);
  useEffect(() => {
    if (!orchestratorPane) return;
    if (orchestratorPaneListed) {
      setOrchestratorPane(null);
      attach(orchestratorPane);
      return;
    }
    const timer = setTimeout(() => {
      setOrchestratorPane(null);
      showHint('The orchestrator runs but is not listed yet: open it from the rail', 'error');
    }, 30000);
    return () => clearTimeout(timer);
  }, [orchestratorPane, orchestratorPaneListed, attach, showHint]);
  const newOrchestrator = useCallback(async () => {
    if (startingOrchestrator) return;
    setStartingOrchestrator(true);
    showHint('Starting an orchestrator…', 'info');
    try {
      const agent = await startOrchestrator();
      await updateSettings({ orchestrators: [...settings.orchestrators, agent.sessionId] });
      setOrchestratorPane(agent.paneId);
      refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showHint(`Orchestrator did not start: ${message}`, 'error', 8000);
    } finally {
      setStartingOrchestrator(false);
    }
  }, [startingOrchestrator, showHint, updateSettings, settings.orchestrators, refresh]);

  // `/agents?attach=<jobId>` (e.g. from the board): attach once the session list has it
  const location = useLocation();
  const navigate = useNavigate();
  const openPrCode = useCallback(
    async ({ pr, agents }: PullRequestRow) => {
      // Agents on the PR's head branch sit in its worktree; else the repo's checkout
      const folder =
        agents.map((a) => agentFolder(a, contexts[a.id])).find(Boolean) ??
        (await fetchRepoPath(pr.repoSlug).catch(() => null));
      if (folder) navigate(codeUrl(folder));
      else toast.error(`No local checkout of ${pr.repoSlug}`);
    },
    [contexts, navigate]
  );
  // Read by the /pulls container in App.tsx (ConnectedPullRequestsPage)
  const pullsData = useMemo<PullRequestsPageProps>(
    () => ({
      rows: pullRows,
      sessions,
      contexts,
      onSelectAgent: attach,
      onOpenCode: openPrCode,
    }),
    [pullRows, sessions, contexts, attach, openPrCode]
  );
  // New issue dialog; repo null = the user picks one of `issueRepos`
  const [issueDialog, setIssueDialog] = useState<{
    repo: string | null;
    draft?: IssueDraft;
  } | null>(null);
  const attachParam = active ? new URLSearchParams(location.search).get('attach') : null;
  useEffect(() => {
    if (!attachParam || loading) return;
    const target = sessions.find((s) => s.id === attachParam);
    if (target?.app) openInSystemBrowser(target.app.url);
    else if (target) attach(attachParam);
    else showHint(`Agent ${attachParam} not found`, 'error');
    navigate('/agents', { replace: true });
  }, [attachParam, loading, sessions, attach, showHint, navigate]);

  // Board "Agent starten" / chat history "Continue" (#280): composer prefill via router state,
  // which external links cannot set
  const prefill = active
    ? (location.state as {
        dispatch?: unknown;
        cwd?: unknown;
        mode?: unknown;
        harness?: unknown;
      } | null)
    : null;
  useEffect(() => {
    if (typeof prefill?.dispatch !== 'string') return;
    setInput(prefill.dispatch);
    if (typeof prefill.cwd === 'string' && prefill.cwd) pickDispatchCwd(prefill.cwd);
    openComposer(prefill.mode === 'chat' ? 'chat' : 'task');
    // After openComposer, which resets the pick; sending checks that the harness is installed
    const harness = HARNESSES.find((h) => h.id === prefill.harness)?.id;
    if (harness) setComposerHarness(harness);
    navigate('/agents', { replace: true, state: null });
  }, [prefill, navigate, openComposer, pickDispatchCwd]);

  const openCloud = useCallback(
    async (target?: string) => {
      const { args } = await openCloudSession(target);
      const id = `cloud-${Date.now()}`;
      const session: AgentSession = {
        id,
        sessionId: null,
        kind: 'interactive',
        cwd: targetCwd || '',
        startedAt: Date.now(),
        name: target ? `Cloud ${target.slice(-8)}` : 'Cloud-Sessions',
        state: null,
        ptyArgs: args,
        pinned: false,
        order: null,
        links: [],
        displayState: 'idle',
      };
      pinTarget(id, getAgentTarget());
      setCloudSessions((prev) => [...prev, session]);
      attach(id);
    },
    [targetCwd, attach]
  );

  /**
   * A pane whose agent ended (Stop, Delete): gone from the workspace and from the rail. Closing a
   * pane or tab only detaches (the server keeps an agent PTY running) and its row reopens it.
   */
  const dropPane = useCallback(
    (id: string) => {
      setCloudSessions((prev) => prev.filter((s) => s.id !== id));
      closePane(id);
    },
    [closePane]
  );

  // ---------------------------------------------------------------------
  // Session actions
  // ---------------------------------------------------------------------

  const togglePeek = useCallback((session: AgentSession | null) => {
    if (!session) return;
    setPeekId((current) => (current === session.id ? null : session.id));
    setSelectedKey(session.id);
  }, []);

  const allPanes = useMemo(
    () => [...sessions, ...cloudSessions, ...paneStandIns, ...foreignPanes],
    [sessions, cloudSessions, paneStandIns, foreignPanes]
  );

  // A session an open pane runs is a row of its own (`omp-<uuid>`, a Claude terminal, a resumed
  // transcript) while the pane keeps its pane id: the rail treats the row as open and a click
  // switches to that pane, the same pane opening it would focus
  const paneOfRow = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      const plan = openPlan(s, allPanes, openIdSet);
      if (plan.type === 'focus' && plan.paneId !== s.id) map.set(s.id, plan.paneId);
    }
    return map;
  }, [sessions, allPanes, openIdSet]);
  const railOpenIds = useMemo(
    () => new Set([...openIdSet, ...paneOfRow.keys()]),
    [openIdSet, paneOfRow]
  );

  // Single click on an already attached agent: switch to its tab/pane and put the cursor in the terminal
  const focusOpen = useCallback(
    (id: string) => {
      attach(paneOfRow.get(id) ?? id);
      setSelectedKey(id);
      requestAnimationFrame(() => moveFocus('terminal'));
    },
    [attach, moveFocus, paneOfRow]
  );

  const toggleGroup = useCallback(
    (group: SessionGroup) => {
      // Quick filters force all groups open, so a toggle would change nothing visible
      if (filterActive) showHint('Clear the filters to collapse groups', 'info');
      else toggleCollapsed(group.key);
    },
    [toggleCollapsed, filterActive, showHint]
  );

  /** The view a newly opened pane of `session` starts in: the UI view if preferred and readable */
  const preferredView = useCallback(
    (session: AgentSession): PaneView =>
      settings.agentOpenView === 'chat' &&
      UI_VIEW_HARNESSES[sessionHarness(session)] &&
      !session.ptyArgs?.includes('--cloud')
        ? 'chat'
        : 'terminal',
    [settings.agentOpenView]
  );

  /** Attaches pane `id` in `view`; a pane that is already open keeps the view it shows */
  const attachIn = useCallback(
    (id: string, view: PaneView) => {
      if (!openIdSet.has(id)) setPaneView(id, view);
      attach(id);
    },
    [openIdSet, setPaneView, attach]
  );

  /**
   * Opens an interactive PTY in `cwd`: `claude` (for ~ and folders whose trust prompt is pending)
   * or another harness (#195), which gets `ptyArgs` as is. `view`: how the pane shows it.
   */
  const openInteractiveClaude = useCallback(
    (
      cwd: string,
      name: string,
      ptyArgs: string[] = [],
      command: AgentHarness = 'claude',
      target = getAgentTarget(),
      view: PaneView = 'terminal'
    ) => {
      const id = `interactive-${Date.now()}`;
      // A known session id lets the UI view read this terminal's transcript
      if (command === 'claude' && ptyArgs.length === 0)
        ptyArgs = ['--session-id', crypto.randomUUID()];
      pinTarget(id, target);
      setCloudSessions((prev) => [
        ...prev,
        {
          id,
          sessionId: null,
          kind: 'interactive',
          cwd,
          startedAt: Date.now(),
          name,
          state: null,
          ptyArgs,
          ...(command !== 'claude' && { ptyCommand: command }),
          pinned: false,
          order: null,
          links: [],
          displayState: 'idle',
        },
      ]);
      setComposerOpen(false);
      attachIn(id, view);
    },
    [attachIn]
  );

  /**
   * Resume that starts a new process on a held transcript: ask first (#236). `handover` = the
   * caller stops the holder before it resumes.
   */
  const [pendingCopy, setPendingCopy] = useState<{
    holder: AgentSession;
    run: () => void;
    handover: boolean;
  } | null>(null);
  const guardCopy = useCallback(
    (holder: AgentSession | null, run: () => void, handover = false) => {
      if (holder) setPendingCopy({ holder, run, handover });
      else run();
    },
    []
  );

  /**
   * Opens a rail session the way its kind needs (rail Enter / double-click, peek's open button),
   * in the preferred view ("Open agents in": UI view or terminal). Either view is the same process.
   */
  const openSession = useCallback(
    (session: AgentSession) => {
      const plan = openPlan(session, allPanes, openIdSet);
      // A Claude app session runs on claude.ai: a resume here would fork it (#236)
      if (plan.type === 'app') return plan.url ? openInSystemBrowser(plan.url) : undefined;
      const view = preferredView(session);
      if (plan.type === 'attach') {
        // A harness session running in another terminal: omp has no attach, so taking it over
        // ends that process and resumes the session here (a second process would write in parallel)
        const elsewhere = session.ptyArgs && session.pid != null && !session.paneId;
        if (!elsewhere) return attachIn(session.id, view);
        return guardCopy(
          session,
          () =>
            void stopAgent(session.id).then(
              () => attachIn(session.id, view),
              (err) => showHint(`Takeover failed: ${err.message}`, 'error', 6000)
            ),
          true
        );
      }
      if (plan.type === 'focus') return focusOpen(plan.paneId);
      // Its agent still runs detached in that pane's PTY: reopening reattaches, never a second one
      if (plan.type === 'reattach') return attachIn(plan.paneId, view);
      // Interactive and remote-control sessions keep their transcript locally: continue it here
      const { sessionId } = plan;
      if (sessionId)
        guardCopy(resumeMakesCopy(session) ? session : null, () =>
          openInteractiveClaude(
            session.cwd,
            session.name,
            ['--resume', sessionId],
            'claude',
            undefined,
            view
          )
        );
      else showHint('Interactive sessions run in their own terminal', 'info');
    },
    [
      attachIn,
      showHint,
      openInteractiveClaude,
      preferredView,
      allPanes,
      openIdSet,
      focusOpen,
      guardCopy,
    ]
  );

  const activateItem = useCallback(
    (item: NavItem | null) => {
      if (!item) return;
      if (item.type === 'group') return toggleGroup(item.group);
      if (item.type === 'more') return setExpandedCompleted(true);
      openSession(item.session);
    },
    [toggleGroup, openSession]
  );

  const doDispatch = useCallback(
    async (
      extra: {
        prompt?: string;
        exec?: string;
        resume?: string;
        agent?: string | null;
        cwd?: string | null;
        name?: string | null;
        idle?: boolean;
      },
      attachAfter = false,
      view: PaneView = 'terminal'
    ) => {
      const cwd = extra.cwd || targetCwd;
      if (!cwd) {
        showHint('Pick a directory first', 'error');
        return;
      }
      setDispatching(true);
      try {
        const result = await dispatchAgent({
          ...settings.dispatch,
          ...extra,
          agent: extra.agent === undefined ? settings.dispatch.agent : extra.agent,
          cwd,
        });
        setInput('');
        setComposerImages([]);
        setComposerOpen(false);
        setHighlightedId(result.id);
        setSelectedKey(result.id);
        showHint(
          result.alreadyRunning
            ? `Started a copy: ${result.id}`
            : `Started ${result.name || result.id}`,
          'success'
        );
        refresh();
        if (attachAfter) attachIn(result.id, view);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Dispatch failed';
        if (isUntrustedWorkspaceError(message)) {
          // Input stays in the composer so the user can retry once the folder is trusted
          openInteractiveClaude(cwd, `claude · ${cwd.split(/[\\/]/).filter(Boolean).pop() || cwd}`);
          showHint(
            'Folder not trusted yet: accept the trust prompt in the terminal, then start the agent again',
            'info',
            10000
          );
          return;
        }
        showHint(message, 'error', 6000);
      } finally {
        setDispatching(false);
      }
    },
    [targetCwd, settings.dispatch, showHint, refresh, attachIn, openInteractiveClaude]
  );

  const handleCommand = useCallback(
    async (command: string, args: string, raw: string, attachAfter: boolean) => {
      switch (command) {
        case 'resume': {
          const looksLikeId = /^[a-f0-9-]{8,}$/i.test(args);
          if (looksLikeId) {
            guardCopy(transcriptHolder(sessions, args), () => {
              void doDispatch({ resume: args }, attachAfter);
            });
          } else {
            setResumePicker({ open: true, query: args });
          }
          return;
        }
        case 'model': {
          const model = !args || args === 'default' ? null : args;
          await updateSettings({ dispatch: { ...settings.dispatch, model } });
          setInput('');
          setComposerOpen(false);
          showHint(model ? `Dispatch model: ${model}` : 'Dispatch model: default', 'success');
          return;
        }
        case 'effort': {
          const effort = !args || args === 'default' ? null : args;
          await updateSettings({ dispatch: { ...settings.dispatch, effort } });
          setInput('');
          setComposerOpen(false);
          showHint(effort ? `Dispatch effort: ${effort}` : 'Dispatch effort: default', 'success');
          return;
        }
        case 'bg':
        case 'background':
        case 'fork':
          showHint(`/${command} works inside an attached session`, 'info');
          return;
        default:
          // Skills / custom commands are sent as the prompt
          await doDispatch({ prompt: raw.trim() }, attachAfter);
      }
    },
    [doDispatch, updateSettings, settings.dispatch, showHint, guardCopy, sessions]
  );

  /** Stores the composer images on the server; null when an upload failed (hint shown) */
  const uploadComposerImages = useCallback(async (): Promise<string[] | null> => {
    if (composerImages.length === 0) return [];
    setDispatching(true);
    try {
      return await Promise.all(composerImages.map(uploadAgentImage));
    } catch (err) {
      showHint(err instanceof Error ? err.message : 'Image upload failed', 'error', 6000);
      return null;
    } finally {
      setDispatching(false);
    }
  }, [composerImages, showHint]);

  const handleSubmit = useCallback(
    async ({ attach: attachAfter }: { attach: boolean }) => {
      // New chat (#189) starts the same agent as New agent, only shown in the UI view
      const chat = composerMode === 'chat';
      const view: PaneView = chat && UI_VIEW_HARNESSES[composerHarness] ? 'chat' : 'terminal';
      if (chat) {
        const harness = composerHarness;
        if (harnessInstalled[harness] === false) {
          showHint(`${harnessLabel(harness)} is not installed on this machine`, 'error');
          return;
        }
        if (!composerCwd) {
          showHint('Pick a project directory first', 'error');
          return;
        }
        const cwd = composerCwd;
        const name = `${harness} · ${cwd.split('/').filter(Boolean).pop() || cwd}`;
        // `/resume [id]` and `/continue` pick up an earlier session; anything else is the first message
        const resume = input.trim().match(/^\/resume(?:\s+(\S+))?$/);
        if (resume) {
          if (resume[1]) {
            const id = resume[1];
            guardCopy(transcriptHolder(sessions, id), () => {
              if (harness === 'claude') void doDispatch({ resume: id, cwd }, true, view);
              else
                openInteractiveClaude(
                  cwd,
                  name,
                  terminalResumeArgs(harness, id),
                  harness,
                  undefined,
                  view
                );
            });
          } else if (harness === 'claude') setResumePicker({ open: true, query: '', chat: true });
          else showHint(`${harnessLabel(harness)}: give the session id, /resume <id>`, 'error');
          return;
        }
        if (input.trim() === '/continue') {
          if (harness === 'claude')
            openInteractiveClaude(cwd, name, ['--continue'], 'claude', undefined, view);
          else showHint('/continue is Claude Code only: use /resume <id>', 'error');
          return;
        }
        if (view === 'terminal')
          showHint(`${harnessLabel(harness)} has no UI view yet: it opens in the terminal`, 'info');
      }
      if (composerHarness !== 'claude') {
        // Other harnesses (#195) run interactively in a terminal pane; the server checks the args
        const cwd = chat
          ? composerCwd
          : composerMode === 'agent'
            ? agentCwd || targetCwd
            : targetCwd;
        if (!cwd) {
          showHint('Pick a project directory first', 'error');
          return;
        }
        if (harnessInstalled[composerHarness] === false) {
          showHint(`${harnessLabel(composerHarness)} is not installed on this machine`, 'error');
          return;
        }
        const paths = await uploadComposerImages();
        if (!paths) return;
        const prompt = promptWithImages(input, paths).trim();
        if (prompt && composerHarness === 'opencode') {
          showHint(
            'OpenCode takes no start prompt: leave it empty and type in the terminal',
            'error',
            8000
          );
          return;
        }
        openInteractiveClaude(
          cwd,
          `${composerHarness} · ${cwd.split('/').filter(Boolean).pop() || cwd}`,
          prompt ? ['--', prompt] : [],
          composerHarness,
          undefined,
          view
        );
        setInput('');
        setComposerImages([]);
        return;
      }
      if (composerMode === 'agent' || chat) {
        // The CLI refuses `--bg` in ~ (trusted one session at a time): run it interactively there
        if (homeDir && composerCwd === homeDir) {
          if (input.trim() || composerImages.length > 0) {
            showHint(
              'In ~ Claude Code only runs interactively: start without prompt and type it in the terminal, or pick a project folder',
              'error',
              8000
            );
            return;
          }
          openInteractiveClaude(homeDir, 'claude · ~', [], 'claude', undefined, view);
          return;
        }
        const paths = await uploadComposerImages();
        if (!paths) return;
        const prompt = promptWithImages(input, paths);
        await doDispatch({ prompt: prompt || undefined, idle: true, cwd: composerCwd }, true, view);
        return;
      }
      const parsed = parseDispatchInput(input, { subagents, repos });
      switch (parsed.kind) {
        case 'empty':
          showHint('Describe the task first', 'error');
          return;
        case 'filter':
          // The list filter follows `input`; keep it and let the user see the narrowed list
          setComposerOpen(false);
          return;
        case 'select-pr': {
          const match = sessions.find((s) =>
            s.links.some((l) =>
              parsed.url
                ? l.href === parsed.url
                : parsed.number !== null && l.number === parsed.number
            )
          );
          if (!match) {
            showHint('No session is working on that PR', 'error');
            return;
          }
          setSelectedKey(match.id);
          setInput('');
          setComposerOpen(false);
          if (attachAfter) attach(match.id);
          return;
        }
        case 'too-short':
          showHint('Too short — describe the task', 'error');
          return;
        case 'command':
          await handleCommand(parsed.command, parsed.args, parsed.raw, attachAfter);
          return;
        case 'exec':
          await doDispatch({ exec: parsed.command }, attachAfter);
          return;
        case 'dispatch': {
          const paths = await uploadComposerImages();
          if (!paths) return;
          await doDispatch(
            {
              prompt: promptWithImages(parsed.prompt, paths),
              agent: parsed.agent ?? undefined,
              cwd: parsed.repo?.path || undefined,
            },
            attachAfter
          );
          return;
        }
      }
    },
    [
      guardCopy,
      composerMode,
      composerCwd,
      composerHarness,
      harnessInstalled,
      agentCwd,
      targetCwd,
      homeDir,
      composerImages.length,
      uploadComposerImages,
      input,
      subagents,
      repos,
      sessions,
      showHint,
      attach,
      handleCommand,
      doDispatch,
      openInteractiveClaude,
    ]
  );

  const handleRename = useCallback(
    async (session: AgentSession) => {
      if (session.kind !== 'background') return;
      const name = window.prompt('Rename session:', session.name);
      if (!name || !name.trim() || name.trim() === session.name) return;
      try {
        await renameAgent(session.id, name.trim());
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Rename failed');
      }
    },
    [refresh]
  );

  const handlePin = useCallback(
    async (session: AgentSession) => {
      if (session.kind !== 'background') return;
      try {
        await pinAgent(session.id, !session.pinned);
        showHint(session.pinned ? 'Unpinned' : 'Pinned — kept running while idle', 'success');
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Pin failed');
      }
    },
    [refresh, showHint]
  );

  const removeSession = useCallback(
    async (
      session: AgentSession,
      options: { discardUnpushed?: string | null; forceRemoveWorktree?: string | null } = {}
    ) => {
      try {
        const result = await removeAgent(session.id, options);
        if (!result.removed) {
          if (
            result.hints?.discardUnpushed &&
            window.confirm(`${result.message}\n\nDiscard the unpushed commits and delete anyway?`)
          ) {
            return removeSession(session, { discardUnpushed: result.hints.discardUnpushed });
          }
          if (
            result.hints?.forceRemoveWorktree &&
            window.confirm(`${result.message}\n\nForce-remove the worktree directory and delete?`)
          ) {
            return removeSession(session, {
              forceRemoveWorktree: result.hints.forceRemoveWorktree,
            });
          }
          toast.error(result.message, { duration: 8000 });
          return;
        }
        toast.success(`Deleted ${session.name}`);
        dropPane(session.paneId ?? session.id);
        if (peekId === session.id) setPeekId(null);
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Delete failed');
      }
    },
    [dropPane, peekId, refresh]
  );

  const deleteSession = useCallback(
    (session: AgentSession) => confirmDelete(session.name, () => removeSession(session)),
    [removeSession]
  );

  const handleStopOrDelete = useCallback(
    async (item: NavItem | null) => {
      if (!item) return;
      if (item.type === 'group') {
        const list = [...item.group.sessions, ...item.group.hidden].filter(
          (s) => s.kind === 'background' || isOmpStoreSession(s)
        );
        if (list.length === 0) return;
        if (!window.confirm(`Delete all ${list.length} sessions in "${item.group.title}"?`)) return;
        for (const session of list) await removeSession(session);
        return;
      }
      if (item.type !== 'session') return;
      if (item.session.kind !== 'background' && !isOmpStoreSession(item.session)) return;
      await deleteSession(item.session);
    },
    [deleteSession, removeSession]
  );

  const handleReorder = useCallback(
    async (direction: 'up' | 'down') => {
      if (selectedItem?.type === 'group') {
        // Same rule as the group menu: orchestrators and favorites stay blocks of their own
        const key: string = selectedItem.group.key;
        const keys = items.flatMap((i) =>
          i.type === 'group' &&
          (i.group.key as string) !== FAVORITES_GROUP_KEY &&
          i.group.key !== ORCHESTRATORS_GROUP_KEY
            ? [i.group.key as string]
            : []
        );
        const target =
          key !== 'all' &&
          groupNeighbour(keys, [...favoriteGroups], key, direction === 'up' ? -1 : 1);
        if (target) moveGroup(key, target, keys);
        return;
      }
      if (!selectedItem || selectedItem.type !== 'session') return;
      const group = selectedItem.group;
      const ids = group.sessions.map((s) => s.id);
      const index = ids.indexOf(selectedItem.session.id);
      const target = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      try {
        await reorderAgents(ids);
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Reorder failed');
      }
    },
    [selectedItem, items, favoriteGroups, moveGroup, refresh]
  );

  const handleReply = useCallback(
    async (session: AgentSession, text: string) => {
      await replyToAgent(session.id, text);
      refresh();
    },
    [refresh]
  );

  const toggleGrouping = useCallback(() => {
    const order = ['project', 'state', 'directory', 'none'] as const;
    updateSettings({ grouping: order[(order.indexOf(settings.grouping) + 1) % order.length] });
  }, [settings.grouping, updateSettings]);

  const copyJson = useCallback(async () => {
    try {
      const json = await fetchAgentsRawJson({ cwd: settings.scopeCwd, all: true });
      await navigator.clipboard.writeText(json);
      toast.success('claude agents --json copied to clipboard');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Copy failed');
    }
  }, [settings.scopeCwd]);

  const attachNth = useCallback(
    (n: number) => {
      let pool: AgentSession[];
      if ((settings.grouping === 'directory' || settings.grouping === 'project') && selectedItem) {
        pool = selectedItem.group.sessions;
      } else {
        pool = items
          .filter((i): i is Extract<NavItem, { type: 'session' }> => i.type === 'session')
          .map((i) => i.session);
      }
      const session = pool.filter((s) => s.kind === 'background')[n - 1];
      if (session) attach(session.id);
    },
    [settings.grouping, selectedItem, items, attach]
  );

  const moveSelection = useCallback(
    (direction: 'up' | 'down') => {
      const keys = items.map(itemKey);
      if (keys.length === 0) return;
      const at = selectedIndex;
      const next = direction === 'up' ? Math.max(0, at - 1) : Math.min(keys.length - 1, at + 1);
      setSelectedKey(keys[next]);
    },
    [items, selectedIndex]
  );

  // ---------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      const modalOpen =
        showSettings ||
        showHelp ||
        resumePicker.open ||
        editorOpen ||
        pickDirOpen ||
        composerOpen ||
        palette.isOpen ||
        panel !== null;
      if (modalOpen) return;
      if (isInsideTerminal(e.target)) return;
      const target = e.target as HTMLElement | null;
      // Explicit type: an inferred alias would narrow `target` to never below
      const inOtherInput: boolean = isEditableTarget(target);
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey && !e.metaKey && !e.altKey;

      // Global (also inside text inputs)
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyN') {
        e.preventDefault();
        openComposer('task');
        return;
      }
      if (ctrl && key === 's' && !e.shiftKey) {
        e.preventDefault();
        toggleGrouping();
        return;
      }
      if ((ctrl && key === 't' && !e.shiftKey) || (e.altKey && !e.ctrlKey && key === 'p')) {
        e.preventDefault();
        if (selectedSession) handlePin(selectedSession);
        return;
      }
      if (ctrl && key === 'r' && !e.shiftKey) {
        e.preventDefault();
        if (selectedSession) handleRename(selectedSession);
        return;
      }
      if (ctrl && key === 'g' && !e.shiftKey) {
        e.preventDefault();
        setEditorOpen(true);
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-9]$/.test(e.code)) {
        e.preventDefault();
        attachNth(Number(e.code.slice(5)));
        return;
      }
      if (inOtherInput) return; // peek reply / rename inputs handle their own keys

      if (ctrl && key === 'x' && !e.shiftKey) {
        e.preventDefault();
        handleStopOrDelete(selectedItem);
        return;
      }
      if (ctrl && key === 'c') {
        e.preventDefault();
        const nowMs = Date.now();
        if (nowMs - ctrlCRef.current < 1200) {
          ctrlCRef.current = 0;
          onExit();
        } else {
          ctrlCRef.current = nowMs;
          showHint('Press Ctrl+C again to leave the agents view', 'info', 1200);
        }
        return;
      }
      if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey && !ctrl) {
        e.preventDefault();
        handleReorder(e.key === 'ArrowUp' ? 'up' : 'down');
        return;
      }
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShowHelp(true);
        return;
      }

      // A row button (chevron, title) focused by click or Tab must not swallow ↑/↓ (#164).
      // Focus moves to the rail so Space/Enter then act on the new selection, not the old button.
      if (
        (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
        !e.altKey &&
        !ctrl &&
        !e.metaKey &&
        target?.closest('[role="listbox"] button:not([aria-haspopup])') &&
        railRef.current?.contains(target)
      ) {
        e.preventDefault();
        railRef.current.focus();
        moveSelection(e.key === 'ArrowUp' ? 'up' : 'down');
        return;
      }

      // Rail, tab strip and popover controls keep their own Enter/Space/arrow behaviour
      if (
        target?.closest('button, a, [role="dialog"], [role="tab"], [role="tablist"], [role="menu"]')
      )
        return;

      // List / body context
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          moveSelection('up');
          break;
        case 'ArrowDown':
          e.preventDefault();
          moveSelection('down');
          break;
        case 'Enter':
        case 'ArrowRight':
          e.preventDefault();
          activateItem(selectedItem);
          break;
        case ' ':
          e.preventDefault();
          if (selectedItem?.type === 'group') toggleGroup(selectedItem.group);
          else togglePeek(selectedSession);
          break;
        case 'Escape':
          if (peekId) setPeekId(null);
          break;
        case 'n':
          if (e.ctrlKey || e.metaKey || e.altKey) break;
          e.preventDefault();
          openComposer('task');
          break;
        case 'F': // Shift+F: plain F is the app-wide "open favorites" shortcut
          if (e.ctrlKey || e.metaKey || e.altKey || !selectedItem) break;
          if (selectedItem.type === 'group') {
            const key: string = selectedItem.group.key;
            if (key !== FAVORITES_GROUP_KEY && key !== ORCHESTRATORS_GROUP_KEY && key !== 'all')
              toggleFavoriteGroup(key);
          } else if (selectedItem.type === 'session') {
            toggleFavoriteSession(selectedItem.session.id);
          }
          e.preventDefault();
          break;
        default:
          break;
      }
    };
    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, [
    openComposer,
    active,
    showSettings,
    showHelp,
    resumePicker.open,
    editorOpen,
    pickDirOpen,
    composerOpen,
    palette.isOpen,
    panel,
    selectedItem,
    selectedSession,
    peekId,
    toggleGrouping,
    handlePin,
    handleRename,
    attachNth,
    handleStopOrDelete,
    handleReorder,
    toggleFavoriteGroup,
    toggleFavoriteSession,
    moveSelection,
    activateItem,
    toggleGroup,
    togglePeek,
    attach,
    onExit,
    showHint,
  ]);

  // ---------------------------------------------------------------------
  // Row / group menus
  // ---------------------------------------------------------------------

  // Marking types a short briefing into the agent (pane) or replies it (background job), so it
  // takes up the role without being restarted in the orchestrator workspace
  const toggleOrchestrator = useCallback(
    async (session: AgentSession) => {
      const ids = settings.orchestrators;
      if (isOrchestrator(session, ids)) {
        await updateSettings({ orchestrators: withoutOrchestrator(ids, session) });
        return;
      }
      await updateSettings({ orchestrators: [...ids, orchestratorKey(session)] });
      const pane =
        session.kind === 'interactive'
          ? session.paneId || (sessionHarness(session) !== 'claude' ? session.id : null)
          : null;
      try {
        const { briefing, dir } = await fetchOrchestratorWorkspace();
        if (session.kind === 'background') await replyToAgent(session.id, briefing);
        else if (pane) await sendToPane(pane, briefing);
        else {
          showHint(
            `Marked as orchestrator. It runs outside Orkumo: point it to ${dir}/AGENTS.md yourself`,
            'info',
            8000
          );
          return;
        }
        toast.success('Marked as orchestrator and briefed');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Marked as orchestrator, but the briefing did not arrive: ${message}`);
      }
    },
    [settings.orchestrators, updateSettings, showHint]
  );

  const scopedModes = useMemo(() => nav.modes?.filter((m) => m.scoped) ?? [], [nav.modes]);
  const rowActions = useCallback(
    (session: AgentSession): AgentRowAction[] => {
      const bg = session.kind === 'background';
      const alive = session.state === 'working' || session.state === 'blocked';
      // An omp session from omp's store (#195) runs wherever its pid is, maybe in another terminal:
      // the server ends that process, then the pane that ran it here (its id is `paneId`) closes
      const omp = isOmpStoreSession(session);
      // An agent running in a pane of ours, maybe detached (pane closed): Stop ends that pane's PTY
      const heldPane =
        !omp && session.kind === 'interactive'
          ? session.paneId || (sessionHarness(session) !== 'claude' ? session.id : null)
          : null;
      const appUrl = session.app?.url;
      return [
        { id: 'attach', label: 'Attach in tab', disabled: !bg, onSelect: () => attach(session.id) },
        ...(appUrl
          ? [
              {
                id: 'claude-app',
                label: 'Open on claude.ai',
                onSelect: () => openInSystemBrowser(appUrl),
              },
            ]
          : []),
        { id: 'peek', label: 'Peek / reply', onSelect: () => togglePeek(session) },
        {
          id: 'code',
          label: 'Open in Code',
          disabled: !agentFolder(session, contexts[session.id]),
          onSelect: () => {
            const folder = agentFolder(session, contexts[session.id]);
            if (folder) navigate(codeUrl(folder));
          },
        },
        {
          // #207: plain shell in the agent's folder (worktree); a peer agent's folder is on its host (#220)
          id: 'terminal',
          label: 'Open terminal here',
          disabled: targetOf(session.id) !== '' || !agentFolder(session, contexts[session.id]),
          onSelect: () => {
            const folder = agentFolder(session, contexts[session.id]);
            if (folder && targetOf(session.id) === '') openShell(folder);
          },
        },
        {
          id: 'board',
          label: 'Show on Board',
          disabled: !contexts[session.id]?.repo?.slug,
          onSelect: () => {
            const slug = contexts[session.id]?.repo?.slug;
            if (slug) navigate(boardUrl(slug, session.id));
          },
        },
        ...scopedModes.map((m) => ({
          id: `mode:${m.id}`,
          label: `Show ${m.label}`,
          // Only agents started for a board issue have something to show in a scoped mode
          disabled: !contexts[session.id]?.repo?.slug || !issuesByAgent?.get(session.id)?.length,
          onSelect: () => {
            const slug = contexts[session.id]?.repo?.slug;
            if (slug) navigate(modeUrl(m.id)(slug, session.id));
          },
        })),
        {
          id: 'pin',
          label: session.pinned ? 'Unpin' : 'Pin (keep running while idle)',
          disabled: !bg,
          onSelect: () => handlePin(session),
        },
        { id: 'rename', label: 'Rename', disabled: !bg, onSelect: () => handleRename(session) },
        {
          id: 'stop',
          label: 'Stop',
          disabled: omp ? session.pid == null : !heldPane && (!bg || !alive),
          onSelect: () => {
            if (heldPane)
              return void stopPane(heldPane)
                .then(() => {
                  dropPane(heldPane);
                  refresh();
                })
                .catch((err) => toast.error(err.message));
            stopAgent(session.id)
              .then(() => {
                if (omp && session.paneId) dropPane(session.paneId);
                refresh();
              })
              .catch((err) => toast.error(err.message));
          },
        },
        {
          id: 'respawn',
          label: 'Respawn (restart)',
          disabled: !bg,
          onSelect: () =>
            respawnAgent(session.id)
              .then(refresh)
              .catch((err) => toast.error(err.message)),
        },
        {
          id: 'orchestrator',
          label: isOrchestrator(session, settings.orchestrators)
            ? 'Remove orchestrator mark'
            : 'Mark as orchestrator',
          disabled: session.kind === 'app',
          onSelect: () => void toggleOrchestrator(session),
        },
        {
          id: 'copy-id',
          label: 'Copy session id',
          onSelect: () => {
            navigator.clipboard?.writeText(session.sessionId || session.id);
            toast.success('Copied');
          },
        },
        {
          id: 'delete',
          label: 'Delete',
          danger: true,
          disabled: !bg && !omp,
          onSelect: () => deleteSession(session),
        },
      ];
    },
    [
      attach,
      dropPane,
      togglePeek,
      handlePin,
      handleRename,
      refresh,
      deleteSession,
      contexts,
      navigate,
      issuesByAgent,
      openShell,
      scopedModes,
      settings.orchestrators,
      toggleOrchestrator,
    ]
  );

  const groupActions = useCallback(
    (group: SessionGroup): AgentRowAction[] => [
      {
        id: 'toggle',
        label: collapsed.has(group.key) ? 'Expand' : 'Collapse',
        onSelect: () => toggleGroup(group),
      },
      ...(group.appId
        ? [
            {
              id: 'open-project',
              label: 'Open project',
              onSelect: () => nav.onOpenProject(group.appId!),
            },
            {
              id: 'project-settings',
              label: 'Project settings…',
              onSelect: () => openProjectSettings(group.appId!),
            },
          ]
        : []),
      ...(group.cwd && settings.grouping === 'project'
        ? [
            {
              id: 'fixed-project',
              label: group.fixed ? 'Remove fixed project' : 'Keep as fixed project',
              // Several stored directories can mean this project (worktree, subfolder of an app)
              onSelect: () =>
                (group.fixed
                  ? rail.fixedProjects.filter(
                      (dir) =>
                        groupSessions([], 'project', { apps, fixedProjects: [dir] })[0]?.key ===
                        group.key
                    )
                  : [group.cwd!]
                ).forEach(rail.toggleFixedProject),
            },
          ]
        : []),
      ...(group.cwd
        ? [
            {
              id: 'view-code',
              label: 'View Code',
              onSelect: () => navigate(codeUrl(group.cwd!)),
            },
            {
              id: 'open-terminal',
              label: 'Open terminal here',
              onSelect: () => openShell(group.cwd!),
            },
          ]
        : []),
      ...(groupRepoSlug(group, contexts)
        ? [
            {
              id: 'view-board',
              label: 'View Board',
              onSelect: () => navigate(boardUrl(groupRepoSlug(group, contexts)!)),
            },
            ...scopedModes.map((m) => ({
              id: `mode:${m.id}`,
              label: `View ${m.label}`,
              onSelect: () => navigate(modeUrl(m.id)(groupRepoSlug(group, contexts)!)),
            })),
          ]
        : []),
      {
        id: 'new-issue',
        label: groupRepoSlug(group, contexts) ? 'New issue' : 'New issue (no GitHub repo)',
        disabled: !groupRepoSlug(group, contexts),
        onSelect: () => openIssueDialog(groupRepoSlug(group, contexts)),
      },
      ...(group.cwd
        ? [
            {
              id: 'dispatch-here',
              label: 'Dispatch into this directory',
              onSelect: () => pickDispatchCwd(group.cwd || null),
            },
            {
              id: 'new-agent',
              label: 'New agent here',
              onSelect: () => openComposer('agent', group.cwd || null),
            },
          ]
        : []),
      {
        id: 'delete-all',
        label: 'Delete all sessions in group',
        danger: true,
        onSelect: () => handleStopOrDelete({ type: 'group', group }),
      },
    ],
    [
      collapsed,
      toggleGroup,
      settings.grouping,
      rail.fixedProjects,
      rail.toggleFixedProject,
      apps,
      handleStopOrDelete,
      nav,
      navigate,
      contexts,
      openIssueDialog,
      openComposer,
      openShell,
      scopedModes,
    ]
  );

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const disabled = settings.disabled;
  // The rail stays visible on other routes; its keyboard focus marks only count on /agents
  const railFocused = active && focusZone === 'rail';
  // ---------------------------------------------------------------------
  // Command palette entries
  // ---------------------------------------------------------------------

  const collapseAllGroups = useCallback(
    () => rail.collapseAll([FAVORITES_GROUP_KEY, ...groups.map((g) => g.key)]),
    [rail.collapseAll, groups]
  );
  const expandAllGroups = useCallback(() => rail.expandAll(), [rail.expandAll]);
  // Filter row toggles: their state follows what the rail shows
  const groupsCollapsed = useMemo(() => {
    const keys = items.flatMap((item) => (item.type === 'group' ? [item.group.key] : []));
    return keys.length > 0 && keys.every((key) => rail.collapsed.has(key));
  }, [items, rail.collapsed]);
  const cardsExpanded = useMemo(
    () => shownSessions.some((s) => rail.expandedSessions.has(s.id)),
    [shownSessions, rail.expandedSessions]
  );

  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const newTask: PaletteCommand = {
      id: 'agents.new-task',
      title: 'New agent task',
      group: 'Agents',
      scope: 'command',
      keywords: 'dispatch compose prompt session create',
      shortcut: 'N',
      run: () => {
        onOpenView();
        openComposer('task');
      },
      runWithText: (text) => {
        onOpenView();
        setInput(text);
        openComposer('task');
      },
    };
    const mainAgent: PaletteCommand = {
      id: 'agents.main-agent',
      title: 'Main agent',
      group: 'Agents',
      scope: 'command',
      keywords: 'orchestrator main chef hauptagent',
      run: () => setMainAgentOpen(true),
    };
    // The rest acts on the visible view only; the task composer and the main agent work from every page
    if (!active) return [newTask, mainAgent];

    const cmd = (
      id: string,
      title: string,
      group: string,
      run: () => void,
      extra: Partial<PaletteCommand> = {}
    ): PaletteCommand => ({ id: `agents.${id}`, title, group, scope: 'command', run, ...extra });

    const list: PaletteCommand[] = [
      newTask,
      mainAgent,
      cmd('fixed-project.add', 'Add fixed project…', 'Rail', () => setPickFixedOpen(true), {
        keywords: 'projekt festlegen pflegen pin directory',
      }),
    ];
    if (selectedSession) {
      for (const action of rowActions(selectedSession)) {
        if (action.disabled) continue;
        list.push(
          cmd(
            `selected.${action.id}`,
            `${action.label}: ${selectedSession.name}`,
            'Selected agent',
            action.onSelect
          )
        );
      }
    }
    for (const mode of ['project', 'state', 'directory', 'none'] as const) {
      if (mode === settings.grouping) continue;
      list.push(
        cmd(`group.${mode}`, `Group agents by ${mode === 'state' ? 'status' : mode}`, 'Rail', () =>
          updateSettings({ grouping: mode })
        )
      );
    }
    for (const option of SORT_OPTIONS) {
      list.push(
        cmd(`sort.${option.key}`, `Sort agents by ${option.label.toLowerCase()}`, 'Rail', () =>
          setSort({ key: option.key, dir: option.dir })
        )
      );
    }
    for (const filterOption of QUICK_FILTERS) {
      const on = quickFilters.has(filterOption.key);
      list.push(
        cmd(
          `filter.${filterOption.key}`,
          `${on ? 'Remove' : 'Add'} filter: ${filterOption.label}`,
          'Rail',
          () => toggleQuickFilter(filterOption.key),
          { keywords: filterOption.title }
        )
      );
    }
    // A quick filter keeps every group open, like the disabled header buttons
    if (!filterActive) {
      list.push(
        cmd('groups.collapse', 'Collapse all groups', 'Rail', collapseAllGroups),
        cmd('groups.expand', 'Expand all groups', 'Rail', expandAllGroups)
      );
    }
    if (filterActive || filter) {
      list.push(
        cmd('filter.clear', 'Clear all filters', 'Rail', () => {
          setQuickFilters(new Set());
          setLinkFilter(new Set());
          setTextQuery('');
          setInput('');
        })
      );
    }
    const activeTab = workspace.tabs.find((t) => t.id === workspace.activeTabId);
    if (activeTab && activeTab.panes.length > 1) {
      for (const layout of ['columns', 'rows', 'grid'] as const) {
        if (layout === activeTab.layout) continue;
        list.push(
          cmd(`layout.${layout}`, `Split layout: ${layout}`, 'Workspace', () =>
            workspaceActions.setLayout(activeTab.id, layout)
          )
        );
      }
    }
    if (activeTab) {
      list.push(
        cmd('tab.close', 'Close current tab', 'Workspace', () =>
          workspaceActions.closeTab(activeTab.id)
        )
      );
    }
    list.push(
      cmd('panel.prs', 'Show pull requests', 'Panels', () => {
        setPrRepo(null);
        setPanel('prs');
      }),
      cmd('panel.prs-full', 'Open pull requests (full view)', 'Panels', () => navigate('/pulls')),
      cmd('panel.servers', 'Show running servers', 'Panels', () => setPanel('servers')),
      cmd('settings', 'Dispatch defaults and settings', 'Agents', () => setShowSettings(true)),
      cmd('shortcuts', 'Show keyboard shortcuts', 'Agents', () => setShowHelp(true), {
        shortcut: '?',
      }),
      cmd('refresh', 'Refresh agent list', 'Agents', refresh),
      cmd(
        'interactive',
        showInteractive ? 'Hide interactive sessions' : 'Show interactive sessions',
        'Agents',
        toggleInteractive
      ),
      cmd('copy-json', 'Copy claude agents --json', 'Agents', copyJson),
      cmd('exit', 'Leave agents view', 'Agents', onExit)
    );
    for (const session of sessions) {
      list.push({
        id: `agent.${session.id}`,
        title: session.name,
        group: session.cwd.split('/').pop() || 'Agent',
        scope: 'agent',
        keywords: session.state ?? undefined,
        run: () =>
          session.kind === 'background' ? attach(session.id) : setSelectedKey(session.id),
      });
    }
    return list;
  }, [
    openComposer,
    active,
    onOpenView,
    onExit,
    selectedSession,
    rowActions,
    settings.grouping,
    updateSettings,
    setSort,
    quickFilters,
    filterActive,
    filter,
    toggleQuickFilter,
    collapseAllGroups,
    expandAllGroups,
    workspace.tabs,
    workspace.activeTabId,
    workspaceActions,
    refresh,
    copyJson,
    sessions,
    attach,
    navigate,
    showInteractive,
    toggleInteractive,
  ]);
  useRegisterCommands('agents', paletteCommands);

  const defaultModel = settings.dispatch.model || userSettings?.model || 'default';
  // Model of the open agent; the dispatch default only stands in when it is unknown
  const activeModel = formatModelName(activeSessionId ? contexts[activeSessionId]?.model : null);
  const modelLabel =
    activeModel ?? (defaultModel === 'default' ? 'default' : `default: ${defaultModel}`);
  const modelTitle = activeModel
    ? 'Model of the open agent (from its session)'
    : 'Dispatch model for new agents (/model)';

  // Other routes keep their main area when the agent view cannot show its rail
  if ((disabled || cliInstalled === false) && !active) {
    return <div className="h-full relative">{children}</div>;
  }

  if (disabled) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-gray-400">
        <Power size={32} className="text-gray-500" />
        <div>The agent view is turned off.</div>
        <button
          onClick={() => updateSettings({ disabled: false })}
          className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm"
        >
          Turn on again
        </button>
      </div>
    );
  }

  if (cliInstalled === false) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-400 p-8 text-center">
        <AlertTriangle size={32} className="text-yellow-500" />
        <div className="text-gray-200 font-medium">Claude Code CLI not found</div>
        <div className="text-sm">
          Install it on the machine running the Orkumo server, then run{' '}
          <code className="text-blue-300">claude</code> once to sign in.
        </div>
        <pre className="text-xs bg-gray-950 border border-gray-800 rounded p-3">
          npm install -g @anthropic-ai/claude-code
        </pre>
        <button
          onClick={refresh}
          className="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 hover:text-white text-sm text-gray-200"
        >
          Check again
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex min-h-0 bg-gray-900 text-gray-100" data-agents-view>
      {/* Activity bar, like VS Code: modes on top, settings at the bottom */}
      <nav
        aria-label="Activity bar"
        className={`${active ? 'flex' : 'hidden md:flex'} w-12 shrink-0 flex-col py-1 border-r border-gray-800 bg-gray-950`}
      >
        <ModeSwitcher modes={nav.modes} />
        <button
          onClick={nav.onOpenSettings}
          className="mt-auto flex items-center justify-center h-11 text-gray-500 hover:text-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cursor"
          title="Settings"
          aria-label="Settings"
        >
          <Settings size={20} strokeWidth={1.75} aria-hidden />
        </button>
      </nav>
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Header; small screens show it on /agents only, other routes have the app header */}
        <div
          className={`relative ${active ? 'flex' : 'hidden md:flex'} flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 border-b border-gray-800 shrink-0`}
        >
          <button
            onClick={nav.onOpenContextDashboard}
            className="p-1 -m-1 rounded text-blue-300 hover:text-white hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
            title="Dashboard of this context"
            aria-label="Open context dashboard"
          >
            <Bot size={18} />
          </button>
          <NewTaskButton
            onNew={(kind) =>
              kind === 'issue'
                ? openIssueDialog(selectedRepo)
                : kind === 'orchestrator'
                  ? void newOrchestrator()
                  : openComposer(kind)
            }
          />
          <AgentsRailSlot ids={nav.railSlots} />
          <div className="min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1">
            <AgentSummaryBar
              counts={{
                ...counts,
                completed: chipCounts.completed,
                cacheExpiring: chipCounts['cache-expiring'],
              }}
              openPrs={totals.openPrs}
              runningServers={totals.runningServers}
              daemon={daemon}
              justCompleted={
                lastCompleted && Date.now() - lastCompleted.at < 5000 ? lastCompleted.count : 0
              }
              active={quickFilters}
              onToggle={toggleQuickFilter}
              panel={panel}
              onOpenPrs={() => {
                setPrRepo(null);
                setPanel((p) => (p === 'prs' ? null : 'prs'));
              }}
              onOpenServers={() => setPanel((p) => (p === 'servers' ? null : 'servers'))}
            />
          </div>
          {panel === 'prs' && (
            <PullRequestsPanel
              rows={pullRows}
              sessions={sessions}
              contexts={contexts}
              repoFilter={prRepo}
              onClearRepo={() => setPrRepo(null)}
              onSelectAgent={attach}
              onOpenCode={openPrCode}
              onMaximize={() => navigate(pullsUrl(prRepo))}
              onClose={() => setPanel(null)}
            />
          )}
          {panel === 'servers' && (
            <ServersPanel rows={serverRows} onSelectAgent={attach} onClose={() => setPanel(null)} />
          )}
          <div className="flex-1" />
          {!active && (
            <button
              onClick={onOpenView}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-gray-300 hover:text-white hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
              title="Close this view and return to the agent tabs"
              aria-label="Close view"
            >
              <X size={14} /> Close
            </button>
          )}
          <div
            className={`hidden ${active ? 'md:flex' : ''} items-center gap-1.5 text-[11px] text-gray-300`}
            role="status"
            title="Switch with F6 or Ctrl+Alt+Left / Right"
          >
            <span
              className={`px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${
                focusZone === 'terminal' ? 'bg-blue-300 text-gray-950' : 'bg-gray-700 text-gray-100'
              }`}
            >
              {focusZone === 'terminal'
                ? 'Keys: terminal'
                : focusZone === 'rail'
                  ? 'Keys: agent list'
                  : 'Keys: page'}
            </span>
            <kbd className="kbd">{FOCUS_CHORD_LABEL}</kbd>
            <span className="text-gray-400 hidden xl:inline">switches</span>
          </div>
          <span className="text-[11px] text-gray-500 font-mono" title={modelTitle}>
            model {modelLabel}
            <span className="sr-only"> ({modelTitle})</span>
          </span>
          <div className="hidden xl:flex items-center gap-3 text-[11px] text-gray-500 font-mono">
            {settings.dispatch.effort && (
              <span title="Dispatch effort (/effort)">effort {settings.dispatch.effort}</span>
            )}
            {settings.dispatch.permissionMode && <span>{settings.dispatch.permissionMode}</span>}
            {settings.dispatch.skipPermissions && (
              <span className="text-orange-400">bypass permissions</span>
            )}
            {settings.scopeCwd && <span title="Scope (--cwd)">cwd {settings.scopeCwd}</span>}
            {!connected && <span className="text-yellow-500">reconnecting…</span>}
          </div>
          <button
            onClick={copyJson}
            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800"
            title="Copy `claude agents --json --all`"
          >
            <Braces size={15} />
          </button>
          <button
            onClick={refresh}
            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800"
            title="Refresh"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800"
            title="Dispatch defaults & settings"
          >
            <Settings2 size={15} />
          </button>
          <button
            onClick={() => setShowHelp(true)}
            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800"
            title="Shortcuts (?)"
          >
            <HelpCircle size={15} />
          </button>
        </div>

        {error && (
          <div className="px-4 py-1.5 text-xs text-red-300 bg-red-900/20 border-b border-red-900/40 flex items-center gap-2">
            <AlertTriangle size={12} /> {error}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 flex min-h-0">
          {outletShown && (
            <div
              ref={setOutlet}
              className="hidden md:flex md:w-[340px] xl:w-[440px] shrink-0 flex-col min-h-0 border-r border-gray-800 bg-gray-950/40"
            />
          )}
          {/* Session list + dispatch input; hidden, not unmounted, while a route uses the outlet */}
          <div
            ref={railRef}
            tabIndex={-1}
            data-focus-zone="rail"
            data-rail-focused={railFocused}
            // On small screens the rail is the agents page; other routes show their main area instead
            className={`${outletShown ? 'hidden' : active && !narrowWorkspace ? 'flex' : 'hidden md:flex'} w-full md:w-[340px] xl:w-[440px] shrink-0 flex-col min-h-0 border-r border-gray-800 bg-gray-950/40 outline-none relative`}
          >
            {/* Overlay, not a ring: the cards inside would paint over an inset shadow */}
            {railFocused && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-10 border-2 border-blue-300/80"
              />
            )}
            <AgentFilterBar
              leading={
                <GroupingPicker
                  grouping={settings.grouping}
                  onGrouping={(grouping) => updateSettings({ grouping })}
                />
              }
              trailing={
                <FoldButtons
                  groupsCollapsed={groupsCollapsed}
                  onGroups={(collapse) => (collapse ? collapseAllGroups() : expandAllGroups())}
                  groupsDisabled={filterActive}
                  cardsExpanded={cardsExpanded}
                  onCards={(expand) =>
                    rail.setSessionsExpanded(
                      shownSessions.map((s) => s.id),
                      expand
                    )
                  }
                  cardsDisabled={shownSessions.length === 0}
                />
              }
              sort={sort}
              onSort={setSort}
              active={quickFilters}
              onToggle={toggleQuickFilter}
              chipCounts={chipCounts}
              shown={shownSessions.length}
              total={sessions.length}
              filtered={filterActive || !!filter}
              onClear={() => {
                setQuickFilters(new Set());
                setLinkFilter(new Set());
                setTextQuery('');
                if (filter) setInput('');
              }}
              linkEntries={linkEntries}
              linkSelected={linkFilter}
              onToggleLink={toggleLinkFilter}
              query={textQuery}
              onQuery={setTextQuery}
            />
            {loading && sessions.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
                <RefreshCw size={14} className="animate-spin mr-2" /> Loading sessions…
              </div>
            ) : (
              <AgentList
                railFocused={railFocused}
                items={items}
                selectedIndex={selectedIndex}
                onSelectIndex={(index) => setSelectedKey(itemKey(items[index]))}
                onActivate={activateItem}
                onTogglePeek={togglePeek}
                peekId={peekId}
                openIds={railOpenIds}
                onFocusOpen={focusOpen}
                now={now}
                grouping={settings.grouping}
                cardDensity={settings.cardDensity}
                cardFields={settings.cardFields}
                lookup={lookup}
                contexts={contexts}
                servers={servers}
                filtered={filterActive || !!filter}
                onOpenPr={setPrModal}
                rowActions={rowActions}
                groupActions={groupActions}
                highlightedId={highlightedId}
                collapsedKeys={collapsed}
                activeSessionId={activeSessionId}
                onRevealActive={(id) => {
                  rail.revealSession(groups, id);
                  if (isFoldedAway(groups, id)) setExpandedCompleted(true);
                }}
                onToggleGroup={toggleCollapsed}
                favoriteGroupKeys={rail.favoriteGroups}
                favoriteSessionIds={rail.favoriteSessions}
                expandedSessionIds={rail.expandedSessions}
                onToggleExpanded={rail.toggleExpandedSession}
                onToggleFavoriteGroup={rail.toggleFavoriteGroup}
                onToggleFavoriteSession={rail.toggleFavoriteSession}
                onMoveGroup={rail.moveGroup}
                appsById={appsById}
                nav={nav}
                issuesByAgent={issuesByAgent}
                onOpenIssue={setIssueModalKey}
                orchestratorIds={settings.orchestrators}
                top={
                  settings.grouping === 'state' ? (
                    <ProjectsSection apps={apps} nav={nav} filtered={filterActive || !!filter} />
                  ) : undefined
                }
              />
            )}
            {filter && (
              <div className="px-3 py-1 text-[11px] text-blue-300 bg-blue-900/20 border-t border-blue-900/40 flex items-center gap-2">
                filter active — {visibleSessions.length} of {sessions.length} sessions
                <button
                  onClick={() => setInput('')}
                  className="ml-auto hover:text-white"
                  aria-label="Clear filter"
                >
                  <X size={11} />
                </button>
              </div>
            )}
            <RailSwitch
              id="interactive-sessions-label"
              label="Interactive sessions"
              hint={
                interactiveCount > 0
                  ? `${interactiveCount} ${showInteractive ? 'shown' : 'hidden'}`
                  : 'not running in Orkumo'
              }
              checked={showInteractive}
              onToggle={toggleInteractive}
            />
            <CloudSessionBar onOpen={openCloud} />
            {/* Feedback for actions started outside the composer (the composer shows its own) */}
            <div role="status" aria-live="polite">
              {!composerOpen && (hint || dispatching) && (
                <p
                  className={`px-3 py-2 text-xs border-t border-gray-700 ${
                    hint?.tone === 'error'
                      ? 'text-red-300'
                      : hint?.tone === 'success'
                        ? 'text-emerald-300'
                        : 'text-gray-200'
                  }`}
                >
                  {hint?.text || 'Dispatching…'}
                </p>
              )}
            </div>
          </div>

          {/* Main area of the other routes; the workspace below stays mounted so terminals survive */}
          <div className={active ? 'hidden' : 'flex-1 min-w-0 min-h-0 relative'}>
            <PullRequestsDataContext.Provider value={pullsData}>
              <RailOutletContext.Provider value={outletShown ? outlet : null}>
                {children}
              </RailOutletContext.Provider>
            </PullRequestsDataContext.Provider>
          </div>

          {/* Workspace */}
          <div
            className={`flex-1 min-w-0 min-h-0 ${active ? (narrowWorkspace ? 'flex flex-col' : 'hidden md:flex') : 'hidden'} md:flex-row overflow-hidden`}
          >
            <button
              type="button"
              onClick={() => setNarrowWorkspace(false)}
              className="md:hidden flex items-center gap-1.5 px-3 py-2 text-sm text-blue-300 border-b border-gray-800 shrink-0"
            >
              <ArrowLeft size={16} aria-hidden /> Agents
            </button>
            <div className="flex-1 min-w-0 min-h-0">
              {/* One workspace per context visited, keyed by context: a switch moves the left one to
                `parked` (hidden, terminals stay connected) without remounting it */}
              {[...Object.entries(parked), [contextId ?? '', workspace] as const].map(
                ([id, ws]) => {
                  const live = id === (contextId ?? '');
                  const allSessions = allPanes;
                  return (
                    <div key={id} className={live ? 'h-full' : 'hidden'}>
                      <AgentWorkspace
                        hidden={!live}
                        // A session open in the live workspace attaches there only, not twice
                        sessions={
                          live ? allSessions : allSessions.filter((x) => !openIdSet.has(x.id))
                        }
                        workspace={ws}
                        onActivateTab={live ? workspaceActions.activateTab : noop}
                        onFocusPane={live ? workspaceActions.focusPane : noop}
                        onClosePane={live ? closePane : noop}
                        onCloseTab={live ? workspaceActions.closeTab : noop}
                        chatSubmitKey={settings.chatSubmitKey}
                        chatShowSteps={settings.chatShowSteps}
                        onToggleChatSteps={() =>
                          updateSettings({ chatShowSteps: !settings.chatShowSteps })
                        }
                        views={paneViews}
                        onSetView={live ? setPaneView : noop}
                        onMoveTab={live ? workspaceActions.moveTab : noop}
                        onSplit={live ? workspaceActions.split : noop}
                        onDetach={live ? workspaceActions.detach : noop}
                        onOpenLink={live ? workspaceActions.openBrowser : undefined}
                        onSetLayout={live ? workspaceActions.setLayout : noop}
                        onPeek={live ? (sid) => setPeekId(sid) : noop}
                        focusZone={focusZone}
                        renderPaneMeta={(pane) => {
                          // A harness pane started here is represented by the server row that
                          // claimed it (#195); a chat by itself (its context comes from the server)
                          const x = sessions.find((s) => s.paneId === pane.id) ?? pane;
                          return (
                            <SessionLinks
                              session={withBranchPullRequests(x, contexts[x.id])}
                              ctx={contexts[x.id]}
                              servers={(servers.get(x.id) || []).filter((srv) => srv.running)}
                              issueKeys={issuesByAgent?.get(x.id) || []}
                              onOpenIssue={setIssueModalKey}
                              onOpenPr={setPrModal}
                            />
                          );
                        }}
                      />
                    </div>
                  );
                }
              )}
            </div>
            {peekSession && (
              <div className="w-[400px] xl:w-[460px] shrink-0 min-h-0">
                <PeekPanel
                  session={peekSession}
                  onClose={() => setPeekId(null)}
                  onAttach={() => openSession(peekSession)}
                  onReply={(text) => handleReply(peekSession, text)}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Peek on small screens */}
      {peekSession && (
        <div className="md:hidden fixed inset-0 z-40 bg-gray-950">
          <PeekPanel
            session={peekSession}
            onClose={() => setPeekId(null)}
            onAttach={() => openSession(peekSession)}
            onReply={(text) => handleReply(peekSession, text)}
          />
        </div>
      )}

      {mainAgentOpen && (
        <MainAgentDialog
          session={sessions.find(
            (s) =>
              s.kind === 'background' &&
              s.name === settings.mainAgent.name &&
              !sessions.some(
                (o) => o.kind === 'background' && o.name === s.name && o.startedAt > s.startedAt
              )
          )}
          config={settings.mainAgent}
          onConfig={(mainAgent) => updateSettings({ mainAgent })}
          onClose={() => setMainAgentOpen(false)}
          onAttach={(session) => {
            setMainAgentOpen(false);
            onOpenView();
            openSession(session);
          }}
          onReply={handleReply}
        />
      )}

      {/* Modals */}
      <ShortcutsHelp open={showHelp} onClose={() => setShowHelp(false)} />
      {issueModalKey && (
        <IssueModal
          issueKey={issueModalKey}
          sessions={sessions}
          onClose={() => setIssueModalKey(null)}
        />
      )}
      {prModal && (
        <PullRequestModal
          links={prModal}
          rows={pullRows}
          contexts={contexts}
          onSelectAgent={attach}
          onOpenCode={openPrCode}
          onOpenOverview={() => {
            setPrRepo(null);
            setPanel('prs');
          }}
          onClose={() => setPrModal(null)}
        />
      )}
      {issueDialog && (
        <IssueCreateModal
          repo={issueDialog.repo}
          repos={issueRepos}
          draft={issueDialog.draft}
          onKindChange={(kind, draft) => {
            setIssueDialog(null);
            setInput(issueDraftToTask(draft));
            setComposerImages(draft.images);
            openComposer(kind);
          }}
          statusOptions={board?.statusField.options}
          onClose={() => setIssueDialog(null)}
          onCreated={(item) => {
            const key = `${item.repo}#${item.number}`;
            toast(
              (t) => (
                <span className="text-xs">
                  {key} angelegt
                  <button
                    onClick={() => {
                      toast.dismiss(t.id);
                      navigate(`/board?item=${encodeURIComponent(key)}`);
                    }}
                    className="ml-3 text-cursor hover:underline underline-offset-2"
                  >
                    Im Board öffnen
                  </button>
                </span>
              ),
              { duration: 8000 }
            );
          }}
        />
      )}
      <AgentSettingsPanel
        open={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onUpdate={updateSettings}
        userSettings={userSettings}
        daemon={daemon}
        repos={directoryChoices as AgentRepo[]}
        capabilities={capabilities}
        onRefresh={refresh}
      />
      <TaskComposerModal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        onOpenEditor={() => setEditorOpen(true)}
        onPickDirectory={() => setPickDirOpen(true)}
        targetCwd={composerCwd}
        variant={composerMode}
        onKindChange={(kind) => {
          if (kind !== 'issue') return openComposer(kind);
          // The text moves into the issue dialog, so it is not left behind in the composer
          setComposerOpen(false);
          setIssueDialog({
            repo: selectedRepo || lastIssueRepo(issueRepos),
            draft: { ...taskToIssueDraft(input), images: composerImages },
          });
          setInput('');
          setComposerImages([]);
        }}
        harness={composerHarness}
        onHarnessChange={setComposerHarness}
        harnessInstalled={harnessInstalled}
        images={composerImages}
        onImagesChange={setComposerImages}
        hint={hint?.text || (dispatching ? 'Dispatching…' : null)}
        hintTone={hint?.tone}
        disabled={dispatching}
        subagents={subagents}
        repos={repos}
        commands={commands}
        inputRef={inputRef}
      />
      {pendingCopy && (
        <CopyWarningDialog
          holder={pendingCopy.holder}
          handover={pendingCopy.handover}
          onClose={() => setPendingCopy(null)}
          onConfirm={() => {
            setPendingCopy(null);
            pendingCopy.run();
          }}
        />
      )}
      <ResumePicker
        open={resumePicker.open}
        initialQuery={resumePicker.query}
        cwd={targetCwd}
        onClose={() => setResumePicker({ open: false, query: '' })}
        onResume={(past: AgentPastSession) => {
          setResumePicker({ open: false, query: '' });
          guardCopy(transcriptHolder(sessions, past.sessionId), () => {
            if (resumePicker.chat)
              void doDispatch(
                { resume: past.sessionId, cwd: past.cwd || composerCwd },
                true,
                'chat'
              );
            else doDispatch({ resume: past.sessionId, cwd: past.cwd || targetCwd });
          });
        }}
      />
      {editorOpen && (
        <PromptEditor
          value={input}
          onCancel={() => setEditorOpen(false)}
          onSave={(text) => {
            setInput(text);
            setEditorOpen(false);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        />
      )}
      {pickFixedOpen && (
        <DirectoryPicker
          // A fixed project is a project: no free paths, no plain directories
          choices={apps.map((a) => ({ name: a.name, path: a.path, source: 'project' }))}
          current={null}
          home={homeDir}
          label="Project to keep in the rail…"
          allowPath={false}
          onCancel={() => setPickFixedOpen(false)}
          onPick={(path) => {
            if (!rail.fixedProjects.includes(path)) rail.toggleFixedProject(path);
            if (settings.grouping !== 'project') updateSettings({ grouping: 'project' });
            setPickFixedOpen(false);
          }}
        />
      )}
      {pickDirOpen && (
        <DirectoryPicker
          choices={
            composerMode === 'agent' && homeDir
              ? [{ name: '~ (home)', path: homeDir, source: 'home' }, ...directoryChoices]
              : directoryChoices
          }
          current={composerCwd}
          home={homeDir}
          onCancel={() => setPickDirOpen(false)}
          onPick={(path) => {
            if (composerMode !== 'task') setAgentCwd(path);
            else pickDispatchCwd(path);
            setPickDirOpen(false);
            inputRef.current?.focus();
          }}
        />
      )}
    </div>
  );
};

/** Ctrl+G: larger prompt editor (browser stand-in for $VISUAL / $EDITOR) */
const PromptEditor: React.FC<{
  value: string;
  onCancel: () => void;
  onSave: (text: string) => void;
}> = ({ value, onCancel, onSave }) => {
  const [text, setText] = useState(value);
  return (
    <div
      className="fixed inset-0 z-[95] bg-black/60 flex items-center justify-center p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-3xl bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-2 border-b border-gray-800 text-sm font-medium">
          Edit dispatch prompt
        </div>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel();
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSave(text);
          }}
          className="flex-1 min-h-[40vh] bg-gray-950 text-sm text-gray-100 font-mono p-4 outline-none resize-y"
          spellCheck={false}
        />
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-gray-800 text-sm">
          <span className="text-xs text-gray-500 mr-auto">Ctrl+Enter to apply · Esc to cancel</span>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-gray-300 hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(text)}
            className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white"
          >
            Use prompt
          </button>
        </div>
      </div>
    </div>
  );
};
