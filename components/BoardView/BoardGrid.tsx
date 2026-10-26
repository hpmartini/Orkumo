import React, { useState } from 'react';
import { ChevronDown, ChevronRight, GitMerge, Plus } from 'lucide-react';
import type { AgentSession, BoardItem, BoardStatusOption, BoardSwimlaneMode } from '../../types';
import {
  DONE_WINDOW_DAYS,
  columnKeyOf,
  columnTint,
  NO_PARENT_LANE,
  NO_REPO_LANE,
  isDoneOption,
  itemKey,
  shortRepo,
  withinDoneWindow,
  type Lane,
} from '../../utils/board';
import { BoardCard, DRAG_TYPE } from './BoardCard';

/** Cards per cell before "+ n weitere" (Backlog alone has ~300 items) */
const MAX_CARDS = 8;
/** Column keys whose fold state differs from the default (Done folded, rest open) */
const FOLD_KEY = 'devOrbitBoardColumns';

function loadFlipped(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(FOLD_KEY) || '[]');
    if (Array.isArray(v)) return new Set(v.filter((k) => typeof k === 'string'));
  } catch {
    // unavailable or corrupt storage: use the default
  }
  return new Set();
}

export interface BoardColumn {
  key: string;
  option: BoardStatusOption | null;
}

interface BoardGridProps {
  columns: BoardColumn[];
  options: BoardStatusOption[];
  lanes: Lane[];
  laneMode: BoardSwimlaneMode;
  now: number;
  selectedKey: string | null;
  hideRepo: (item: BoardItem) => boolean;
  agentsByIssue: Map<string, string[]>;
  sessionsById: Map<string, AgentSession>;
  onOpen: (item: BoardItem) => void;
  onAgent: (jobId: string) => void;
  onMove: (itemId: string, optionId: string) => void;
  /** "+ Issue" in a column header: creates an issue with that status */
  onCreate?: (optionId: string) => void;
  onReset: () => void;
}

const HEAD =
  'rounded-md text-xs font-semibold text-gray-100 transition-[filter] hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor';

