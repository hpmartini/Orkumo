import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Pin,
  MoreHorizontal,
  ExternalLink,
  GitBranch,
  ArrowUp,
  ArrowDown,
  CircleDot,
  Bot,
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
import type { AgentConfigLike } from './types';
import { AppPowerButton, AppStatusDot, RailNavProps } from './ProjectsRail';

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
}

/** Selected row/header: filled while the rail has focus, outline only while it does not */
const selectedClass = (focused: boolean) =>
  focused
    ? 'bg-sel text-white [&_.text-gray-300]:text-gray-100 [&_.text-gray-400]:text-gray-200 [&_.text-gray-500]:text-gray-200 [&_.text-gray-500]:text-gray-200 [&_.text-emerald-400]:text-emerald-200 [&_.text-yellow-400]:text-yellow-200 [&_.text-blue-300]:text-blue-100 [&_.text-sky-300]:text-sky-100'
    : 'bg-transparent text-white ring-2 ring-inset ring-cursor';

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

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menu]);

  const openMenu = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelectIndex(index);
    setMenu({ index, x: e.clientX, y: e.clientY });
  };

  const menuItem = menu ? items[menu.index] : null;
  const menuActions: AgentRowAction[] =
    menuItem?.type === 'session'
      ? rowActions(menuItem.session)
      : menuItem?.type === 'group'
        ? groupActions(menuItem.group)
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
        {clusters.map((cluster) => (
          <div
            key={`card-${cluster[0]}`}
            role="presentation"
            className="rounded-lg border border-gray-700 bg-gray-850 overflow-hidden"
          >
            {cluster.map((index) => {
              const item = items[index];
              const selected = index === selectedIndex;
              if (item.type === 'group') {
                const count = item.group.sessions.length + item.group.hidden.length;
                const collapsed = collapsedKeys.has(item.group.key);
                const app = item.group.appId ? appsById?.get(item.group.appId) : undefined;
                return (
                  <div
                    key={`group-${item.group.key}`}
                    data-nav-index={index}
                    role="option"
                    aria-selected={selected}
                    onClick={() => onSelectIndex(index)}
                    onDoubleClick={() => onActivate(item)}
                    onContextMenu={(e) => openMenu(index, e)}
                    className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold cursor-pointer select-none ${
                      selected
                        ? selectedClass(railFocused)
                        : `bg-gray-800 text-gray-300 hover:text-white ${collapsed ? '' : 'border-b border-gray-700'}`
                    }`}
                    title={grouping === 'directory' ? item.group.title : undefined}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onActivate(item);
                      }}
                      className="text-gray-400 hover:text-white rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
                      aria-label={collapsed ? 'Expand group' : 'Collapse group'}
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
                    {app && nav && (
                      <span className="ml-auto shrink-0">
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
              const ctx = contexts[session.id];
              const sessionServers = servers.get(session.id) || [];
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
                  onClick={() => onSelectIndex(index)}
                  onDoubleClick={() => onActivate(item)}
                  onContextMenu={(e) => openMenu(index, e)}
                  className={`group flex items-start gap-2 px-3 py-2 text-sm cursor-pointer border-t border-gray-700/60 first:border-t-0 ${
                    selected
                      ? selectedClass(railFocused)
                      : `text-gray-300 hover:bg-gray-800 ${isPeeking ? 'ring-1 ring-inset ring-blue-300/50' : ''}`
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
                          className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0"
                          title="Open in a tab"
                        />
                      )}
                      {session.loop && <span className="text-[10px] text-blue-300">loop</span>}
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
                            className="flex items-center gap-1 min-w-0"
                            title={[
                              ctx.repo.slug || ctx.repo.name,
                              ctx.repo.branch ? `branch ${ctx.repo.branch}` : 'detached HEAD',
                              ctx.repo.dirty ? 'uncommitted changes' : null,
                              ctx.repo.ahead ? `${ctx.repo.ahead} ahead of upstream` : null,
                              ctx.repo.behind ? `${ctx.repo.behind} behind upstream` : null,
                            ]
                              .filter(Boolean)
                              .join('\n')}
                          >
                            <GitBranch size={10} className="shrink-0 text-gray-500" />
                            <span className="truncate text-gray-300 min-w-[3.5rem] shrink-0 max-w-[60%]">
                              {ctx.repo.name}
                            </span>
                            {ctx.repo.branch && (
                              <span className="truncate text-gray-500 min-w-0 shrink-[2]">
                                {ctx.repo.branch}
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
                    {extra && <div className="text-xs text-gray-500 truncate mt-0.5">{extra}</div>}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePeek(session);
                    }}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
                    title="Peek (Space)"
                    aria-label="Peek"
                  >
                    <MoreHorizontal size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {bottom}

      {menu && menuActions.length > 0 && (
        <div
          className="fixed z-50 min-w-[200px] bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 text-sm"
          style={{
            left: Math.min(menu.x, window.innerWidth - 220),
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
              className={`w-full text-left px-3 py-1.5 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed ${
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
