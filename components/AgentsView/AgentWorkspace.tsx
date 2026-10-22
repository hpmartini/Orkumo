import React, { useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { X, Columns2, Rows2, LayoutGrid, SquareStack, Bot, GripVertical } from 'lucide-react';
import type { AgentSession, AgentLayout } from '../../types';
import { stateGlyph } from '../../utils/agentSessions';
import {
  AGENT_TAB_MIME,
  dropZone,
  insertPosition,
  layoutForZone,
  positionForZone,
  reorderIndices,
  stepIndices,
  type DropZone,
  type InsertPosition,
} from '../../utils/agentWorkspace';
import { AgentTerminal } from './AgentTerminal';

interface AgentWorkspaceProps {
  sessions: AgentSession[];
  openIds: string[];
  activeId: string | null;
  layout: AgentLayout;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onLayoutChange: (layout: AgentLayout) => void;
  onPeek: (id: string) => void;
}

const LAYOUTS: { id: AgentLayout; icon: React.ReactNode; label: string }[] = [
  { id: 'tabs', icon: <SquareStack size={14} />, label: 'Tabs (one at a time)' },
  { id: 'columns', icon: <Columns2 size={14} />, label: 'Tiled: columns' },
  { id: 'rows', icon: <Rows2 size={14} />, label: 'Tiled: rows' },
  { id: 'grid', icon: <LayoutGrid size={14} />, label: 'Tiled: grid' },
];

const ZONE_HIGHLIGHT: Record<DropZone, string> = {
  left: 'inset-y-0 left-0 w-1/2',
  right: 'inset-y-0 right-0 w-1/2',
  top: 'inset-x-0 top-0 h-1/2',
  bottom: 'inset-x-0 bottom-0 h-1/2',
};

const isAgentDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(AGENT_TAB_MIME);

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-inset';

/** Covers a pane while a tab / pane is dragged; the pointer's nearest edge picks the split side */
const SplitOverlay: React.FC<{ onDropZone: (draggedId: string, zone: DropZone) => void }> = ({
  onDropZone,
}) => {
  const [zone, setZone] = useState<DropZone | null>(null);
  const zoneAt = (e: React.DragEvent) =>
    dropZone(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY);

  return (
    <div
      className="absolute inset-0 z-20"
      onDragOver={(e) => {
        if (!isAgentDrag(e)) return;
        e.preventDefault();
        setZone(zoneAt(e));
      }}
      onDragLeave={() => setZone(null)}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(AGENT_TAB_MIME);
        if (!id) return;
        e.preventDefault();
        setZone(null);
        onDropZone(id, zoneAt(e));
      }}
    >
      {zone && (
        <div
          className={`absolute ${ZONE_HIGHLIGHT[zone]} bg-blue-500/25 border border-blue-400/60 pointer-events-none`}
        />
      )}
    </div>
  );
};

/**
 * Attached agent sessions: a tab strip plus either a single visible pane (tabs)
 * or all panes tiled (columns / rows / grid). Tabs and pane headers can be
 * dragged to reorder, or onto a pane edge to split.
 */
