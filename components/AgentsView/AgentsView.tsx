import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Bot,
  Settings2,
  HelpCircle,
  RefreshCw,
  Braces,
  AlertTriangle,
  Power,
  Plus,
  Search,
  X,
} from 'lucide-react';
import type { AgentConfigLike } from './types';
import type {
  AgentSession,
  AgentSubagent,
  AgentRepo,
  AgentSlashCommand,
  AgentPastSession,
} from '../../types';
import { useAgentSessions } from '../../hooks/useAgentSessions';
import { useRemoteAgents } from '../../hooks/useRemoteAgents';
import { buildSshAttachArgs } from '../../utils/meshHosts';
import { useAgentWorkspace } from '../../hooks/useAgentWorkspace';
import { useAgentContexts } from '../../hooks/useAgentContexts';
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
  openCloudSession,
} from '../../services/agentsApi';
import { fetchRepoPath } from '../../services/boardApi';
import { confirmDelete } from '../../utils/agentDelete';
import { agentFolder, boardUrl, codeUrl, workflowsUrl } from '../../utils/codeTarget';
import { parseDispatchInput, parseFilter, applySessionFilter } from '../../utils/agentInput';
import {
  groupSessions,
  flattenGroups,
  documentTitle,
  applyQuickFilters,
  sessionsInContext,
  matchesQuickFilter,
  mergeServers,
  collectPullRequests,
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
} from '../../utils/agentSessions';
import { AgentList, AgentRowAction } from './AgentList';
import { RailNav, ProjectsSection, RailNavProps } from './ProjectsRail';
import { AgentSummaryBar, AgentFilterBar } from './AgentSummaryBar';
import { PullRequestsPanel } from './PullRequestsPanel';
import { ServersPanel, type ServerRow } from './ServersPanel';
import {
  TaskComposerModal,
  useCommandPalette,
  useRegisterCommands,
  PALETTE_SHORTCUT,
} from '../CommandPalette';
import type { PaletteCommand } from '../../utils/commandPalette';
import { CloudSessionBar } from './CloudSessionBar';
import { RemoteAgents } from './RemoteAgents';
import { PeekPanel } from './PeekPanel';
import { AgentWorkspace } from './AgentWorkspace';
import { SessionLinks } from './SessionLinks';
import { ResumePicker } from './ResumePicker';
import { ShortcutsHelp } from './ShortcutsHelp';
import { AgentSettingsPanel } from './AgentSettingsPanel';
import { useLocation, useNavigate } from 'react-router-dom';
import { fetchBoard } from '../../services/boardApi';
import { deriveAgentLinks, linksByAgent } from '../../utils/board';
import type { BoardData } from '../../types';
import { IssueCreateModal } from '../BoardView/IssueCreateModal';

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
}

const noop = () => {};

