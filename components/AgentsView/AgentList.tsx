import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Pin,
  MoreHorizontal,
  ExternalLink,
  GitBranch,
  GitBranchPlus,
  Star,
  ArrowUp,
  ArrowDown,
  CircleDot,
  Bot,
  SquareTerminal,
} from 'lucide-react';
import type { AgentSession, AgentGrouping, AgentContext } from '../../types';
import {
  AgentServer,
  NavItem,
  SessionGroup,
  stateGlyph,
  prLabel,
  sessionAgeMs,
  formatAge,
  shortenPath,
} from '../../utils/agentSessions';
import { FAVORITES_GROUP_KEY, groupNeighbour } from '../../hooks/useRailPreferences';
import type { AgentConfigLike } from './types';
import { AppPowerButton, AppStatusDot, RailNavProps } from './ProjectsRail';

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
  onToggleFavoriteGroup?: (key: string) => void;
  onToggleFavoriteSession?: (id: string) => void;
  /** Drag-and-drop / menu reorder: move `key` to the position of `targetKey` among `visibleKeys` */
  onMoveGroup?: (key: string, targetKey: string, visibleKeys: string[]) => void;
  /** Board issue keys ("owner/name#12") per session id, derived from the GitHub project */
  issuesByAgent?: Map<string, string[]>;
  onOpenIssue?: (issueKey: string) => void;
}

const MAX_ISSUE_CHIPS = 3;

/** Selected row/header: filled while the rail has focus, outline only while it does not */
export const selectedClass = (focused: boolean) =>
  focused
    ? 'bg-sel text-white [&_.text-gray-300]:text-gray-100 [&_.text-gray-400]:text-gray-200 [&_.text-gray-500]:text-gray-200 [&_.text-gray-500]:text-gray-200 [&_.text-emerald-400]:text-emerald-200 [&_.text-yellow-400]:text-yellow-200 [&_.text-blue-300]:text-blue-100 [&_.text-sky-300]:text-sky-100'
    : 'bg-transparent text-white ring-2 ring-inset ring-cursor';

/** Name and path of a linked worktree for tooltips */
const worktreeTitle = (repo: NonNullable<AgentContext['repo']>) =>
  `worktree${repo.worktreeName ? ` ${repo.worktreeName}` : ''}${repo.worktreePath ? `\n${repo.worktreePath}` : ''}`;

