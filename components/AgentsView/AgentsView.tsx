import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Bot,
  Settings2,
  HelpCircle,
  RefreshCw,
  FolderTree,
  ListTree,
  Braces,
  AlertTriangle,
  Power,
  X,
} from 'lucide-react';
import type { AgentConfigLike } from './types';
import type {
  AgentSession,
  AgentSubagent,
  AgentRepo,
  AgentSlashCommand,
  AgentPastSession,
  AgentLayout,
} from '../../types';
import { useAgentSessions } from '../../hooks/useAgentSessions';
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
} from '../../services/agentsApi';
import { parseDispatchInput, parseFilter, applySessionFilter } from '../../utils/agentInput';
import {
  groupSessions,
  flattenGroups,
  documentTitle,
  NavItem,
  SessionGroup,
} from '../../utils/agentSessions';
import { AgentList, AgentRowAction } from './AgentList';
import { DispatchInput } from './DispatchInput';
import { PeekPanel } from './PeekPanel';
import { AgentWorkspace } from './AgentWorkspace';
import { ResumePicker } from './ResumePicker';
import { ShortcutsHelp } from './ShortcutsHelp';
import { AgentSettingsPanel } from './AgentSettingsPanel';

interface AgentsViewProps {
  /** Whether the view is visible (drives SSE subscription and keyboard handling) */
  active: boolean;
  /** Discovered apps - offered as dispatch directories */
  apps: AgentConfigLike[];
  /** Leave the agents view (Ctrl+C twice) */
  onExit: () => void;
}

const WORKSPACE_STORAGE_KEY = 'devOrbitAgentWorkspace';
const DISPATCH_CWD_STORAGE_KEY = 'devOrbitAgentDispatchCwd';
const DELETE_CONFIRM_WINDOW = 2000;

interface WorkspaceState {
  openIds: string[];
  activeId: string | null;
}

