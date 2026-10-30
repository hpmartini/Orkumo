import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Code2,
  GitBranch,
  GitBranchPlus,
  Kanban,
  MoreHorizontal,
  Pin,
  Plus,
  SquareTerminal,
  Star,
  Timer,
  Workflow,
} from 'lucide-react';
import type {
  AgentSession,
  AgentGrouping,
  AgentContext,
  AgentCardDetails,
  AgentCardDensity,
  AgentCardElement,
  AgentCardFields,
} from '../../types';
import { DEFAULT_AGENT_CARD_FIELDS } from '../../types';
import {
  AgentServer,
  NavItem,
  SessionGroup,
  SessionLookup,
  stateGlyph,
  sessionAgeMs,
  formatAge,
  shortenPath,
  displayRepo,
  cardDetailsVisible,
  cardSlots,
  CARD_ELEMENTS,
  isWorkflowSession,
  parseWorkflowName,
  workflowIssue,
} from '../../utils/agentSessions';
import { FAVORITES_GROUP_KEY, groupNeighbour } from '../../hooks/useRailPreferences';
import type { AgentConfigLike } from './types';
import { RailNavProps } from './ProjectsRail';
import { IssuePill, PrPill, ServerLinks, SubagentsBadge } from './SessionLinks';
import { CacheBadge } from './CacheBadge';
import { isCacheWarning } from '../../utils/agentCache';

/** Pointer has to rest this long on a card before its details open (hover mode) */
const HOVER_DETAILS_DELAY_MS = 200;

/** Drag payload of a group header (separate from the workspace tab drag) */
export const RAIL_GROUP_MIME = 'application/x-devorbit-rail-group';