/** Text cue (not only colour) for the session open in the workspace */
const ActivePill: React.FC = () => (
  <span className="shrink-0 rounded border border-blue-300/50 px-1 text-[11px] font-normal leading-4 text-blue-200">
    active
  </span>
);

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
  onToggleFavoriteGroup,
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
        {clusters.map((cluster) => {
          // Drop indicator: a line in the gap where the dragged group lands (it takes the target's slot)
          const head = items[cluster[0]];
          const headKey = head?.type === 'group' ? (head.group.key as string) : null;
          const dropLine =
            drag && headKey !== null && dropKey === headKey
              ? reorderableKeys.indexOf(drag) < reorderableKeys.indexOf(headKey)
                ? 'bottom'
                : 'top'
              : null;
          return (
            <div key={`card-${cluster[0]}`} role="presentation" className="relative">
              {dropLine && (
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-blue-300 ${
                    dropLine === 'top' ? '-top-[5px]' : '-bottom-[5px]'
                  }`}
                />
              )}
              <div className="rounded-lg border border-gray-700 bg-gray-850 overflow-hidden">
                {cluster.map((index) => {
                  const item = items[index];
                  const selected = index === selectedIndex;
                  if (item.type === 'group') {
                    const count = item.group.sessions.length + item.group.hidden.length;
                    const collapsed = collapsedKeys.has(item.group.key);
                    const groupKey: string = item.group.key;
                    const isFavSection = groupKey === FAVORITES_GROUP_KEY;
                    const groupFav = isFavGroup(groupKey);
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
                        className={`group flex items-center gap-2 px-3 py-2 text-xs font-semibold cursor-pointer select-none ${''}${drag === groupKey ? 'opacity-50 ' : ''}${
                          selected
                            ? selectedClass(railFocused)
                            : `bg-gray-800 text-gray-300 hover:text-white ${collapsed ? '' : 'border-b border-gray-700'}`
                        }`}
                        title={grouping === 'directory' ? item.group.title : undefined}
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
                            <AppStatusDot status={app.status} />
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
                        {collapsed &&
                          activeSessionId &&
                          [...item.group.sessions, ...item.group.hidden].some(
                            (s) => s.id === activeSessionId
                          ) && <ActivePill />}
                        <span className="flex-1" />
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
                        {app && nav && (
                          <span className="shrink-0">
                            <AppPowerButton app={app} nav={nav} />
                          </span>
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
                  const label = prLabel(session.links);
                  const age = formatAge(sessionAgeMs(session, now));
                  const isPeeking = peekId === session.id;
                  const isOpen = openIds.has(session.id);
                  const isActive = activeSessionId === session.id;
                  const isFav = !!favoriteSessionIds?.has(session.id);
                  const ctx = contexts[session.id];
                  const sessionServers = servers.get(session.id) || [];
                  const issueKeys = (onOpenIssue && issuesByAgent?.get(session.id)) || [];
                  const extra =
                    session.state === 'blocked' && session.waitingFor
                      ? `waiting: ${session.waitingFor}`
                      : session.state === 'working'
                        ? session.detail
                        : null;
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
                      className={`group flex items-start gap-2 px-3 py-2 text-sm cursor-pointer border-t border-gray-700/60 first:border-t-0 ${
                        selected
                          ? selectedClass(railFocused)
                          : `text-gray-300 hover:bg-gray-800 ${isActive ? 'bg-blue-400/15' : ''} ${isPeeking ? 'ring-1 ring-inset ring-blue-300/50' : ''}`
                      }`}
                      title={`${session.id} · ${session.cwd}${session.waitingFor ? ` · waiting for ${session.waitingFor}` : ''}`}
                    >
                      <span
                        className={`w-4 text-center shrink-0 leading-5 ${glyph.className} ${glyph.animate ? 'animate-pulse motion-reduce:animate-none' : ''}`}
                        aria-hidden="true"
                        title={glyph.label}
                      >
                        {glyph.glyph}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0 leading-5">
                          <span className="sr-only">{glyph.label}: </span>
                          <span
                            className={`truncate ${highlightedId === session.id ? 'font-bold' : 'font-medium'}`}
                          >
                            {session.name}
                          </span>
                          {session.pinned && <Pin size={10} className="text-blue-300 shrink-0" />}
                          {isOpen && (
                            <span
                              className="shrink-0 inline-flex items-center gap-0.5 rounded border border-blue-300/50 px-1 text-[11px] font-normal leading-4 text-blue-200"
                              title={
                                isActive ? 'Attached, shown in the workspace' : 'Attached in a tab'
                              }
                            >
                              <SquareTerminal size={10} aria-hidden="true" />
                              {isActive ? 'active' : 'attached'}
                            </span>
                          )}
                          {session.loop && <span className="text-[11px] text-blue-300">loop</span>}
                          <span className="flex-1" />
                          <span className="text-xs text-gray-500 font-mono shrink-0" title="Age">
                            {age}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 h-5 text-[11px] text-gray-400 min-w-0">
                          {/* Repository + branch */}
                          <span className="flex-1 min-w-0 flex items-center gap-1">
                            {ctx?.repo && (
                              <span
                                className="flex items-center gap-1 min-w-0 max-w-full overflow-hidden"
                                title={[
                                  ctx.repo.slug || ctx.repo.name,
                                  ctx.repo.branch ? `branch ${ctx.repo.branch}` : 'detached HEAD',
                                  ctx.repo.isWorktree ? worktreeTitle(ctx.repo) : null,
                                  ctx.repo.dirty ? 'uncommitted changes' : null,
                                  ctx.repo.ahead ? `${ctx.repo.ahead} ahead of upstream` : null,
                                  ctx.repo.behind ? `${ctx.repo.behind} behind upstream` : null,
                                ]
                                  .filter(Boolean)
                                  .join('\n')}
                              >
                                {ctx.repo.isWorktree ? (
                                  <GitBranchPlus size={10} className="shrink-0 text-sky-300" />
                                ) : (
                                  <GitBranch size={10} className="shrink-0 text-gray-500" />
                                )}
                                <span className="truncate text-gray-300 min-w-[3.5rem] shrink-0 max-w-[60%]">
                                  {ctx.repo.name}
                                </span>
                                {ctx.repo.branch && (
                                  <span className="truncate text-gray-500 min-w-0 shrink-[2]">
                                    {ctx.repo.branch}
                                  </span>
                                )}
                                {ctx.repo.isWorktree && (
                                  <span
                                    className="shrink-0 rounded border border-sky-300/40 px-1 text-[11px] leading-4 text-sky-300"
                                    title={`Git ${worktreeTitle(ctx.repo)}`}
                                  >
                                    worktree
                                  </span>
                                )}
                                {ctx.repo.dirty && (
                                  <span
                                    className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                                    aria-label="Uncommitted changes"
                                  />
                                )}
                                {ctx.repo.ahead > 0 && (
                                  <span className="flex items-center shrink-0 text-gray-500 tabular-nums">
                                    <ArrowUp size={9} />
                                    {ctx.repo.ahead}
                                  </span>
                                )}
                                {ctx.repo.behind > 0 && (
                                  <span className="flex items-center shrink-0 text-gray-500 tabular-nums">
                                    <ArrowDown size={9} />
                                    {ctx.repo.behind}
                                  </span>
                                )}
                              </span>
                            )}
                          </span>
                          {/* Pull request */}
                          <span className="shrink-0 flex justify-end">
                            {label && onOpenPrs ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenPrs(ctx?.repo?.slug || null);
                                }}
                                data-popover-trigger
                                className={`font-mono px-1 rounded border ${label.className} flex items-center gap-0.5 hover:bg-gray-800`}
                                title={`List pull requests${ctx?.repo?.slug ? ` of ${ctx.repo.slug}` : ''}`}
                              >
                                {label.text}
                              </button>
                            ) : (
                              label && (
                                <a
                                  href={label.href || undefined}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className={`font-mono px-1 rounded border ${label.className} flex items-center gap-0.5`}
                                  title={`Open pull request${session.links.length > 1 ? 's' : ''}\n${session.links.map((l) => l.href).join('\n')}`}
                                >
                                  {label.text}
                                  {label.href && <ExternalLink size={9} />}
                                </a>
                              )
                            )}
                          </span>
                          {/* Open issues */}
                          <span className="shrink-0 flex justify-end">
                            {ctx?.issues && ctx.issues.open > 0 && (
                              <a
                                href={ctx.issues.url || undefined}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-0.5 text-gray-400 hover:text-white tabular-nums"
                                title={`${ctx.issues.open} open issue${ctx.issues.open === 1 ? '' : 's'} in the repository`}
                              >
                                <CircleDot size={10} />
                                {ctx.issues.open}
                              </a>
                            )}
                          </span>
                          {/* Dev servers */}
                          <span className="shrink-0 flex justify-end gap-1">
                            {sessionServers.slice(0, 2).map((server) => (
                              <a
                                key={server.port}
                                href={`http://localhost:${server.port}`}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className={`font-mono hover:underline ${server.running ? 'text-emerald-400' : 'text-gray-500'}`}
                                title={`${server.command || server.name}: port ${server.port} (${server.running ? 'running' : 'not running'})${server.pid ? `, pid ${server.pid}` : ''}\n${session.worktree || session.cwd}\nClick to open`}
                              >
                                :{server.port}
                              </a>
                            ))}
                            {sessionServers.length > 2 && (
                              <span
                                className="text-gray-500"
                                title={sessionServers
                                  .slice(2)
                                  .map((s) => `:${s.port} ${s.name}`)
                                  .join('\n')}
                              >
                                +{sessionServers.length - 2}
                              </span>
                            )}
                          </span>
                          {/* Running sub-agents */}
                          <span className="shrink-0 flex justify-end">
                            {ctx && ctx.subagents.running > 0 && (
                              <span
                                className="flex items-center gap-0.5 text-sky-300 tabular-nums motion-safe:animate-pulse"
                                title={`${ctx.subagents.running} running sub-agent${ctx.subagents.running === 1 ? '' : 's'}${ctx.subagents.names.length ? `\n${ctx.subagents.names.join('\n')}` : ''}`}
                              >
                                <Bot size={10} />
                                {ctx.subagents.running}
                              </span>
                            )}
                          </span>
                        </div>
                        {extra && (
                          <div className="text-xs text-gray-500 truncate mt-0.5">{extra}</div>
                        )}
                        {issueKeys.length > 0 && (
                          <div className="flex items-center gap-1 mt-1 text-[11px] min-w-0">
                            {issueKeys.slice(0, MAX_ISSUE_CHIPS).map((key) => (
                              <button
                                key={key}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenIssue?.(key);
                                }}
                                className="font-mono px-1 rounded border border-gray-600 text-gray-300 hover:text-white hover:bg-gray-800 truncate max-w-[10rem] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
                                title={`Open ${key} on the board`}
                              >
                                {key.slice(key.indexOf('/') + 1)}
                              </button>
                            ))}
                            {issueKeys.length > MAX_ISSUE_CHIPS && (
                              <span
                                className="text-gray-500"
                                title={issueKeys.slice(MAX_ISSUE_CHIPS).join('\n')}
                              >
                                +{issueKeys.length - MAX_ISSUE_CHIPS}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-center shrink-0">
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