export const BoardGrid: React.FC<BoardGridProps> = (props) => {
  const { columns, options, lanes, laneMode, now } = props;
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(new Set());
  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set());
  const [flipped, setFlipped] = useState<Set<string>>(loadFlipped);
  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (!next.delete(key)) next.add(key);
    return next;
  };

  const folded = (col: BoardColumn) =>
    (!!col.option && isDoneOption(col.option)) !== flipped.has(col.key);
  const toggleColumn = (key: string) => {
    const next = toggle(flipped, key);
    setFlipped(next);
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify([...next]));
    } catch {
      // stays in memory only
    }
  };
  const visibleIn = (col: BoardColumn, item: BoardItem) =>
    columnKeyOf(item, options) === col.key &&
    (!col.option || !isDoneOption(col.option) || withinDoneWindow(item, now));
  const grid = {
    gridTemplateColumns: columns.map((c) => (folded(c) ? '44px' : 'minmax(208px, 1fr)')).join(' '),
  };
  const minWidth = columns.reduce((w, c) => w + (folded(c) ? 52 : 216), 50);
  const allItems = lanes.flatMap((l) => l.items);
  const banded = laneMode !== 'none';

  const onDragOver = (e: React.DragEvent, col: BoardColumn) => {
    if (!col.option || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.currentTarget.classList.add('ring-1', 'ring-cursor');
  };
  const onDrop = (e: React.DragEvent, col: BoardColumn) => {
    e.currentTarget.classList.remove('ring-1', 'ring-cursor');
    const itemId = e.dataTransfer.getData(DRAG_TYPE);
    if (!col.option || !itemId) return;
    e.preventDefault();
    props.onMove(itemId, col.option.id);
  };
  const dropProps = (col: BoardColumn) => ({
    onDragOver: (e: React.DragEvent) => onDragOver(e, col),
    onDragLeave: (e: React.DragEvent) => e.currentTarget.classList.remove('ring-1', 'ring-cursor'),
    onDrop: (e: React.DragEvent) => onDrop(e, col),
  });

  const renderCells = (lane: Lane) => (
    <div className="grid gap-2 px-3 py-2.5" style={grid}>
      {columns.map((col) => {
        if (folded(col))
          return (
            <div
              key={col.key}
              {...dropProps(col)}
              className="min-h-[3.25rem] rounded border border-dashed border-gray-700/60"
              title={`Auf ${col.option?.name} ziehen`}
            />
          );
        const cellKey = `${lane.key}|${col.key}`;
        const cell = lane.items.filter((i) => visibleIn(col, i));
        const expanded = expandedCells.has(cellKey);
        const shown = expanded ? cell : cell.slice(0, MAX_CARDS);
        const tint = columnTint(col.option?.color ?? 'GRAY');
        return (
          <div
            key={col.key}
            {...dropProps(col)}
            className="min-h-[3.25rem] rounded-md p-1.5 space-y-2"
            style={{ background: tint.cell, boxShadow: `inset 0 0 0 1px ${tint.head}` }}
          >
            {shown.map((item) => {
              const key = itemKey(item);
              return (
                <BoardCard
                  key={item.itemId}
                  item={item}
                  hideRepo={props.hideRepo(item)}
                  selected={props.selectedKey === key}
                  agentIds={props.agentsByIssue.get(key) ?? []}
                  sessionsById={props.sessionsById}
                  onOpen={() => props.onOpen(item)}
                  onAgent={props.onAgent}
                />
              );
            })}
            {cell.length > MAX_CARDS && (
              <button
                onClick={() => setExpandedCells((s) => toggle(s, cellKey))}
                className="w-full text-[11px] text-gray-400 hover:text-white py-1"
              >
                {expanded ? 'Weniger anzeigen' : `+ ${cell.length - MAX_CARDS} weitere`}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ minWidth }}>
      <div
        className={`sticky top-0 z-10 grid gap-2 ${banded ? 'px-[25px]' : 'px-3'} pt-3 pb-2 bg-gray-900/95 backdrop-blur-sm border-b border-gray-700`}
        style={grid}
      >
        {columns.map((col) => {
          const count = allItems.filter((i) => visibleIn(col, i)).length;
          const done = !!col.option && isDoneOption(col.option);
          const name = col.option?.name ?? 'Ohne Status';
          if (folded(col))
            return (
              <button
                key={col.key}
                onClick={() => toggleColumn(col.key)}
                aria-expanded={false}
                aria-label={`${name} (${count})`}
                className={`flex flex-col items-center gap-1.5 py-1.5 ${HEAD}`}
                style={{ background: columnTint(col.option?.color ?? 'GRAY').head }}
                title={`${name}${done ? ` (letzte ${DONE_WINDOW_DAYS} Tage)` : ''} ausklappen`}
              >
                <span className="font-normal text-gray-300 tabular-nums">{count}</span>
                <span className="[writing-mode:vertical-rl] whitespace-nowrap">{name}</span>
              </button>
            );
          const fold = (
            <button
              onClick={() => toggleColumn(col.key)}
              aria-expanded
              aria-label={`${name} (${count})`}
              className={`self-start flex flex-1 min-w-0 items-center gap-2 px-2 py-1.5 text-left ${HEAD}`}
              style={{ background: columnTint(col.option?.color ?? 'GRAY').head }}
              title={`${name} einklappen`}
            >
              <span className="truncate">{name}</span>
              <span className="font-normal text-gray-300 tabular-nums">{count}</span>
              {done && (
                <span className="font-normal text-[11px] text-gray-300">
                  · {DONE_WINDOW_DAYS} Tage
                </span>
              )}
            </button>
          );
          if (!col.option || done || !props.onCreate)
            return <React.Fragment key={col.key}>{fold}</React.Fragment>;
          const optionId = col.option.id;
          // Sibling of the fold button, not inside it: a click must not also fold the column
          return (
            <div key={col.key} className="self-start flex items-stretch gap-1 min-w-0">
              {fold}
              <button
                onClick={() => props.onCreate?.(optionId)}
                className={`px-1.5 text-gray-200 ${HEAD}`}
                style={{ background: columnTint(col.option.color).head }}
                title={`Neues Issue in ${name}`}
                aria-label={`Neues Issue in ${name}`}
              >
                <Plus size={14} />
              </button>
            </div>
          );
        })}
      </div>

      {lanes.length === 0 && (
        <div className="px-4 py-16 text-center text-gray-400">
          Keine Items in dieser Auswahl.{' '}
          <button
            onClick={props.onReset}
            className="text-cursor hover:underline underline-offset-2"
          >
            Filter zurücksetzen
          </button>
        </div>
      )}

      {lanes.map((lane) => {
        if (!banded) return <React.Fragment key={lane.key}>{renderCells(lane)}</React.Fragment>;
        const collapsed = collapsedLanes.has(lane.key);
        return (
          <section
            key={lane.key}
            className={`mx-3 mt-3 rounded-lg border border-gray-700 ${lane.key === NO_PARENT_LANE || lane.key === NO_REPO_LANE ? 'bg-gray-900' : 'bg-gray-950/45'} shadow-[0_2px_6px_-2px_rgba(0,0,0,.35)]`}
          >
            <button
              onClick={() => setCollapsedLanes((s) => toggle(s, lane.key))}
              aria-expanded={!collapsed}
              className={`flex items-center gap-2 w-full px-3 py-2 text-[13px] font-semibold text-gray-100 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cursor ${collapsed ? '' : 'border-b border-gray-700/70'}`}
            >
              {collapsed ? (
                <ChevronRight size={14} className="text-gray-400" />
              ) : (
                <ChevronDown size={14} className="text-gray-400" />
              )}
              {lane.parent ? (
                <>
                  <GitMerge size={14} className="text-cursor shrink-0" />
                  <span className="font-mono text-xs text-gray-400 shrink-0">
                    {shortRepo(lane.parent.repo)}#{lane.parent.number}
                  </span>
                  <span className="truncate">{lane.parent.title}</span>
                </>
              ) : (
                <span className="text-gray-300 truncate">{lane.title}</span>
              )}
              <span className="ml-1 px-1.5 rounded-full bg-gray-800 text-[11px] font-normal text-gray-300 tabular-nums">
                {lane.items.length}
              </span>
              {lane.parent && lane.total > 0 && (
                <span className="flex items-center gap-1.5 text-[11px] font-normal text-gray-400 tabular-nums shrink-0">
                  <span className="w-16 h-1 rounded-full bg-gray-800 overflow-hidden">
                    <span
                      className="block h-full bg-emerald-400"
                      style={{ width: `${Math.round((lane.done / lane.total) * 100)}%` }}
                    />
                  </span>
                  {lane.done}/{lane.total} erledigt
                </span>
              )}
            </button>
            {!collapsed && renderCells(lane)}
          </section>
        );
      })}
      <div className="h-6" />
    </div>
  );
};