function loadWorkspace(): WorkspaceState {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.openIds))
        return { openIds: parsed.openIds, activeId: parsed.activeId ?? null };
    }
  } catch {
    // ignore
  }
  return { openIds: [], activeId: null };
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
export const AgentsView: React.FC<AgentsViewProps> = ({ active, apps, onExit }) => {
  const {
    sessions,
    daemon,
    userSettings,
    cliInstalled,
    settings,
    updateSettings,
    loading,
    error,
    connected,
    counts,
    lastCompleted,
    refresh,
  } = useAgentSessions({ active });

  const [input, setInput] = useState('');
  const [hint, setHint] = useState<{ text: string; tone: 'info' | 'error' | 'success' } | null>(
    null
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceState>(loadWorkspace);
  const [expandedCompleted, setExpandedCompleted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [resumePicker, setResumePicker] = useState<{ open: boolean; query: string }>({
    open: false,
    query: '',
  });
  const [editorOpen, setEditorOpen] = useState(false);
  const [pickDirOpen, setPickDirOpen] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [subagents, setSubagents] = useState<AgentSubagent[]>([]);
  const [repos, setRepos] = useState<AgentRepo[]>([]);
  const [commands, setCommands] = useState<AgentSlashCommand[]>([]);
  const [defaultCwd, setDefaultCwd] = useState<string | null>(null);
  const [dispatchCwd, setDispatchCwd] = useState<string | null>(() =>
    localStorage.getItem(DISPATCH_CWD_STORAGE_KEY)
  );
  const [now, setNow] = useState(Date.now());
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingDeleteRef = useRef<{ key: string; at: number } | null>(null);
  const ctrlCRef = useRef<number>(0);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------

  const filter = useMemo(() => parseFilter(input), [input]);
  const visibleSessions = useMemo(() => applySessionFilter(sessions, filter), [sessions, filter]);
  const collapsed = useMemo(() => new Set(settings.collapsedGroups), [settings.collapsedGroups]);
  const groups = useMemo(
    () => groupSessions(visibleSessions, settings.grouping, { expandedCompleted }),
    [visibleSessions, settings.grouping, expandedCompleted]
  );
  const items = useMemo(() => {
    const flat = flattenGroups(groups, collapsed, settings.grouping === 'directory');
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

  const selectedIndex = useMemo(() => {
    const index = items.findIndex((item) => itemKey(item) === selectedKey);
    if (index >= 0) return index;
    const firstSession = items.findIndex((item) => item.type === 'session');
    return firstSession >= 0 ? firstSession : items.length > 0 ? 0 : -1;
  }, [items, selectedKey]);
  const selectedItem: NavItem | null = selectedIndex >= 0 ? items[selectedIndex] : null;
  const selectedSession = selectedItem?.type === 'session' ? selectedItem.session : null;
  const peekSession = peekId ? sessions.find((s) => s.id === peekId) || null : null;
  const openIdSet = useMemo(() => new Set(workspace.openIds), [workspace.openIds]);

  const targetCwd: string | null = useMemo(() => {
    if (settings.grouping === 'directory' && selectedItem) {
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
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
  }, [workspace]);

  useEffect(() => {
    if (dispatchCwd) localStorage.setItem(DISPATCH_CWD_STORAGE_KEY, dispatchCwd);
    else localStorage.removeItem(DISPATCH_CWD_STORAGE_KEY);
  }, [dispatchCwd]);

  // Tick for ages
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(interval);
  }, [active]);

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
    const existing = new Set(sessions.map((s) => s.id));
    setWorkspace((prev) => {
      const openIds = prev.openIds.filter((id) => existing.has(id));
      if (openIds.length === prev.openIds.length) return prev;
      const activeId = openIds.includes(prev.activeId || '')
        ? prev.activeId
        : openIds[openIds.length - 1] || null;
      return { openIds, activeId };
    });
  }, [sessions, loading]);

  // Focus the dispatch input when the view becomes active
  useEffect(() => {
    if (active) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [active]);

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

  const attach = useCallback((id: string) => {
    setWorkspace((prev) => ({
      openIds: prev.openIds.includes(id) ? prev.openIds : [...prev.openIds, id],
      activeId: id,
    }));
    setSelectedKey(id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setWorkspace((prev) => {
      const openIds = prev.openIds.filter((x) => x !== id);
      const activeId = prev.activeId === id ? openIds[openIds.length - 1] || null : prev.activeId;
      return { openIds, activeId };
    });
  }, []);

  const reorderTabs = useCallback((from: number, to: number) => {
    setWorkspace((prev) => {
      const openIds = [...prev.openIds];
      const [moved] = openIds.splice(from, 1);
      openIds.splice(to, 0, moved);
      return { ...prev, openIds };
    });
  }, []);

  const setLayout = useCallback(
    (layout: AgentLayout) => updateSettings({ layout }),
    [updateSettings]
  );

  // ---------------------------------------------------------------------
  // Session actions
  // ---------------------------------------------------------------------

  const togglePeek = useCallback((session: AgentSession | null) => {
    if (!session) return;
    setPeekId((current) => (current === session.id ? null : session.id));
    setSelectedKey(session.id);
  }, []);

  const toggleGroup = useCallback(
    (group: SessionGroup) => {
      const next = collapsed.has(group.key)
        ? settings.collapsedGroups.filter((k) => k !== group.key)
        : [...settings.collapsedGroups, group.key];
      updateSettings({ collapsedGroups: next });
    },
    [collapsed, settings.collapsedGroups, updateSettings]
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
          showHint(model ? `Dispatch model: ${model}` : 'Dispatch model: default', 'success');
          return;
        }
        case 'effort': {
          const effort = !args || args === 'default' ? null : args;
          await updateSettings({ dispatch: { ...settings.dispatch, effort } });
          setInput('');
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
        case 'filter':
          activateItem(selectedItem);
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
    [
      input,
      subagents,
      repos,
      activateItem,
      selectedItem,
      sessions,
      showHint,
      attach,
      handleCommand,
      doDispatch,
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

  const deleteSession = useCallback(
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
            return deleteSession(session, { discardUnpushed: result.hints.discardUnpushed });
          }
          if (
            result.hints?.forceRemoveWorktree &&
            window.confirm(`${result.message}\n\nForce-remove the worktree directory and delete?`)
          ) {
            return deleteSession(session, {
              forceRemoveWorktree: result.hints.forceRemoveWorktree,
            });
          }
          toast.error(result.message, { duration: 8000 });
          return;
        }
        toast.success(`Deleted ${session.name}`);
        closeTab(session.id);
        if (peekId === session.id) setPeekId(null);
        refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Delete failed');
      }
    },
    [closeTab, peekId, refresh]
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
        for (const session of list) await deleteSession(session);
        return;
      }
      if (item.type !== 'session' || item.session.kind !== 'background') return;
      const session = item.session;
      const pending = pendingDeleteRef.current;
      const nowMs = Date.now();
      if (pending && pending.key === session.id && nowMs - pending.at < DELETE_CONFIRM_WINDOW) {
        pendingDeleteRef.current = null;
        setHint(null);
        await deleteSession(session);
        return;
      }
      pendingDeleteRef.current = { key: session.id, at: nowMs };
      showHint(
        `Press Ctrl+X again within 2 s to delete ${session.name}`,
        'info',
        DELETE_CONFIRM_WINDOW
      );
      if (session.state === 'working' || session.state === 'blocked') {
        try {
          await stopAgent(session.id);
          refresh();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Stop failed');
        }
      }
    },
    [deleteSession, showHint, refresh]
  );

  const handleReorder = useCallback(
    async (direction: 'up' | 'down') => {
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
    [selectedItem, refresh]
  );

  const handleReply = useCallback(
    async (session: AgentSession, text: string) => {
      await replyToAgent(session.id, text);
      refresh();
    },
    [refresh]
  );

  const toggleGrouping = useCallback(() => {
    updateSettings({ grouping: settings.grouping === 'state' ? 'directory' : 'state' });
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
      if (settings.grouping === 'directory' && selectedItem) {
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
      if (items.length === 0) return;
      const next =
        direction === 'up'
          ? Math.max(0, selectedIndex - 1)
          : Math.min(items.length - 1, selectedIndex + 1);
      setSelectedKey(itemKey(items[next]));
    },
    [items, selectedIndex]
  );

  // ---------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------

  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      const modalOpen = showSettings || showHelp || resumePicker.open || editorOpen || pickDirOpen;
      if (modalOpen) return;
      if (isInsideTerminal(e.target)) return;
      const target = e.target as HTMLElement | null;
      const inDispatch = target === inputRef.current;
      const inOtherInput = isEditableTarget(target) && !inDispatch;
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey && !e.metaKey && !e.altKey;

      // Global (also inside the dispatch input)
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
        const el = inputRef.current;
        const hasSelection = inDispatch && el && el.selectionStart !== el.selectionEnd;
        if (hasSelection) return; // let the browser cut
        e.preventDefault();
        handleStopOrDelete(selectedItem);
        return;
      }
      if (ctrl && key === 'c') {
        if (
          inDispatch &&
          inputRef.current &&
          inputRef.current.selectionStart !== inputRef.current.selectionEnd
        )
          return; // copy
        e.preventDefault();
        if (input) {
          setInput('');
          ctrlCRef.current = 0;
          return;
        }
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
      if (e.key === '?' && !input && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShowHelp(true);
        return;
      }
      if (inDispatch) {
        if (e.key === 'ArrowRight' && !input) {
          e.preventDefault();
          if (selectedSession) attach(selectedSession.id);
        } else if (e.key === 'ArrowLeft' && !input && peekId) {
          e.preventDefault();
          setPeekId(null);
        }
        return; // remaining keys are handled by DispatchInput itself
      }

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
          togglePeek(selectedSession);
          break;
        case 'Escape':
          if (peekId) setPeekId(null);
          else inputRef.current?.focus();
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
    input,
    selectedItem,
    selectedSession,
    peekId,
    toggleGrouping,
    handlePin,
    handleRename,
    attachNth,
    handleStopOrDelete,
    handleReorder,
    moveSelection,
    activateItem,
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
    [attach, togglePeek, handlePin, handleRename, refresh, deleteSession]
  );

  const groupActions = useCallback(
    (group: SessionGroup): AgentRowAction[] => [
      {
        id: 'toggle',
        label: collapsed.has(group.key) ? 'Expand' : 'Collapse',
        onSelect: () => toggleGroup(group),
      },
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
    [collapsed, toggleGroup, handleStopOrDelete]
  );

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const disabled = settings.disabled;
  const defaultModel = settings.dispatch.model || userSettings?.model || 'default';

  if (disabled) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-gray-400">
        <Power size={32} className="text-gray-600" />
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
          className="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-sm text-gray-200"
        >
          Check again
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0 bg-gray-900 text-gray-100" data-agents-view>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 shrink-0">
        <Bot size={18} className="text-blue-400" />
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">Agents</div>
          <div className="text-[11px] text-gray-500 font-mono truncate">
            <span className={counts.awaitingInput > 0 ? 'text-yellow-400' : ''}>
              {counts.awaitingInput} awaiting input
            </span>
            {' · '}
            {counts.working} working · {counts.completed} completed
            {counts.failed > 0 && <span className="text-red-400"> · {counts.failed} failed</span>}
            {lastCompleted && Date.now() - lastCompleted.at < 5000 && (
              <span className="text-emerald-400"> · ← {lastCompleted.count} done</span>
            )}
          </div>
        </div>
        <div className="flex-1" />
        <div className="hidden lg:flex items-center gap-3 text-[11px] text-gray-500 font-mono">
          <span title="Dispatch model (/model)">model {defaultModel}</span>
          {settings.dispatch.effort && (
            <span title="Dispatch effort (/effort)">effort {settings.dispatch.effort}</span>
          )}
          {settings.dispatch.permissionMode && <span>{settings.dispatch.permissionMode}</span>}
          {settings.dispatch.skipPermissions && (
            <span className="text-orange-400">bypass permissions</span>
          )}
          {settings.scopeCwd && <span title="Scope (--cwd)">cwd {settings.scopeCwd}</span>}
          <span
            className={`flex items-center gap-1 ${daemon?.running ? 'text-emerald-400' : 'text-gray-500'}`}
            title={daemon?.raw || 'supervisor status unknown'}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${daemon?.running ? 'bg-emerald-500' : 'bg-gray-600'}`}
            />
            supervisor {daemon?.running ? 'running' : 'idle'}
            {daemon?.versionMismatch && <AlertTriangle size={11} className="text-yellow-400" />}
          </span>
          {!connected && <span className="text-yellow-500">reconnecting…</span>}
        </div>
        <button
          onClick={toggleGrouping}
          className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800"
          title={`Group by ${settings.grouping === 'state' ? 'directory' : 'state'} (Ctrl+S)`}
        >
          {settings.grouping === 'state' ? <FolderTree size={15} /> : <ListTree size={15} />}
        </button>
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
        <div className="w-full md:w-[380px] lg:w-[420px] shrink-0 flex flex-col min-h-0 border-r border-gray-800 bg-gray-950/40">
          {loading && sessions.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
              <RefreshCw size={14} className="animate-spin mr-2" /> Loading sessions…
            </div>
          ) : (
            <AgentList
              items={items}
              selectedIndex={selectedIndex}
              onSelectIndex={(index) => setSelectedKey(itemKey(items[index]))}
              onActivate={activateItem}
              onTogglePeek={togglePeek}
              peekId={peekId}
              openIds={openIdSet}
              now={now}
              grouping={settings.grouping}
              rowActions={rowActions}
              groupActions={groupActions}
              highlightedId={highlightedId}
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
          <DispatchInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            onNavigate={moveSelection}
            onEscape={() => {
              if (peekId) setPeekId(null);
              else if (input) setInput('');
              else inputRef.current?.blur();
            }}
            onSpace={() => {
              if (selectedSession) {
                togglePeek(selectedSession);
                return true;
              }
              return false;
            }}
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
        </div>

        {/* Workspace */}
        <div className="flex-1 min-w-0 hidden md:flex">
          <div className="flex-1 min-w-0">
            <AgentWorkspace
              sessions={sessions}
              openIds={workspace.openIds}
              activeId={workspace.activeId}
              layout={settings.layout}
              onSelect={(id) => setWorkspace((prev) => ({ ...prev, activeId: id }))}
              onClose={closeTab}
              onReorder={reorderTabs}
              onLayoutChange={setLayout}
              onPeek={(id) => setPeekId(id)}
            />
          </div>
          {peekSession && (
            <div className="w-[400px] xl:w-[460px] shrink-0 min-h-0">
              <PeekPanel
                session={peekSession}
                onClose={() => setPeekId(null)}
                onAttach={() => attach(peekSession.id)}
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
            onAttach={() => attach(peekSession.id)}
            onReply={(text) => handleReply(peekSession, text)}
          />
        </div>
      )}

      {/* Modals */}
      <ShortcutsHelp open={showHelp} onClose={() => setShowHelp(false)} />
      <AgentSettingsPanel
        open={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onUpdate={updateSettings}
        userSettings={userSettings}
        daemon={daemon}
        repos={directoryChoices as AgentRepo[]}
        onRefresh={refresh}
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
              <span className="ml-auto text-[10px] uppercase text-gray-600">{choice.source}</span>
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