const DISPATCH_CWD_STORAGE_KEY = 'devOrbitAgentDispatchCwd';
const SORT_STORAGE_KEY = 'devOrbitAgentSort';
const REMOTE_STORAGE_KEY = 'devOrbitAgentRemote';
/** Client-side id of a remote session: `<host>:<id>` (':' never occurs in a session id). */
const remoteKey = (s: AgentSession) => `${s.host}:${s.id}`;

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
}) => {
  const palette = useCommandPalette();
  const {
    sessions,
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

  const [input, setInput] = useState('');
  const [hint, setHint] = useState<{ text: string; tone: 'info' | 'error' | 'success' } | null>(
    null
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);
  const {
    workspace,
    parked,
    openIds: openIdSet,
    attach: attachPane,
    closePane,
    prune: pruneMissing,
    ...workspaceActions
  } = useAgentWorkspace(contextId);
  const [expandedCompleted, setExpandedCompleted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [resumePicker, setResumePicker] = useState<{ open: boolean; query: string }>({
    open: false,
    query: '',
  });
  const [composerOpen, setComposerOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pickDirOpen, setPickDirOpen] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [subagents, setSubagents] = useState<AgentSubagent[]>([]);
  const [repos, setRepos] = useState<AgentRepo[]>([]);
  const [commands, setCommands] = useState<AgentSlashCommand[]>([]);
  const [defaultCwd, setDefaultCwd] = useState<string | null>(null);
  // Cloud/remote PTY tabs live client-side only (not in the `claude agents` list)
  const [cloudSessions, setCloudSessions] = useState<AgentSession[]>([]);
  const [dispatchCwd, setDispatchCwd] = useState<string | null>(() =>
    localStorage.getItem(DISPATCH_CWD_STORAGE_KEY)
  );
  const [now, setNow] = useState(Date.now());
  const [remoteEnabled, setRemoteEnabled] = useState(() => {
    try {
      return localStorage.getItem(REMOTE_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const toggleRemote = useCallback(() => {
    setRemoteEnabled((prev) => {
      try {
        localStorage.setItem(REMOTE_STORAGE_KEY, String(!prev));
      } catch {
        // switch stays in memory only
      }
      return !prev;
    });
  }, []);
  const remote = useRemoteAgents(active && remoteEnabled);
  const remoteSessions = useMemo(
    () => remote.data?.devices.flatMap((d) => d.sessions) ?? [],
    [remote.data]
  );
  // Remote rows follow the local list in keyboard navigation
  const remoteKeys = useMemo(
    () => (remoteEnabled ? remoteSessions.map(remoteKey) : []),
    [remoteEnabled, remoteSessions]
  );
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const ctrlCRef = useRef<number>(0);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------

  const filter = useMemo(() => parseFilter(input), [input]);
  const visibleSessions = useMemo(() => applySessionFilter(sessions, filter), [sessions, filter]);
  const railRef = useRef<HTMLDivElement>(null);
  const { zone: focusZone, focusZone: moveFocus } = useAgentFocusZone(active, railRef);
  const contexts = useAgentContexts(true);
  const servers = useMemo(
    () => new Map(sessions.map((s) => [s.id, mergeServers(s, apps, contexts[s.id])])),
    [sessions, apps, contexts]
  );
  const lookup = useMemo(() => ({ contexts, servers }), [contexts, servers]);
  const [panel, setPanel] = useState<'prs' | 'servers' | null>(null);
  useEffect(() => {
    if (!active) setPanel(null);
  }, [active]);
  const [prRepo, setPrRepo] = useState<string | null>(null);
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
  const shownSessions = useMemo(
    () =>
      applyQuickFilters(
        sessionsInContext(visibleSessions, apps, contextAppIds, lookup),
        quickFilters,
        lookup
      ),
    [visibleSessions, apps, contextAppIds, quickFilters, lookup]
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
    () => (quickFilters.size ? new Set<string>() : rail.collapsed),
    [rail.collapsed, quickFilters]
  );
  const groups = useMemo(
    () =>
      arrange(
        groupSessions(shownSessions, settings.grouping, {
          // Filtering for Completed means the user wants all of them, not "… N more"
          expandedCompleted: expandedCompleted || quickFilters.has('completed'),
          sort,
          lookup,
          apps,
        })
      ),
    [shownSessions, settings.grouping, expandedCompleted, quickFilters, sort, lookup, apps, arrange]
  );
  // Session of the active workspace tab: marked and revealed in the rail
  const activeSessionId = useMemo(() => {
    const id = workspace.tabs.find((t) => t.id === workspace.activeTabId)?.activeSessionId;
    return id && sessions.some((s) => s.id === id) ? id : null;
  }, [workspace.tabs, workspace.activeTabId, sessions]);
  const appsById = useMemo(() => new Map(apps.map((a) => [a.id, a])), [apps]);
  const items = useMemo(() => {
    const flat = flattenGroups(
      groups,
      collapsed,
      settings.grouping === 'directory' || settings.grouping === 'project'
    );
    // The interactive group only shows up when there are interactive sessions
    return flat.filter(
      (item) =>
        !(
          item.type === 'group' &&
          item.group.key === 'interactive' &&
          item.group.sessions.length === 0
        )
    );
  }, [groups, collapsed, settings.grouping]);

  const itemKey = (item: NavItem): string =>
    item.type === 'group'
      ? `group:${item.group.key}`
      : item.type === 'more'
        ? `more:${item.group.key}`
        : item.session.id;

  const selectedRemote = remoteKeys.includes(selectedKey ?? '')
    ? (remoteSessions.find((s) => remoteKey(s) === selectedKey) ?? null)
    : null;
  const selectedIndex = useMemo(() => {
    // A selected remote row leaves no local selection, so local shortcuts never hit a stand-in
    if (selectedRemote) return -1;
    const index = items.findIndex((item) => itemKey(item) === selectedKey);
    if (index >= 0) return index;
    const firstSession = items.findIndex((item) => item.type === 'session');
    return firstSession >= 0 ? firstSession : items.length > 0 ? 0 : -1;
  }, [items, selectedKey, selectedRemote]);
  const selectedItem: NavItem | null = selectedIndex >= 0 ? items[selectedIndex] : null;
  const selectedSession = selectedItem?.type === 'session' ? selectedItem.session : null;
  const peekSession = peekId
    ? sessions.find((s) => s.id === peekId) ||
      remoteSessions.find((s) => remoteKey(s) === peekId) ||
      null
    : null;

  const targetCwd: string | null = useMemo(() => {
    if ((settings.grouping === 'directory' || settings.grouping === 'project') && selectedItem) {
      if (selectedItem.type === 'group' && selectedItem.group.cwd) return selectedItem.group.cwd;
      if (selectedItem.type === 'session') return selectedItem.session.cwd;
    }
    return dispatchCwd || settings.scopeCwd || defaultCwd;
  }, [settings.grouping, selectedItem, dispatchCwd, settings.scopeCwd, defaultCwd]);

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
      fetchAgentRepos(scope).catch(() => ({ cwd: null, repos: [] })),
      fetchAgentCommands(scope).catch(() => []),
    ]).then(([agentsList, repoData, commandList]) => {
      if (cancelled) return;
      setSubagents(agentsList);
      setRepos(repoData.repos);
      setDefaultCwd(repoData.cwd);
      setCommands(commandList);
    });
    return () => {
      cancelled = true;
    };
  }, [active, settings.scopeCwd, sessions.length]);

  // Drop tabs for sessions that no longer exist
  useEffect(() => {
    if (loading || sessions.length === 0) return;
    pruneMissing(new Set([...sessions, ...cloudSessions].map((s) => s.id)));
  }, [sessions, cloudSessions, loading, pruneMissing]);

  // Forget open row details of removed sessions; a scoped (--cwd) or failed list is incomplete
  const { pruneExpandedSessions } = rail;
  useEffect(() => {
    if (loading || error || settings.scopeCwd || sessions.length === 0) return;
    pruneExpandedSessions([...sessions, ...cloudSessions].map((s) => s.id));
  }, [sessions, cloudSessions, loading, error, settings.scopeCwd, pruneExpandedSessions]);

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

  const attach = useCallback(
    (id: string) => {
      attachPane(id);
      setSelectedKey(id);
      // From board/code/workflows/dashboard: the tab only shows on the agents route
      if (!active) onOpenView();
    },
    [attachPane, active, onOpenView]
  );

  // `/agents?attach=<jobId>` (e.g. from the board): attach once the session list has it
  const location = useLocation();
  const navigate = useNavigate();
  const [createIssueRepo, setCreateIssueRepo] = useState<string | null>(null);
  const attachParam = active ? new URLSearchParams(location.search).get('attach') : null;
  useEffect(() => {
    if (!attachParam || loading) return;
    if (sessions.some((s) => s.id === attachParam)) attach(attachParam);
    else showHint(`Agent ${attachParam} not found`, 'error');
    navigate('/agents', { replace: true });
  }, [attachParam, loading, sessions, attach, showHint, navigate]);

  // Board "Agent starten": composer prefill via router state, which external links cannot set
  const prefill = active ? (location.state as { dispatch?: unknown; cwd?: unknown } | null) : null;
  useEffect(() => {
    if (typeof prefill?.dispatch !== 'string') return;
    setInput(prefill.dispatch);
    if (typeof prefill.cwd === 'string' && prefill.cwd) setDispatchCwd(prefill.cwd);
    setComposerOpen(true);
    navigate('/agents', { replace: true, state: null });
  }, [prefill, navigate]);

  // Agent -> board issue chips. Board fetch failures are ignored so /agents never breaks.
  const [board, setBoard] = useState<BoardData | null>(null);
  useEffect(() => {
    // server caches the board ~60 s
    const load = () =>
      fetchBoard()
        .then(setBoard)
        .catch(() => {});
    load();
    const interval = setInterval(load, BOARD_REFRESH_MS);
    return () => clearInterval(interval);
  }, []);
  const issuesByAgent = useMemo(
    () => (board ? linksByAgent(deriveAgentLinks(board.items, sessions)) : undefined),
    [board, sessions]
  );

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
      setCloudSessions((prev) => [...prev, session]);
      attach(id);
    },
    [targetCwd, attach]
  );

  // Remote panes join the client-side PTY tabs, so a flaky device poll never prunes them
  const attachRemote = useCallback(
    (session: AgentSession) => {
      if (!session.host) return;
      const host = session.host;
      const key = remoteKey(session);
      setCloudSessions((prev) =>
        prev.some((s) => s.id === key)
          ? prev
          : [
              ...prev,
              {
                ...session,
                // namespaced so a remote id never collides with a local session/pane
                id: key,
                name: `${session.name} · ${host.split('.')[0]}`,
                ptyCommand: 'ssh',
                ptyArgs: buildSshAttachArgs(host, session.id),
              },
            ]
      );
      attach(key);
    },
    [attach]
  );

  const closeAnyPane = useCallback(
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

  // Single click on an already attached agent: switch to its tab/pane and put the cursor in the terminal
  const focusOpen = useCallback(
    (id: string) => {
      attach(id);
      requestAnimationFrame(() => moveFocus('terminal'));
    },
    [attach, moveFocus]
  );

  const toggleGroup = useCallback(
    (group: SessionGroup) => {
      // Quick filters force all groups open, so a toggle would change nothing visible
      if (quickFilters.size > 0) showHint('Clear the filters to collapse groups', 'info');
      else toggleCollapsed(group.key);
    },
    [toggleCollapsed, quickFilters, showHint]
  );

  const activateItem = useCallback(
    (item: NavItem | null) => {
      if (!item) return;
      if (item.type === 'group') toggleGroup(item.group);
      else if (item.type === 'more') setExpandedCompleted(true);
      else if (item.session.kind === 'interactive')
        showHint('Interactive sessions run in their own terminal', 'info');
      else attach(item.session.id);
    },
    [toggleGroup, attach, showHint]
  );

  const activateRemote = useCallback(
    (session: AgentSession) => {
      if (session.kind === 'interactive')
        showHint('Interactive sessions run in their own terminal', 'info');
      else attachRemote(session);
    },
    [attachRemote, showHint]
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
      },
      attachAfter = false
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
        if (attachAfter) attach(result.id);
      } catch (err) {
        showHint(err instanceof Error ? err.message : 'Dispatch failed', 'error', 6000);
      } finally {
        setDispatching(false);
      }
    },
    [targetCwd, settings.dispatch, showHint, refresh, attach]
  );

  const handleCommand = useCallback(
    async (command: string, args: string, raw: string, attachAfter: boolean) => {
      switch (command) {
        case 'resume': {
          const looksLikeId = /^[a-f0-9-]{8,}$/i.test(args);
          if (looksLikeId) {
            await doDispatch({ resume: args }, attachAfter);
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
    [doDispatch, updateSettings, settings.dispatch, showHint]
  );

  const handleSubmit = useCallback(
    async ({ attach: attachAfter }: { attach: boolean }) => {
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
        case 'dispatch':
          await doDispatch(
            {
              prompt: parsed.prompt,
              agent: parsed.agent ?? undefined,
              cwd: parsed.repo?.path || undefined,
            },
            attachAfter
          );
          return;
      }
    },
    [input, subagents, repos, sessions, showHint, attach, handleCommand, doDispatch]
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
        closePane(session.id);
        if (peekId === session.id) setPeekId(null);
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Delete failed');
      }
    },
    [closePane, peekId, refresh]
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
          (s) => s.kind === 'background'
        );
        if (list.length === 0) return;
        if (!window.confirm(`Delete all ${list.length} sessions in "${item.group.title}"?`)) return;
        for (const session of list) await removeSession(session);
        return;
      }
      if (item.type !== 'session' || item.session.kind !== 'background') return;
      await deleteSession(item.session);
    },
    [deleteSession, removeSession]
  );

  const handleReorder = useCallback(
    async (direction: 'up' | 'down') => {
      if (selectedItem?.type === 'group') {
        // Same rule as the group menu: favorites stay a block of their own
        const key: string = selectedItem.group.key;
        const keys = items.flatMap((i) =>
          i.type === 'group' && (i.group.key as string) !== FAVORITES_GROUP_KEY
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
      const keys = [...items.map(itemKey), ...remoteKeys];
      if (keys.length === 0) return;
      const at = selectedRemote ? keys.indexOf(remoteKey(selectedRemote)) : selectedIndex;
      const next = direction === 'up' ? Math.max(0, at - 1) : Math.min(keys.length - 1, at + 1);
      setSelectedKey(keys[next]);
    },
    [items, selectedIndex, remoteKeys, selectedRemote]
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
        setComposerOpen(true);
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
          if (selectedRemote) activateRemote(selectedRemote);
          else activateItem(selectedItem);
          break;
        case ' ':
          e.preventDefault();
          if (selectedRemote) {
            // `claude logs` only knows background sessions, not `interactive-<pid>`
            if (selectedRemote.kind === 'background')
              togglePeek({ ...selectedRemote, id: remoteKey(selectedRemote) });
            else showHint('Interactive sessions run in their own terminal', 'info');
          } else if (selectedItem?.type === 'group') toggleGroup(selectedItem.group);
          else togglePeek(selectedSession);
          break;
        case 'Escape':
          if (peekId) setPeekId(null);
          break;
        case 'n':
          if (e.ctrlKey || e.metaKey || e.altKey) break;
          e.preventDefault();
          setComposerOpen(true);
          break;
        case 'F': // Shift+F: plain F is the app-wide "open favorites" shortcut
          if (e.ctrlKey || e.metaKey || e.altKey || !selectedItem) break;
          if (selectedItem.type === 'group') {
            const key: string = selectedItem.group.key;
            if (key !== FAVORITES_GROUP_KEY && key !== 'all') toggleFavoriteGroup(key);
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
    selectedRemote,
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
    activateRemote,
    toggleGroup,
    togglePeek,
    attach,
    onExit,
    showHint,
  ]);

  // ---------------------------------------------------------------------
  // Row / group menus
  // ---------------------------------------------------------------------

  const rowActions = useCallback(
    (session: AgentSession): AgentRowAction[] => {
      const bg = session.kind === 'background';
      const alive = session.state === 'working' || session.state === 'blocked';
      return [
        { id: 'attach', label: 'Attach in tab', disabled: !bg, onSelect: () => attach(session.id) },
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
          id: 'board',
          label: 'Show on Board',
          disabled: !contexts[session.id]?.repo?.slug,
          onSelect: () => {
            const slug = contexts[session.id]?.repo?.slug;
            if (slug) navigate(boardUrl(slug, session.id));
          },
        },
        {
          id: 'workflow',
          label: 'Show Workflow',
          // Only agents started for a board issue run through mw
          disabled: !contexts[session.id]?.repo?.slug || !issuesByAgent?.get(session.id)?.length,
          onSelect: () => {
            const slug = contexts[session.id]?.repo?.slug;
            if (slug) navigate(workflowsUrl(slug, session.id));
          },
        },
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
          disabled: !bg || !alive,
          onSelect: () =>
            stopAgent(session.id)
              .then(refresh)
              .catch((err) => toast.error(err.message)),
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
          disabled: !bg,
          onSelect: () => deleteSession(session),
        },
      ];
    },
    [
      attach,
      togglePeek,
      handlePin,
      handleRename,
      refresh,
      deleteSession,
      contexts,
      navigate,
      issuesByAgent,
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
          ]
        : []),
      ...(group.cwd
        ? [
            {
              id: 'view-code',
              label: 'View Code',
              onSelect: () => navigate(codeUrl(group.cwd!)),
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
            {
              id: 'view-workflows',
              label: 'View Workflows',
              onSelect: () => navigate(workflowsUrl(groupRepoSlug(group, contexts)!)),
            },
          ]
        : []),
      ...(group.cwd
        ? [
            {
              id: 'dispatch-here',
              label: 'Dispatch into this directory',
              onSelect: () => setDispatchCwd(group.cwd || null),
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
    [collapsed, toggleGroup, handleStopOrDelete, nav, navigate, contexts]
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
        setComposerOpen(true);
      },
      runWithText: (text) => {
        onOpenView();
        setInput(text);
        setComposerOpen(true);
      },
    };
    // The rest acts on the visible view only; the task composer works from every page
    if (!active) return [newTask];

    const cmd = (
      id: string,
      title: string,
      group: string,
      run: () => void,
      extra: Partial<PaletteCommand> = {}
    ): PaletteCommand => ({ id: `agents.${id}`, title, group, scope: 'command', run, ...extra });

    const list: PaletteCommand[] = [newTask];
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
    if (quickFilters.size > 0 || filter) {
      list.push(
        cmd('filter.clear', 'Clear all filters', 'Rail', () => {
          setQuickFilters(new Set());
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
      cmd('panel.servers', 'Show running servers', 'Panels', () => setPanel('servers')),
      cmd('settings', 'Dispatch defaults and settings', 'Agents', () => setShowSettings(true)),
      cmd('shortcuts', 'Show keyboard shortcuts', 'Agents', () => setShowHelp(true), {
        shortcut: '?',
      }),
      cmd('refresh', 'Refresh agent list', 'Agents', refresh),
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
    active,
    onOpenView,
    onExit,
    selectedSession,
    rowActions,
    settings.grouping,
    updateSettings,
    setSort,
    quickFilters,
    filter,
    toggleQuickFilter,
    workspace.tabs,
    workspace.activeTabId,
    workspaceActions,
    refresh,
    copyJson,
    sessions,
    attach,
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
          Install it on the machine running the DevOrbit server, then run{' '}
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
    <div className="h-full flex flex-col min-h-0 bg-gray-900 text-gray-100" data-agents-view>
      {/* Header; small screens show it on /agents only, other routes have the app header */}
      <div
        className={`relative ${active ? 'flex' : 'hidden md:flex'} flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 border-b border-gray-800 shrink-0`}
      >
        <button
          onClick={nav.onOpenDashboard}
          className="p-1 -m-1 rounded text-blue-300 hover:text-white hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
          title="Dashboard"
          aria-label="Open dashboard"
        >
          <Bot size={18} />
        </button>
        <div className="min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="text-sm font-semibold leading-tight">Agents</div>
          <AgentSummaryBar
            counts={{ ...counts, completed: chipCounts.completed }}
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
            onOpenCode={async ({ pr, agents }) => {
              // Agents on the PR's head branch sit in its worktree; else the repo's checkout
              const folder =
                agents.map((a) => agentFolder(a, contexts[a.id])).find(Boolean) ??
                (await fetchRepoPath(pr.repoSlug).catch(() => null));
              if (folder) navigate(codeUrl(folder));
              else toast.error(`No local checkout of ${pr.repoSlug}`);
            }}
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
        {/* Session list + dispatch input */}
        <div
          ref={railRef}
          tabIndex={-1}
          data-focus-zone="rail"
          data-rail-focused={railFocused}
          // On small screens the rail is the agents page; other routes show their main area instead
          className={`${active ? 'flex' : 'hidden md:flex'} w-full md:w-[340px] xl:w-[440px] shrink-0 flex-col min-h-0 border-r border-gray-800 bg-gray-950/40 outline-none relative`}
        >
          {/* Overlay, not a ring: the cards inside would paint over an inset shadow */}
          {railFocused && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-10 border-2 border-blue-300/80"
            />
          )}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700">
            <button
              type="button"
              onClick={() => setComposerOpen(true)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              title="New task (N or Alt+N)"
            >
              <Plus size={14} aria-hidden /> New task
            </button>
            <button
              type="button"
              onClick={palette.open}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-gray-100 bg-gray-700 hover:bg-gray-600 focus-visible:outline-2 focus-visible:outline-blue-300"
              title="Command palette"
              aria-label={`Command palette (${PALETTE_SHORTCUT})`}
            >
              <Search size={13} aria-hidden />
              <kbd className="font-mono">{PALETTE_SHORTCUT}</kbd>
            </button>
          </div>
          <RailNav
            nav={nav}
            grouping={settings.grouping}
            onGrouping={(grouping) => updateSettings({ grouping })}
            onCollapseAll={() =>
              rail.collapseAll([FAVORITES_GROUP_KEY, ...groups.map((g) => g.key)])
            }
            onExpandAll={() => rail.expandAll()}
            collapseDisabled={quickFilters.size > 0}
          />
          <AgentFilterBar
            sort={sort}
            onSort={setSort}
            active={quickFilters}
            onToggle={toggleQuickFilter}
            chipCounts={chipCounts}
            shown={shownSessions.length}
            total={sessions.length}
            filtered={quickFilters.size > 0 || !!filter}
            onClear={() => {
              setQuickFilters(new Set());
              if (filter) setInput('');
            }}
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
              openIds={openIdSet}
              onFocusOpen={focusOpen}
              now={now}
              grouping={settings.grouping}
              contexts={contexts}
              servers={servers}
              filtered={quickFilters.size > 0 || !!filter}
              onOpenPrs={(repo) => {
                setPrRepo(repo);
                setPanel('prs');
              }}
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
              onOpenIssue={(key) => navigate(`/board?item=${encodeURIComponent(key)}`)}
              onCreateIssue={setCreateIssueRepo}
              bottom={
                remoteEnabled ? (
                  <RemoteAgents
                    data={remote.data}
                    error={remote.error}
                    loading={remote.loading}
                    now={now}
                    peekId={peekId}
                    selectedKey={selectedRemote ? remoteKey(selectedRemote) : null}
                    railFocused={railFocused}
                    onSelect={(s) => setSelectedKey(remoteKey(s))}
                    onAttach={attachRemote}
                    onPeek={(s) => togglePeek({ ...s, id: remoteKey(s) })}
                  />
                ) : undefined
              }
              top={
                settings.grouping === 'state' ? (
                  <ProjectsSection
                    apps={apps}
                    nav={nav}
                    filtered={quickFilters.size > 0 || !!filter}
                  />
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
          <div className="flex items-center gap-2 px-3 py-1.5 border-t border-gray-800 text-xs text-gray-300">
            <span id="remote-agents-label">Remote-Agents</span>
            <span className="text-gray-500 truncate">via Tailscale + SSH</span>
            <button
              type="button"
              role="switch"
              aria-checked={remoteEnabled}
              aria-labelledby="remote-agents-label"
              onClick={toggleRemote}
              className={`ml-auto relative w-8 h-4 rounded-full transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300 ${
                remoteEnabled ? 'bg-blue-500' : 'bg-gray-700'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform motion-reduce:transition-none ${
                  remoteEnabled ? 'translate-x-4' : ''
                }`}
              />
            </button>
          </div>
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
        <div className={active ? 'hidden' : 'flex-1 min-w-0 min-h-0 relative'}>{children}</div>

        {/* Workspace */}
        <div
          className={`flex-1 min-w-0 min-h-0 ${active ? 'hidden md:flex' : 'hidden'} overflow-hidden`}
        >
          <div className="flex-1 min-w-0 min-h-0">
            {/* One workspace per context visited, keyed by context: a switch moves the left one to
                `parked` (hidden, terminals stay connected) without remounting it */}
            {[...Object.entries(parked), [contextId ?? '', workspace] as const].map(([id, ws]) => {
              const live = id === (contextId ?? '');
              const allSessions = [...sessions, ...cloudSessions];
              return (
                <div key={id} className={live ? 'h-full' : 'hidden'}>
                  <AgentWorkspace
                    hidden={!live}
                    // A session open in the live workspace attaches there only, not twice
                    sessions={live ? allSessions : allSessions.filter((x) => !openIdSet.has(x.id))}
                    workspace={ws}
                    onActivateTab={live ? workspaceActions.activateTab : noop}
                    onFocusPane={live ? workspaceActions.focusPane : noop}
                    onClosePane={live ? closeAnyPane : noop}
                    onCloseTab={live ? workspaceActions.closeTab : noop}
                    onMoveTab={live ? workspaceActions.moveTab : noop}
                    onSplit={live ? workspaceActions.split : noop}
                    onDetach={live ? workspaceActions.detach : noop}
                    onSetLayout={live ? workspaceActions.setLayout : noop}
                    onPeek={live ? (sid) => setPeekId(sid) : noop}
                    focusZone={focusZone}
                    renderPaneMeta={(x) => (
                      <SessionLinks
                        session={x}
                        ctx={contexts[x.id]}
                        servers={(servers.get(x.id) || []).filter((srv) => srv.running)}
                        issueKeys={issuesByAgent?.get(x.id) || []}
                        onOpenIssue={(key) => navigate(`/board?item=${encodeURIComponent(key)}`)}
                        onOpenPrs={(repo) => {
                          setPrRepo(repo);
                          setPanel('prs');
                        }}
                      />
                    )}
                  />
                </div>
              );
            })}
          </div>
          {peekSession && (
            <div className="w-[400px] xl:w-[460px] shrink-0 min-h-0">
              <PeekPanel
                session={peekSession}
                onClose={() => setPeekId(null)}
                onAttach={() =>
                  peekSession.host ? attachRemote(peekSession) : attach(peekSession.id)
                }
                onReply={(text) => handleReply(peekSession, text)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Peek on small screens */}
      {peekSession && (
        <div className="md:hidden fixed inset-0 z-40 bg-gray-950">
          <PeekPanel
            session={peekSession}
            onClose={() => setPeekId(null)}
            onAttach={() => (peekSession.host ? attachRemote(peekSession) : attach(peekSession.id))}
            onReply={(text) => handleReply(peekSession, text)}
          />
        </div>
      )}

      {/* Modals */}
      <ShortcutsHelp open={showHelp} onClose={() => setShowHelp(false)} />
      {createIssueRepo && (
        <IssueCreateModal
          repo={createIssueRepo}
          onClose={() => setCreateIssueRepo(null)}
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
        targetCwd={targetCwd}
        hint={hint?.text || (dispatching ? 'Dispatching…' : null)}
        hintTone={hint?.tone}
        disabled={dispatching}
        subagents={subagents}
        repos={repos}
        commands={commands}
        inputRef={inputRef}
      />
      <ResumePicker
        open={resumePicker.open}
        initialQuery={resumePicker.query}
        cwd={targetCwd}
        onClose={() => setResumePicker({ open: false, query: '' })}
        onResume={(past: AgentPastSession) => {
          setResumePicker({ open: false, query: '' });
          doDispatch({ resume: past.sessionId, cwd: past.cwd || targetCwd });
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
      {pickDirOpen && (
        <DirectoryPicker
          choices={directoryChoices}
          current={targetCwd}
          onCancel={() => setPickDirOpen(false)}
          onPick={(path) => {
            setDispatchCwd(path);
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
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
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

/** Directory picker for the dispatch target */
const DirectoryPicker: React.FC<{
  choices: { name: string; path: string; source: string }[];
  current: string | null;
  onCancel: () => void;
  onPick: (path: string) => void;
}> = ({ choices, current, onCancel, onPick }) => {
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState(current || '');
  const filtered = choices.filter((c) =>
    `${c.name} ${c.path}`.toLowerCase().includes(query.toLowerCase())
  );
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-24 p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-xl bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-800">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onCancel();
              if (e.key === 'Enter' && filtered[0]) onPick(filtered[0].path);
            }}
            placeholder="Directory for new sessions…"
            className="w-full bg-transparent text-sm text-gray-100 placeholder-gray-600 outline-none"
          />
        </div>
        <div className="max-h-[45vh] overflow-y-auto">
          {filtered.map((choice) => (
            <button
              key={choice.path}
              onClick={() => onPick(choice.path)}
              className={`w-full text-left px-4 py-2 flex items-center gap-3 hover:bg-gray-800 ${choice.path === current ? 'bg-gray-800/60' : ''}`}
            >
              <span className="text-sm text-gray-100">{choice.name}</span>
              <span className="text-xs text-gray-500 font-mono truncate">{choice.path}</span>
              <span className="ml-auto text-[10px] text-gray-500">{choice.source}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-4 py-4 text-sm text-gray-500">No matches.</div>
          )}
        </div>
        <div className="flex items-center gap-2 px-4 py-2 border-t border-gray-800">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && custom.trim()) onPick(custom.trim());
            }}
            placeholder="/absolute/path"
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs font-mono text-gray-100 outline-none focus:border-blue-500"
          />
          <button
            onClick={() => custom.trim() && onPick(custom.trim())}
            className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs"
          >
            Use path
          </button>
        </div>
      </div>
    </div>
  );
};
