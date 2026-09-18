import React, { useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { X, Columns2, Rows2, LayoutGrid, SquareStack, Bot } from 'lucide-react';
import type { AgentSession, AgentLayout } from '../../types';
import { stateGlyph } from '../../utils/agentSessions';
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

/**
 * Attached agent sessions: a tab strip plus either a single visible pane (tabs)
 * or all panes tiled (columns / rows / grid).
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
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const open = openIds
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is AgentSession => !!s);

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

  const renderPane = (session: AgentSession, visible: boolean) => (
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
  );

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
        <div className="flex-1 flex items-center overflow-x-auto scrollbar-hide h-full">
          {open.map((session, index) => {
            const glyph = stateGlyph(session.displayState);
            const isActive = session.id === activeId;
            return (
              <div
                key={session.id}
                role="tab"
                aria-selected={isActive}
                tabIndex={0}
                draggable
                onDragStart={() => setDraggedIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (draggedIndex !== null && draggedIndex !== index)
                    onReorder(draggedIndex, index);
                  setDraggedIndex(null);
                }}
                onDragEnd={() => setDraggedIndex(null)}
                onClick={() => onSelect(session.id)}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    onClose(session.id);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelect(session.id);
                }}
                className={`group relative flex items-center gap-2 px-3 h-full min-w-[140px] max-w-[220px] cursor-pointer border-r border-gray-800 shrink-0 text-xs transition-colors ${
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:bg-gray-850 hover:text-gray-200'
                } ${draggedIndex === index ? 'opacity-50' : ''}`}
                title={`${session.name} · ${session.cwd}`}
              >
                {isActive && <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500" />}
                <span className={`${glyph.className} ${glyph.animate ? 'animate-pulse' : ''}`}>
                  {glyph.glyph}
                </span>
                <span className="truncate flex-1">{session.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(session.id);
                  }}
                  className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-700 text-gray-500 hover:text-white"
                  aria-label={`Close ${session.name}`}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
        {/* Layout switcher */}
        <div className="flex items-center gap-0.5 px-2 border-l border-gray-800 h-full">
          {LAYOUTS.map((item) => (
            <button
              key={item.id}
              onClick={() => onLayoutChange(item.id)}
              className={`p-1.5 rounded transition-colors ${
                layout === item.id
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
              }`}
              title={item.label}
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