export interface AgentRowAction {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface AgentListProps {
  items: NavItem[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onActivate: (item: NavItem) => void;
  onTogglePeek: (session: AgentSession) => void;
  peekId: string | null;
  openIds: Set<string>;
  /** Single click on a session that is already attached: jump into its terminal */
  onFocusOpen?: (id: string) => void;
  now: number;
  grouping: AgentGrouping;
  /** When session cards show their details; "Keep details open" pins them in every mode */
  cardDetails?: AgentCardDetails;
  cardDensity?: AgentCardDensity;
  /** Which card slot each detail element sits in (#159) */
  cardFields?: AgentCardFields;
  /** mw board links, to tell workflow agents from hand-started ones */
  lookup?: SessionLookup;
  /** Repo / issue / sub-agent data per session id (may be empty while loading) */
  contexts: Record<string, AgentContext | undefined>;
  /** Matched DevOrbit dev servers per session id */
  servers: Map<string, AgentServer[]>;
  /** Filters hide everything: show a different empty state */
  filtered?: boolean;
  /** Row PR chip opens the PR panel, filtered to that repo ("owner/repo") */
  onOpenPrs?: (repo: string | null) => void;
  rowActions: (session: AgentSession) => AgentRowAction[];
  groupActions: (group: SessionGroup) => AgentRowAction[];
  /** Session that was just backgrounded/dispatched (rendered bold) */
  highlightedId?: string | null;
  /** Keys of collapsed groups (chevron state) */
  collapsedKeys: Set<string>;
  /** Scrolls together with the list (the rail has a single scroller) */
  top?: React.ReactNode;
  /** Rendered after the session cards, inside the same scroller (remote devices) */
  bottom?: React.ReactNode;
  /** Project grouping: app lookup and navigation for the cluster headers */
  appsById?: Map<string, AgentConfigLike>;
  nav?: RailNavProps;
  /** Keyboard focus is in the rail: selection is solid, otherwise hollow (focus is in a terminal) */
  railFocused?: boolean;
  /** Session open in the workspace: gets a marker, its group is revealed and the row scrolled in */
  activeSessionId?: string | null;
  /** Called when the active session's row is not rendered (group collapsed) so the owner can expand it */
  onRevealActive?: (sessionId: string) => void;
  /** Single click on a group header; falls back to onActivate */
  onToggleGroup?: (key: string) => void;
  favoriteGroupKeys?: Set<string>;
  favoriteSessionIds?: Set<string>;
  /** Rows whose details (PRs, issues, servers) are open */
  expandedSessionIds?: Set<string>;
  onToggleFavoriteGroup?: (key: string) => void;
  /** "+ Issue" in a project group header; gets the group's GitHub repo ("owner/name") */
  onCreateIssue?: (repo: string) => void;
  onToggleFavoriteSession?: (id: string) => void;
  /** Drag-and-drop / menu reorder: move `key` to the position of `targetKey` among `visibleKeys` */
  onMoveGroup?: (key: string, targetKey: string, visibleKeys: string[]) => void;
  /** Board issue keys ("owner/name#12") per session id, derived from the GitHub project */
  issuesByAgent?: Map<string, string[]>;
  onOpenIssue?: (issueKey: string) => void;
}

/** Selected row/header: filled while the rail has focus, outline only while it does not */
export const selectedClass = (focused: boolean) =>
  focused
    ? 'bg-sel text-white [&_.text-gray-300]:text-gray-100 [&_.text-gray-400]:text-gray-200 [&_.text-gray-500]:text-gray-200 [&_.text-gray-500]:text-gray-200 [&_.text-emerald-400]:text-emerald-200 [&_.text-yellow-400]:text-yellow-200 [&_.text-blue-300]:text-blue-100 [&_.text-sky-300]:text-sky-100'
    : 'bg-transparent text-white ring-2 ring-inset ring-cursor';

/** Name and path of a linked worktree for tooltips */
const worktreeTitle = (repo: NonNullable<AgentContext['repo']>) =>
  `worktree${repo.worktreeName ? ` ${repo.worktreeName}` : ''}${repo.worktreePath ? `\n${repo.worktreePath}` : ''}`;

/** Star toggle: hidden until the parent `group` is hovered or focused (always on touch), always visible when set */
const FavoriteButton: React.FC<{
  active: boolean;
  label: string;
  onToggle: () => void;
  alwaysVisible?: boolean;
}> = ({ active, label, onToggle, alwaysVisible }) => (
  <button
    onClick={(e) => {
      e.stopPropagation();
      onToggle();
    }}
    aria-pressed={active}
    aria-label={label}
    title={label}
    className={`shrink-0 flex items-center justify-center min-h-8 min-w-8 rounded hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor ${
      active || alwaysVisible
        ? 'opacity-100'
        : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100'
    } ${active ? 'text-amber-400' : 'text-gray-400 hover:text-white'}`}
  >
    <Star size={11} className={active ? 'fill-current' : ''} />
  </button>
);

/** Hover button for one menu action (same entry as in the context menu); takes no room until hovered, keyboard uses the menu */
const ActionButton: React.FC<{
  action?: AgentRowAction;
  icon: React.ReactNode;
  className?: string;
}> = ({ action, icon, className = 'p-0.5' }) =>
  action && !action.disabled ? (
    <button
      onClick={(e) => {
        e.stopPropagation();
        action.onSelect();
      }}
      className={`shrink-0 rounded text-gray-400 hover:text-white hover:bg-gray-700 hidden group-hover:flex [@media(hover:none)]:flex focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor ${className}`}
      title={action.label}
      aria-label={action.label}
    >
      {icon}
    </button>
  ) : null;

/**
 * Session list with group headers, keyboard selection and per-row menus.
 */
export const AgentList: React.FC<AgentListProps> = ({
  items,
  selectedIndex,
  onSelectIndex,
  onActivate,
  onTogglePeek,
  peekId,
  openIds,
  onFocusOpen,
  now,
  grouping,
  cardDetails = 'hover',
  cardDensity = 'comfortable',
  cardFields = DEFAULT_AGENT_CARD_FIELDS,
  lookup,
  contexts,
  servers,
  filtered,
  onOpenPrs,
  rowActions,
  groupActions,
  highlightedId,
  collapsedKeys,
  top,
  bottom,
  appsById,
  nav,
  railFocused = true,
  activeSessionId,
  onRevealActive,
  onToggleGroup,
  favoriteGroupKeys,
  favoriteSessionIds,
  expandedSessionIds,
  onToggleFavoriteGroup,
  onCreateIssue,
  onToggleFavoriteSession,
  onMoveGroup,
  issuesByAgent,
  onOpenIssue,
}) => {
  // One card per group (its header plus rows); ungrouped items form a single card
  const clusters = items.reduce<number[][]>((acc, item, i) => {
    if (item.type === 'group' || acc.length === 0) acc.push([]);
    acc[acc.length - 1].push(i);
    return acc;
  }, []);
  const listRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ index: number; x: number; y: number } | null>(null);
  // Hovered card; set after a short delay so sweeping the pointer across the list does not flicker
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoverCard = (id: string | null) => {
    clearTimeout(hoverTimer.current);
    if (id === null) setHoveredId(null);
    // Touch screens emulate mouseenter on tap: there the selection and pinning decide
    else if (window.matchMedia?.('(hover: hover)').matches)
      hoverTimer.current = setTimeout(() => setHoveredId(id), HOVER_DETAILS_DELAY_MS);
  };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const comfortable = cardDensity === 'comfortable';
  // One width for the whole list so names stay aligned; wide only when some card fills the column
  const leftElements = CARD_ELEMENTS.filter(({ key }) => cardFields[key] === 'left').map(
    ({ key }) => key
  );
  const leftWide =
    leftElements.some((key) => key !== 'issue' && key !== 'pr') ||
    items.some(
      (item) =>
        item.type === 'session' &&
        ((leftElements.includes('issue') && isWorkflowSession(item.session, lookup)) ||
          (leftElements.includes('pr') && item.session.links.length > 0))
    );