export const AgentWorkspace: React.FC<AgentWorkspaceProps> = ({
  sessions,
  openIds,
  activeId,
  layout,
  onSelect,
  onClose,
  onReorder,
  onLayoutChange,
  onPeek,
}) => {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: InsertPosition } | null>(
    null
  );
  const stripRef = useRef<HTMLDivElement>(null);
  const refocusId = useRef<string | null>(null);
  const open = openIds
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is AgentSession => !!s);
  const order = open.map((s) => s.id);

  const findTab = (id: string) =>
    stripRef.current?.querySelector<HTMLElement>(`[data-tab-id="${window.CSS.escape(id)}"]`);

  // Keep the active tab visible in an overflowing strip
  useEffect(() => {
    if (activeId) findTab(activeId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId, order.length]);

  // A keyboard move re-parents the DOM node, which drops focus
  useEffect(() => {
    if (refocusId.current) findTab(refocusId.current)?.focus();
    refocusId.current = null;
  }, [order.join('|')]);

  const move = (m: { from: number; to: number } | null) => m && onReorder(m.from, m.to);

  const dragProps = (id: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(AGENT_TAB_MIME, id);
      e.dataTransfer.effectAllowed = 'move';
      setDragId(id);
    },
    onDragEnd: () => {
      setDragId(null);
      setDropTarget(null);
    },
  });

  /** Put `id` beside `anchorId` on the zone's side and switch to the matching split layout */
  const splitBeside = (id: string, anchorId: string, zone: DropZone) => {
    if (id === anchorId || !order.includes(id) || !order.includes(anchorId)) return;
    move(reorderIndices(order, id, anchorId, positionForZone(zone)));
    onLayoutChange(layoutForZone(zone));
    onSelect(id);
  };

  /** Button variant: split `id` off next to the active pane (or its neighbour when it is the active one) */
  const splitOut = (id: string, zone: 'right' | 'bottom') => {
    const index = order.indexOf(id);
    const anchor = activeId && activeId !== id ? activeId : (order[index + 1] ?? order[index - 1]);
    if (anchor) splitBeside(id, anchor, zone);
  };

  const dropOnTab = (e: React.DragEvent, targetId: string, position: InsertPosition) => {
    const id = e.dataTransfer.getData(AGENT_TAB_MIME);
    if (!id) return;
    e.preventDefault();
    move(reorderIndices(order, id, targetId, position));
    setDropTarget(null);
  };

  if (open.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-3 p-8 text-center">
        <Bot size={40} className="text-gray-700" />
        <div className="text-sm">
          No agent attached. Select a session and press <kbd className="kbd">Enter</kbd> or{' '}
          <kbd className="kbd">→</kbd> to open it in a tab.
        </div>
        <div className="text-xs text-gray-600">
          Open several sessions and switch the layout to tile them side by side.
        </div>
      </div>
    );
  }

  const splitButtons = (session: AgentSession) =>
    open.length > 1 && (
      <>
        <button
          onClick={(e) => {
            e.stopPropagation();
            splitOut(session.id, 'right');
          }}
          className={`p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 ${focusRing}`}
          title="Split right"
          aria-label={`Split ${session.name} right`}
        >
          <Columns2 size={12} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            splitOut(session.id, 'bottom');
          }}
          className={`p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 ${focusRing}`}
          title="Split down"
          aria-label={`Split ${session.name} down`}
        >
          <Rows2 size={12} />
        </button>
      </>
    );

  const renderPane = (session: AgentSession, visible: boolean) => {
    const glyph = stateGlyph(session.displayState);
    return (
      <div className="relative h-full flex flex-col min-h-0">
        {layout !== 'tabs' && (
          <div
            {...dragProps(session.id)}
            className={`group flex items-center gap-1.5 px-1.5 h-6 shrink-0 bg-gray-900 border-b border-gray-800 text-xs text-gray-400 cursor-grab active:cursor-grabbing ${
              dragId === session.id ? 'opacity-50' : ''
            }`}
            title="Drag to reorder, or onto another pane to split"
          >
            <GripVertical size={12} className="text-gray-600 shrink-0" />
            <span className={`${glyph.className} ${glyph.animate ? 'animate-pulse' : ''}`}>
              {glyph.glyph}
            </span>
            <span className="truncate flex-1">{session.name}</span>
            <span className="flex items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
              {splitButtons(session)}
            </span>
          </div>
        )}
        <div className="relative flex-1 min-h-0">
          <AgentTerminal
            key={session.id}
            session={session}
            visible={visible}
            active={session.id === activeId}
            onFocus={() => onSelect(session.id)}
            onClose={() => onClose(session.id)}
            onPeek={() => onPeek(session.id)}
            onMaximize={
              layout !== 'tabs'
                ? () => {
                    onSelect(session.id);
                    onLayoutChange('tabs');
                  }
                : undefined
            }
          />
          {dragId && dragId !== session.id && visible && (
            <SplitOverlay onDropZone={(id, zone) => splitBeside(id, session.id, zone)} />
          )}
        </div>
      </div>
    );
  };

  let content: React.ReactNode;
  if (layout === 'tabs') {
    content = (
      <div className="relative flex-1 min-h-0">
        {open.map((session) => (
          <div
            key={session.id}
            className={`absolute inset-0 ${session.id === activeId ? 'block' : 'hidden'}`}
          >
            {renderPane(session, session.id === activeId)}
          </div>
        ))}
      </div>
    );
  } else if (layout === 'grid') {
    const columns = open.length <= 1 ? 1 : 2;
    content = (
      <div
        className="flex-1 min-h-0 grid gap-1 p-1"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridAutoRows: 'minmax(0, 1fr)',
        }}
      >
        {open.map((session) => (
          <div key={session.id} className="min-h-0 min-w-0">
            {renderPane(session, true)}
          </div>
        ))}
      </div>
    );
  } else {
    content = (
      <div className="flex-1 min-h-0 p-1">
        <Group
          orientation={layout === 'columns' ? 'horizontal' : 'vertical'}
          className="h-full w-full"
        >
          {open.map((session, index) => (
            <React.Fragment key={session.id}>
              {index > 0 && (
                <Separator
                  className={`${layout === 'columns' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'} bg-gray-800 hover:bg-blue-500/50 transition-colors`}
                />
              )}
              <Panel id={`agent-pane-${session.id}`} minSize={10} className="min-h-0 min-w-0">
                {renderPane(session, true)}
              </Panel>
            </React.Fragment>
          ))}
        </Group>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Tab strip */}
      <div className="flex items-center bg-gray-900 border-b border-gray-800 shrink-0 h-9">
        <div
          ref={stripRef}
          role="tablist"
          aria-label="Attached agents"
          className="flex-1 flex items-center overflow-x-auto scrollbar-hide h-full"
        >
          {open.map((session) => {
            const glyph = stateGlyph(session.displayState);
            const isActive = session.id === activeId;
            const needsInput = session.displayState === 'needs-input';
            const indicator = dropTarget?.id === session.id ? dropTarget.position : null;
            return (
              <div
                key={session.id}
                data-tab-id={session.id}
                role="tab"
                aria-selected={isActive}
                aria-label={`${session.name}, ${glyph.label}`}
                tabIndex={0}
                {...dragProps(session.id)}
                onDragOver={(e) => {
                  if (!isAgentDrag(e)) return;
                  e.preventDefault();
                  setDropTarget({
                    id: session.id,
                    position: insertPosition(e.currentTarget.getBoundingClientRect(), e.clientX),
                  });
                }}
                onDragLeave={() => setDropTarget((t) => (t?.id === session.id ? null : t))}
                onDrop={(e) => dropOnTab(e, session.id, indicator ?? 'before')}
                onClick={() => onSelect(session.id)}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    onClose(session.id);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.altKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                    e.preventDefault();
                    refocusId.current = session.id;
                    move(stepIndices(order, session.id, e.key === 'ArrowLeft' ? -1 : 1));
                  } else if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(session.id);
                  }
                }}
                className={`group relative flex items-center gap-2 px-3 h-full min-w-[170px] max-w-[260px] cursor-pointer border-r border-gray-800 shrink-0 text-xs transition-colors ${focusRing} ${
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:bg-gray-850 hover:text-gray-200'
                } ${dragId === session.id ? 'opacity-40' : ''}`}
                title={`${session.name} · ${session.cwd}`}
              >
                {isActive && <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500" />}
                {indicator && (
                  <div
                    className={`absolute inset-y-1 w-0.5 rounded bg-blue-400 pointer-events-none ${
                      indicator === 'before' ? 'left-0' : 'right-0'
                    }`}
                  />
                )}
                <span
                  className={`${glyph.className} ${glyph.animate ? 'animate-pulse' : ''}`}
                  aria-hidden="true"
                >
                  {glyph.glyph}
                </span>
                <span className="truncate flex-1">{session.name}</span>
                {needsInput && (
                  <span
                    className="w-2 h-2 rounded-full bg-yellow-400 shrink-0"
                    role="img"
                    aria-label="Needs input"
                  />
                )}
                <span className="text-[10px] text-gray-400 shrink-0">{glyph.label}</span>
                <span
                  className={`flex items-center ${
                    isActive ? '' : 'opacity-0'
                  } group-hover:opacity-100 group-focus-within:opacity-100`}
                >
                  {splitButtons(session)}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose(session.id);
                    }}
                    className={`p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white ${focusRing}`}
                    aria-label={`Close ${session.name}`}
                    title="Close"
                  >
                    <X size={12} />
                  </button>
                </span>
              </div>
            );
          })}
          {/* Drop here to move a tab to the end */}
          <div
            className="flex-1 min-w-8 h-full relative"
            onDragOver={(e) => {
              if (!isAgentDrag(e)) return;
              e.preventDefault();
              setDropTarget({ id: order[order.length - 1], position: 'after' });
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(e) => dropOnTab(e, order[order.length - 1], 'after')}
          />
        </div>
        {/* Layout switcher */}
        <div className="flex items-center gap-0.5 px-2 border-l border-gray-800 h-full">
          {LAYOUTS.map((item) => (
            <button
              key={item.id}
              onClick={() => onLayoutChange(item.id)}
              className={`p-1.5 rounded transition-colors ${focusRing} ${
                layout === item.id
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}
              title={item.label}
              aria-label={item.label}
              aria-pressed={layout === item.id}
            >
              {item.icon}
            </button>
          ))}
        </div>
      </div>
      {content}
    </div>
  );
};
