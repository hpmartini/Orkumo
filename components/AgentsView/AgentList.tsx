import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Pin, MoreHorizontal, ExternalLink } from 'lucide-react';
import type { AgentSession } from '../../types';
import {
  NavItem,
  SessionGroup,
  stateGlyph,
  prLabel,
  sessionAgeMs,
  formatAge,
  shortenPath,
} from '../../utils/agentSessions';

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
  grouping: 'state' | 'directory';
  rowActions: (session: AgentSession) => AgentRowAction[];
  groupActions: (group: SessionGroup) => AgentRowAction[];
  /** Session that was just backgrounded/dispatched (rendered bold) */
  highlightedId?: string | null;
}

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
  rowActions,
  groupActions,
  highlightedId,
}) => {
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
    <div
      ref={listRef}
      className="flex-1 overflow-y-auto min-h-0 py-1"
      role="listbox"
      aria-label="Agent sessions"
    >
      {items.length === 0 && (
        <div className="px-4 py-8 text-sm text-gray-500 text-center">
          No sessions yet. Describe a task below and press <kbd className="kbd">Enter</kbd> to start
          one.
        </div>
      )}
      {items.map((item, index) => {
        const selected = index === selectedIndex;
        if (item.type === 'group') {
          const count = item.group.sessions.length + item.group.hidden.length;
          const collapsed = !item.group.sessions.length && count > 0;
          return (
            <div
              key={`group-${item.group.key}`}
              data-nav-index={index}
              role="option"
              aria-selected={selected}
              onClick={() => onSelectIndex(index)}
              onDoubleClick={() => onActivate(item)}
              onContextMenu={(e) => openMenu(index, e)}
              className={`flex items-center gap-2 px-3 py-1.5 mt-2 text-[11px] font-semibold uppercase tracking-wider cursor-pointer select-none ${
                selected ? 'bg-gray-800/70 text-gray-100' : 'text-gray-500 hover:text-gray-300'
              }`}
              title={grouping === 'directory' ? item.group.title : undefined}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onActivate(item);
                }}
                className="text-gray-500 hover:text-gray-300"
                aria-label={collapsed ? 'Expand group' : 'Collapse group'}
              >
                {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              </button>
              <span className="truncate">
                {grouping === 'directory' ? shortenPath(item.group.title, 42) : item.group.title}
              </span>
              <span className="text-gray-600 normal-case tracking-normal">{count}</span>
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
              className={`px-6 py-1 text-xs cursor-pointer ${selected ? 'bg-gray-800/70 text-gray-200' : 'text-gray-500 hover:text-gray-300'}`}
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
            className={`group flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer border-l-2 ${
              selected
                ? 'bg-gray-800 border-blue-500 text-white'
                : 'border-transparent text-gray-300 hover:bg-gray-900'
            } ${isPeeking ? 'ring-1 ring-inset ring-blue-500/40' : ''}`}
            title={`${session.id} · ${session.cwd}${session.waitingFor ? ` · waiting for ${session.waitingFor}` : ''}`}
          >
            <span
              className={`w-4 text-center shrink-0 ${glyph.className} ${glyph.animate ? 'animate-pulse' : ''}`}
              aria-label={glyph.label}
            >
              {glyph.glyph}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`truncate ${highlightedId === session.id ? 'font-bold' : 'font-medium'}`}
                >
                  {session.name}
                </span>
                {session.pinned && <Pin size={10} className="text-blue-400 shrink-0" />}
                {isOpen && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0"
                    title="Open in a tab"
                  />
                )}
                {session.loop && <span className="text-[10px] text-blue-400">loop</span>}
              </div>
              <div className="text-xs text-gray-500 truncate">
                {session.state === 'blocked' && session.waitingFor
                  ? `waiting: ${session.waitingFor}`
                  : session.detail ||
                    session.intent ||
                    (session.kind === 'interactive' ? 'interactive session' : '')}
              </div>
            </div>
            {label && (
              <a
                href={label.href || undefined}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${label.className} shrink-0 flex items-center gap-1`}
                title={session.links.map((l) => l.href).join('\n')}
              >
                {label.text}
                {label.href && <ExternalLink size={9} />}
              </a>
            )}
            <span className="text-xs text-gray-600 font-mono w-8 text-right shrink-0">{age}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTogglePeek(session);
              }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-500 hover:text-white hover:bg-gray-700"
              title="Peek (Space)"
              aria-label="Peek"
            >
              <MoreHorizontal size={12} />
            </button>
          </div>
        );
      })}

      {menu && menuActions.length > 0 && (
        <div
          className="fixed z-50 min-w-[200px] bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 text-sm"
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
                action.danger ? 'text-red-400' : 'text-gray-200'
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