  // Keep the selected row in view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-nav-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Reveal the workspace's active session once per change; never moves focus
  const revealed = useRef<{
    last: string | null;
    scrolled: string | null;
    requested: string | null;
  }>({ last: null, scrolled: null, requested: null });
  useEffect(() => {
    const state = revealed.current;
    if (!activeSessionId) {
      state.last = state.scrolled = state.requested = null;
      return;
    }
    // A different session became active: it may be hidden again even if it was revealed before
    if (state.last !== activeSessionId) {
      state.last = activeSessionId;
      state.requested = null;
    }
    const row = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[data-session-id]') ?? []
    ).find((el) => el.dataset.sessionId === activeSessionId);
    if (row) {
      if (state.scrolled !== activeSessionId) {
        state.scrolled = activeSessionId;
        row.scrollIntoView({ block: 'nearest' });
      }
    } else if (state.requested !== activeSessionId) {
      // Row is hidden in a collapsed group: ask for expansion, the next items render finds it
      state.requested = activeSessionId;
      onRevealActive?.(activeSessionId);
    }
  }, [activeSessionId, items, onRevealActive]);

  // Group drag-and-drop: `drag` is the group being dragged, `dropKey` the hovered target
  const [drag, setDrag] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const groupKeys = items.filter((i) => i.type === 'group').map((i) => i.group.key as string);
  const reorderableKeys = groupKeys.filter((k) => k !== FAVORITES_GROUP_KEY);
  const isFavGroup = (key: string) => !!favoriteGroupKeys?.has(key);
  const canReorder = (key: string) =>
    !!onMoveGroup && key !== FAVORITES_GROUP_KEY && key !== 'all' && reorderableKeys.length > 1;
  // Favorites sort first, so a group only moves within its own favorite/other block
  const canDropOn = (target: string) =>
    !!drag && drag !== target && canReorder(target) && isFavGroup(drag) === isFavGroup(target);
  const neighbour = (key: string, dir: -1 | 1) =>
    groupNeighbour(reorderableKeys, [...(favoriteGroupKeys ?? [])], key, dir);
  const endDrag = () => {
    setDrag(null);
    setDropKey(null);
  };

  // After a keyboard move the selection stays on the moved group, not on its old index
  const followGroup = useRef<string | null>(null);
  useEffect(() => {
    const key = followGroup.current;
    if (!key) return;
    const at = items.findIndex((i) => i.type === 'group' && i.group.key === key);
    if (at >= 0 && at !== selectedIndex) onSelectIndex(at);
    followGroup.current = null;
  }, [items, selectedIndex, onSelectIndex]);

  const menuRef = useRef<HTMLDivElement>(null);
  const menuByKeyboard = useRef(false);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      // Arrow keys are handled by the menu itself
      if (e.key === 'Escape' || e.key === 'Tab') setMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // Keyboard-opened menu takes focus; closing hands it back to the rail
  useEffect(() => {
    if (!menu) return;
    if (menuByKeyboard.current) {
      menuRef.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
      const rail = listRef.current?.closest<HTMLElement>('[data-focus-zone="rail"]');
      return () => {
        menuByKeyboard.current = false;
        rail?.focus();
      };
    }
  }, [menu]);

  const openMenu = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelectIndex(index);
    menuByKeyboard.current = false;
    setMenu({ index, x: e.clientX, y: e.clientY });
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []
    );
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? buttons.length - 1
          : (at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  };

  // ContextMenu / Shift+F10 open the menu for the selected row; Alt+Up/Down moves the selected group.
  // Capture phase: these chords must not reach the rail's own arrow-key navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const rail = listRef.current?.closest('[data-focus-zone="rail"]');
      if (!rail || !(e.target instanceof Node) || !rail.contains(e.target)) return;
      if (menu) return;
      const opensMenu = e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);
      const item = items[selectedIndex];
      if (opensMenu && item) {
        e.preventDefault();
        e.stopPropagation();
        const row = listRef.current?.querySelector<HTMLElement>(
          `[data-nav-index="${selectedIndex}"]`
        );
        const rect = row?.getBoundingClientRect();
        menuByKeyboard.current = true;
        setMenu({
          index: selectedIndex,
          x: (rect?.left ?? 0) + 24,
          y: (rect?.top ?? 0) + (rect?.height ?? 0) / 2,
        });
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (item?.type !== 'group') return;
        const key: string = item.group.key;
        const target = canReorder(key) ? neighbour(key, e.key === 'ArrowUp' ? -1 : 1) : null;
        e.preventDefault();
        e.stopPropagation();
        if (target) {
          followGroup.current = key;
          onMoveGroup?.(key, target, reorderableKeys);
        }
      }
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
  });

  const menuItem = menu ? items[menu.index] : null;
  const favoriteAction = (isFav: boolean, toggle: (() => void) | undefined): AgentRowAction[] =>
    toggle
      ? [
          {
            id: 'favorite',
            label: isFav ? 'Remove from favorites' : 'Add to favorites',
            onSelect: toggle,
          },
        ]
      : [];
  const groupMenuActions = (group: SessionGroup): AgentRowAction[] => {
    const key: string = group.key;
    // The synthetic Favorites section only collapses
    if (key === FAVORITES_GROUP_KEY) return groupActions(group).filter((a) => a.id === 'toggle');
    const [toggle, ...rest] = groupActions(group);
    const up = neighbour(key, -1);
    const down = neighbour(key, 1);
    return [
      toggle,
      ...favoriteAction(
        isFavGroup(key),
        onToggleFavoriteGroup && (() => onToggleFavoriteGroup(key))
      ),
      ...(canReorder(key)
        ? [
            {
              id: 'move-up',
              label: 'Move up',
              disabled: !up,
              onSelect: () => up && onMoveGroup?.(key, up, reorderableKeys),
            },
            {
              id: 'move-down',
              label: 'Move down',
              disabled: !down,
              onSelect: () => down && onMoveGroup?.(key, down, reorderableKeys),
            },
          ]
        : []),
      ...rest,
    ];
  };
  const menuActions: AgentRowAction[] =
    menuItem?.type === 'session'
      ? [
          ...favoriteAction(
            !!favoriteSessionIds?.has(menuItem.session.id),
            onToggleFavoriteSession && (() => onToggleFavoriteSession(menuItem.session.id))
          ),
          ...rowActions(menuItem.session),
        ]
      : menuItem?.type === 'group'
        ? groupMenuActions(menuItem.group)
        : [];

  return (
    <div ref={listRef} className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 thin-scrollbar">
      {top}
      <div className="p-2 space-y-2" role="listbox" aria-label="Agent sessions">
        {items.length === 0 && (
          <div className="px-4 py-8 text-sm text-gray-400 text-center">
            {filtered ? (
              'No agents match the current filters.'
            ) : (
              <>
                No sessions yet. Press <kbd className="kbd">Ctrl/Cmd+P</kbd> and choose New task to
                start one.
              </>
            )}
          </div>
        )}
        {clusters.map((cluster, clusterIndex) => {
          // Drop indicator: a line in the gap where the dragged group lands (it takes the target's slot)
          const head = items[cluster[0]];
          const headKey = head?.type === 'group' ? (head.group.key as string) : null;
          const prevHead = clusterIndex > 0 ? items[clusters[clusterIndex - 1][0]] : null;
          const isFavCluster = (key: string | null) =>
            key !== null && (key === FAVORITES_GROUP_KEY || isFavGroup(key));
          // Favourites sort first; a rule marks where the rest begins
          const afterFavorites =
            prevHead?.type === 'group' &&
            isFavCluster(prevHead.group.key as string) &&
            !isFavCluster(headKey);
          const dropLine =
            drag && headKey !== null && dropKey === headKey
              ? reorderableKeys.indexOf(drag) < reorderableKeys.indexOf(headKey)
                ? 'bottom'
                : 'top'
              : null;
          return (
            <div
              key={`card-${cluster[0]}`}
              role="presentation"
              className={`relative ${afterFavorites ? 'pt-5' : ''}`}
            >
              {afterFavorites && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1.5 inset-x-10 h-px bg-gradient-to-r from-transparent via-gray-500/50 to-transparent"
                />
              )}
              {dropLine && (
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-blue-300 ${
                    dropLine === 'top' ? '-top-[5px]' : '-bottom-[5px]'
                  }`}
                />
              )}
              {/* No overflow-hidden: hover details float out of the card (#159); children round instead */}
              <div className="rounded-lg border border-gray-700 bg-gray-850 [&>*:first-child]:rounded-t-lg [&>*:last-child]:rounded-b-lg">
                {cluster.map((index) => {
                  const item = items[index];
                  const selected = index === selectedIndex;
                  if (item.type === 'group') {
                    const count = item.group.sessions.length + item.group.hidden.length;
                    const collapsed = collapsedKeys.has(item.group.key);
                    const groupKey: string = item.group.key;
                    const isFavSection = groupKey === FAVORITES_GROUP_KEY;
                    // Same for every agent of a project, so shown once here
                    const groupIssues =
                      (grouping === 'project' || grouping === 'directory') && !isFavSection
                        ? item.group.sessions
                            .map((s) => contexts[s.id]?.issues)
                            .find((i) => i && i.open > 0) || null
                        : null;
                    // Repo of the project's agents; groups without a GitHub origin get no "+ Issue"
                    const groupRepo =
                      onCreateIssue && grouping === 'project' && !isFavSection
                        ? item.group.sessions
                            .map((s) => contexts[s.id]?.repo?.slug)
                            .find(Boolean) || null
                        : null;
                    const groupFav = isFavGroup(groupKey);
                    const headerActions = isFavSection ? [] : groupActions(item.group);
                    const groupSessions = [...item.group.sessions, ...item.group.hidden];
                    const attachedCount = groupSessions.filter((s) => openIds.has(s.id)).length;
                    const groupHasActive =
                      !!activeSessionId && groupSessions.some((s) => s.id === activeSessionId);
                    const groupCacheWarning = groupSessions.some((s) =>
                      isCacheWarning(contexts[s.id]?.cache, now)
                    );
                    const app = item.group.appId ? appsById?.get(item.group.appId) : undefined;
                    return (
                      <div
                        key={`group-${item.group.key}`}
                        data-nav-index={index}
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          onSelectIndex(index);
                          if (onToggleGroup) onToggleGroup(item.group.key);
                          else onActivate(item);
                        }}
                        onContextMenu={(e) => openMenu(index, e)}
                        draggable={canReorder(groupKey)}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(RAIL_GROUP_MIME, groupKey);
                          e.dataTransfer.effectAllowed = 'move';
                          setDrag(groupKey);
                        }}
                        onDragOver={(e) => {
                          if (!canDropOn(groupKey)) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          setDropKey(groupKey);
                        }}
                        onDragLeave={() => setDropKey((k) => (k === groupKey ? null : k))}
                        onDrop={(e) => {
                          if (!drag || !canDropOn(groupKey)) return;
                          e.preventDefault();
                          onMoveGroup?.(drag, groupKey, reorderableKeys);
                          endDrag();
                        }}
                        onDragEnd={endDrag}
                        className={`group flex items-center gap-2 px-3 py-2 text-xs font-semibold cursor-pointer select-none ${groupCacheWarning ? 'border-l-2 border-l-amber-400 ' : ''}${drag === groupKey ? 'opacity-50 ' : ''}${
                          selected
                            ? selectedClass(railFocused)
                            : `bg-gray-800 text-gray-300 hover:text-white ${collapsed ? '' : 'border-b border-gray-700'}`
                        }`}
                        title={grouping === 'directory' ? item.group.title : item.group.cwd}
                      >
                        <button
                          aria-expanded={!collapsed}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectIndex(index);
                            if (onToggleGroup) onToggleGroup(item.group.key);
                            else onActivate(item);
                          }}
                          className="p-1 -m-1 text-gray-400 hover:text-white rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
                          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${item.group.title}`}
                        >
                          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        </button>
                        {app && nav ? (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                nav.onOpenProject(app.id);
                              }}
                              className="truncate min-w-0 text-sm font-medium text-gray-100 hover:text-white hover:underline"
                              title={`Open ${app.name}\n${app.path}`}
                            >
                              {item.group.title}
                            </button>
                          </>
                        ) : (
                          <span className="truncate min-w-0">
                            {grouping === 'directory'
                              ? shortenPath(item.group.title, 42)
                              : item.group.title}
                          </span>
                        )}
                        <span className="shrink-0 rounded-full bg-gray-900/60 px-1.5 text-[11px] font-normal tabular-nums text-gray-300">
                          {count}
                        </span>
                        {attachedCount > 0 && (
                          <span
                            className={`shrink-0 ${groupHasActive ? 'text-blue-300' : 'text-blue-300/60'}`}
                            title={`${attachedCount} agent${attachedCount === 1 ? '' : 's'} attached${groupHasActive ? ', one shown in the workspace' : ''}`}
                          >
                            <SquareTerminal size={12} aria-hidden="true" />
                            <span className="sr-only">{attachedCount} attached</span>
                          </span>
                        )}
                        {groupCacheWarning && (
                          <span
                            className="shrink-0 text-amber-300"
                            title="Prompt cache of an agent here expires within 10 minutes"
                          >
                            <Timer size={12} aria-hidden="true" />
                            <span className="sr-only">cache expiring</span>
                          </span>
                        )}
                        <span className="flex-1" />
                        {groupIssues && (
                          <a
                            href={groupIssues.url || undefined}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="shrink-0 flex items-center gap-1 text-[11px] font-normal text-gray-400 hover:text-white tabular-nums"
                            title={`${groupIssues.open} open issue${groupIssues.open === 1 ? '' : 's'} in the repository`}
                          >
                            <CircleDot size={11} />
                            {groupIssues.open}
                          </a>
                        )}
                        <ActionButton
                          action={headerActions.find((a) => a.id === 'view-code')}
                          icon={<Code2 size={12} />}
                        />
                        <ActionButton
                          action={headerActions.find((a) => a.id === 'view-board')}
                          icon={<Kanban size={12} />}
                        />
                        {groupRepo && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onCreateIssue?.(groupRepo);
                            }}
                            className="shrink-0 p-0.5 rounded text-gray-400 hover:text-white hover:bg-gray-700 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
                            title={`Neues Issue in ${groupRepo}`}
                            aria-label={`Neues Issue in ${groupRepo}`}
                          >
                            <Plus size={12} />
                          </button>
                        )}
                        {isFavSection ? (
                          <Star size={11} className="shrink-0 fill-amber-400 text-amber-400" />
                        ) : (
                          onToggleFavoriteGroup && (
                            <FavoriteButton
                              active={groupFav}
                              label={`${groupFav ? 'Remove' : 'Add'} ${item.group.title} ${groupFav ? 'from' : 'to'} favorites`}
                              onToggle={() => onToggleFavoriteGroup(groupKey)}
                            />
                          )
                        )}
                      </div>
                    );
                  }
                  if (item.type === 'more') {
                    return (
                      <div
                        key={`more-${item.group.key}`}
                        data-nav-index={index}
                        role="option"
                        aria-selected={selected}
                        onClick={() => onSelectIndex(index)}
                        onDoubleClick={() => onActivate(item)}
                        className={`px-6 py-1.5 text-xs cursor-pointer ${selected ? selectedClass(railFocused) : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
                      >
                        … {item.count} more
                      </div>
                    );
                  }
                  const { session } = item;
                  const glyph = stateGlyph(session.displayState);
                  const age = formatAge(sessionAgeMs(session, now));
                  const isPeeking = peekId === session.id;
                  const isOpen = openIds.has(session.id);
                  const isActive = activeSessionId === session.id;
                  const isFav = !!favoriteSessionIds?.has(session.id);
                  const ctx = contexts[session.id];
                  const repo = displayRepo(session, ctx);
                  // Stopped DevOrbit apps only carry their configured port: not worth a row entry
                  const sessionServers = (servers.get(session.id) || []).filter((s) => s.running);
                  const issueKeys = (onOpenIssue && issuesByAgent?.get(session.id)) || [];
                  const workflow = workflowIssue(session, lookup, issueKeys);
                  const displayName = parseWorkflowName(session.name)?.title || session.name;
                  // Project groups already name the repo in their header
                  const showProject =
                    grouping !== 'project' || (item.group.key as string) === FAVORITES_GROUP_KEY;
                  const cacheWarning = isCacheWarning(ctx?.cache, now);
                  const actions = rowActions(session);
                  const extra =
                    session.state === 'blocked' && session.waitingFor
                      ? `waiting: ${session.waitingFor}`
                      : session.state === 'working'
                        ? session.detail
                        : null;
                  const nodes: Record<AgentCardElement, React.ReactNode> = {
                    issue:
                      workflow &&
                      (workflow.key && onOpenIssue ? (
                        <IssuePill
                          issueKey={workflow.key}
                          repoSlug={workflow.key.slice(0, workflow.key.lastIndexOf('#'))}
                          onOpen={onOpenIssue}
                        />
                      ) : (
                        <span
                          className="shrink-0 font-mono leading-4 px-1 rounded border border-gray-600 text-gray-300"
                          title={`Issue #${workflow.number}`}
                        >
                          #{workflow.number}
                        </span>
                      )),
                    pr: session.links.length > 0 && (
                      <PrPill session={session} repoSlug={ctx?.repo?.slug} onOpenPrs={onOpenPrs} />
                    ),
                    project: showProject && repo && (
                      <span
                        className="shrink-0 max-w-[45%] truncate leading-4 px-1 rounded border border-gray-600 text-gray-300"
                        title={repo.slug || repo.name}
                      >
                        {repo.name}
                      </span>
                    ),
                    branch: repo?.branch && (
                      <span
                        className="flex items-center gap-1 min-w-0"
                        title={[
                          repo.slug || repo.name,
                          `branch ${repo.branch}`,
                          repo.isWorktree ? worktreeTitle(repo) : null,
                        ]
                          .filter(Boolean)
                          .join('\n')}
                      >
                        {repo.isWorktree ? (
                          <GitBranchPlus size={10} className="shrink-0 text-sky-300" />
                        ) : (
                          <GitBranch size={10} className="shrink-0 text-gray-500" />
                        )}
                        <span className="truncate min-w-0 text-gray-300">{repo.branch}</span>
                        {repo.isWorktree && (
                          <span
                            className="shrink-0 rounded border border-sky-300/40 px-1 text-[11px] leading-4 text-sky-300"
                            title={`Git ${worktreeTitle(repo)}`}
                          >
                            worktree
                          </span>
                        )}
                      </span>
                    ),
                    git: repo && (repo.dirty || repo.ahead > 0 || repo.behind > 0) && (
                      <span
                        className="flex items-center gap-1 shrink-0 text-gray-500 tabular-nums"
                        title={[
                          repo.dirty ? 'uncommitted changes' : null,
                          repo.ahead ? `${repo.ahead} ahead of upstream` : null,
                          repo.behind ? `${repo.behind} behind upstream` : null,
                        ]
                          .filter(Boolean)
                          .join('\n')}
                      >
                        {repo.dirty && (
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-amber-400"
                            aria-label="Uncommitted changes"
                          />
                        )}
                        {repo.ahead > 0 && (
                          <span className="flex items-center">
                            <ArrowUp size={9} />
                            {repo.ahead}
                          </span>
                        )}
                        {repo.behind > 0 && (
                          <span className="flex items-center">
                            <ArrowDown size={9} />
                            {repo.behind}
                          </span>
                        )}
                      </span>
                    ),
                    metrics: ctx?.cache && <CacheBadge cache={ctx.cache} />,
                    status: extra && <span className="truncate min-w-0">{extra}</span>,
                    links: issueKeys
                      .filter((key) => key !== workflow?.key)
                      .map((key) => (
                        <IssuePill
                          key={key}
                          issueKey={key}
                          repoSlug={ctx?.repo?.slug}
                          onOpen={onOpenIssue}
                        />
                      )),
                    servers: sessionServers.length > 0 && (
                      <ServerLinks session={session} servers={sessionServers} />
                    ),
                    subagents: (ctx?.subagents.running || 0) > 0 && <SubagentsBadge ctx={ctx} />,
                  };
                  const slot = cardSlots(cardFields, nodes, (node, key) => (
                    <React.Fragment key={key}>{node}</React.Fragment>
                  ));
                  // Compact: row 3 joins row 2
                  const row2 = comfortable ? slot.row2 : [...slot.row2, ...slot.row3];
                  const row3 = comfortable ? slot.row3 : [];
                  const hasDetails = slot.details.length > 0;
                  const pinned = hasDetails && !!expandedSessionIds?.has(session.id);
                  const expanded = cardDetailsVisible(cardDetails, {
                    hasDetails,
                    pinned,
                    hovered: hoveredId === session.id,
                    focused: selected && railFocused,
                  });
                  // Transient details float over the cards below instead of pushing them down
                  const overlay = expanded && !pinned && cardDetails !== 'always';
                  return (
                    <div
                      key={session.id}
                      data-nav-index={index}
                      data-session-id={session.id}
                      role="option"
                      aria-selected={selected}
                      aria-current={isActive || undefined}
                      onClick={() => {
                        onSelectIndex(index);
                        if (isOpen) onFocusOpen?.(session.id);
                      }}
                      onDoubleClick={() => onActivate(item)}
                      onContextMenu={(e) => openMenu(index, e)}
                      onMouseEnter={() => hoverCard(session.id)}
                      onMouseLeave={() => hoverCard(null)}
                      className={`group relative flex items-start gap-2 px-3 ${comfortable ? 'py-2.5' : 'py-1.5'} text-sm cursor-pointer border-t border-gray-700/60 first:border-t-0 ${
                        overlay ? 'z-20' : ''
                      } ${
                        // Outline, not ring: stays visible on top of the selection ring
                        isActive ? 'outline outline-2 -outline-offset-2 outline-blue-400' : ''
                      } ${
                        selected
                          ? selectedClass(railFocused)
                          : `text-gray-300 hover:bg-gray-800 ${isActive ? 'bg-blue-400/15' : ''} ${isPeeking ? 'ring-1 ring-inset ring-blue-300/50' : cacheWarning ? 'ring-1 ring-inset ring-amber-400/70 bg-amber-400/5' : ''}`
                      }`}
                      title={`${session.name}\n${session.id} · ${session.cwd}${session.waitingFor ? ` · waiting for ${session.waitingFor}` : ''}`}
                    >
                      <div
                        className={`${leftWide ? 'w-11' : 'w-4'} shrink-0 flex flex-col items-center gap-1 text-[10px]`}
                      >
                        <span
                          className={`leading-5 text-sm ${glyph.className} ${glyph.animate ? 'animate-pulse motion-reduce:animate-none' : ''}`}
                          aria-hidden="true"
                          title={glyph.label}
                        >
                          {glyph.glyph}
                        </span>
                        {slot.left}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0 leading-5">
                          <span className="sr-only">{glyph.label}: </span>
                          <span
                            className={`truncate ${highlightedId === session.id ? 'font-bold' : 'font-medium'}`}
                          >
                            {displayName}
                          </span>
                          {slot.title.length > 0 && (
                            <span className="flex items-center gap-1 shrink-0 text-[11px] text-gray-400">
                              {slot.title}
                            </span>
                          )}
                          {session.pinned && <Pin size={10} className="text-blue-300 shrink-0" />}
                          {isOpen && (
                            <span
                              className="shrink-0 text-blue-300"
                              title={
                                isActive ? 'Attached, shown in the workspace' : 'Attached in a tab'
                              }
                            >
                              <SquareTerminal size={11} aria-hidden="true" />
                              <span className="sr-only">{isActive ? 'active' : 'attached'}</span>
                            </span>
                          )}
                          {session.loop && <span className="text-[11px] text-blue-300">loop</span>}
                          <span className="flex-1" />
                          <span className="text-xs text-gray-500 font-mono shrink-0" title="Age">
                            {age}
                          </span>
                        </div>
                        {row2.length > 0 && (
                          <div
                            className={`flex items-center gap-1.5 h-5 text-[11px] text-gray-400 min-w-0 overflow-hidden ${comfortable ? 'mt-1' : 'mt-0.5'}`}
                          >
                            {row2}
                          </div>
                        )}
                        {row3.length > 0 && (
                          <div className="flex items-center gap-1.5 h-5 mt-0.5 text-[11px] text-gray-400 min-w-0 overflow-hidden">
                            {row3}
                          </div>
                        )}
                        {slot.row4.length > 0 && (
                          <div
                            className={`flex items-center gap-1.5 text-xs min-w-0 overflow-hidden ${comfortable ? 'mt-1.5 text-gray-400' : 'mt-0.5 text-gray-500'}`}
                          >
                            {slot.row4}
                          </div>
                        )}
                        {expanded && (
                          <div
                            data-card-details
                            data-overlay={overlay || undefined}
                            className={`flex flex-wrap items-center gap-x-3 text-[11px] text-gray-400 ${
                              overlay
                                ? `absolute inset-x-0 top-full -mt-px py-2 pr-3 gap-y-1.5 bg-gray-800 border-b border-x border-gray-600 rounded-b-lg shadow-lg shadow-black/50 ${leftWide ? 'pl-16' : 'pl-9'}`
                                : comfortable
                                  ? 'mt-2 pt-2 gap-y-1.5 border-t border-gray-700/60'
                                  : 'mt-1.5 gap-y-1'
                            }`}
                          >
                            {slot.details}
                          </div>
                        )}
                      </div>
                      <div className="relative flex flex-col items-center shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onTogglePeek(session);
                          }}
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
                          title="Peek (Space)"
                          aria-label="Peek"
                        >
                          <MoreHorizontal size={12} />
                        </button>
                        {/* Hover strip beside Peek: a column would grow the card on hover (#159) */}
                        <div className="absolute right-full top-0 flex rounded bg-gray-800 [@media(hover:none)]:static [@media(hover:none)]:flex-col [@media(hover:none)]:bg-transparent">
                          <ActionButton
                            action={actions.find((a) => a.id === 'board')}
                            icon={<Kanban size={12} />}
                            className="p-1.5"
                          />
                          <ActionButton
                            action={actions.find((a) => a.id === 'workflow')}
                            icon={<Workflow size={12} />}
                            className="p-1.5"
                          />
                        </div>
                        {onToggleFavoriteSession && (
                          <FavoriteButton
                            active={isFav}
                            alwaysVisible={isActive}
                            label={`${isFav ? 'Remove' : 'Add'} ${session.name} ${isFav ? 'from' : 'to'} favorites`}
                            onToggle={() => onToggleFavoriteSession(session.id)}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {bottom}

      {menu && menuActions.length > 0 && (
        <div
          className="fixed z-50 w-max min-w-[10rem] max-w-[14rem] bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 text-sm"
          role="menu"
          ref={menuRef}
          onKeyDown={onMenuKeyDown}
          style={{
            left: Math.min(menu.x, window.innerWidth - 232),
            top: Math.min(menu.y, window.innerHeight - 320),
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {menuActions.map((action) => (
            <button
              key={action.id}
              disabled={action.disabled}
              onClick={() => {
                setMenu(null);
                action.onSelect();
              }}
              role="menuitem"
              title={action.label}
              className={`block w-full truncate text-left px-3 py-1.5 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed ${
                action.danger ? 'text-red-300' : 'text-gray-200'
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
