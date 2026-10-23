import React, { useState } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  GripVertical,
  Kanban,
  Layers,
  LayoutDashboard,
  Star,
} from 'lucide-react';
import type { AgentSession, BoardSliceKind } from '../../types';
import type { SliceEntry } from '../../utils/board';
import { AgentGlyph } from './BoardCard';

const SLICE_KINDS: { key: BoardSliceKind; label: string; title: string }[] = [
  { key: 'repo', label: 'Repo', title: 'Projekte' },
  { key: 'label', label: 'Label', title: 'Labels' },
  { key: 'milestone', label: 'Milestone', title: 'Milestones' },
  { key: 'assignee', label: 'Assignee', title: 'Assignees' },
];
const SLICE_DRAG_TYPE = 'application/x-board-slice';
const MAX_SLICES = 8;
const ICON_BTN =
  'p-1 rounded text-gray-300 hover:text-white hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor';

export interface RailAgent {
  jobId: string;
  session?: AgentSession;
  issueKeys: string[];
}

/** "owner/name#12" -> "name#12" */
const shortKey = (key: string) => key.replace(/^[^/#]+\//, '');

interface BoardRailProps {
  onOpenDashboard: () => void;
  onOpenAgents: () => void;
  sliceKind: BoardSliceKind;
  onSliceKind: (kind: BoardSliceKind) => void;
  slices: { favorites: SliceEntry[]; others: SliceEntry[]; hidden: SliceEntry[] };
  allCount: number;
  selected: string | null;
  onSelect: (value: string | null) => void;
  onToggleFavorite: (entry: SliceEntry) => void;
  onHide: (entry: SliceEntry) => void;
  onUnhide: (entry: SliceEntry) => void;
  /** Drop `key` before `beforeKey` (a row of the favourites or the normal list) */
  onReorder: (key: string, before: SliceEntry) => void;
  agents: RailAgent[];
  agentFilter: string | null;
  onAgent: (jobId: string) => void;
  onOpenIssue: (issueKey: string) => void;
}

export const BoardRail: React.FC<BoardRailProps> = (props) => {
  const { sliceKind, slices, selected } = props;
  const [showAll, setShowAll] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const kind = SLICE_KINDS.find((k) => k.key === sliceKind)!;
  const others = showAll ? slices.others : slices.others.slice(0, MAX_SLICES);
  const activeAgents = props.agents.filter((a) =>
    ['working', 'needs-input'].includes(a.session?.displayState ?? '')
  ).length;

  const row = (entry: SliceEntry, section: 'fav' | 'rest' | 'hidden') => {
    const on = selected === entry.value;
    const draggable = section !== 'hidden';
    return (
      <li
        key={entry.key}
        draggable={draggable}
        onDragStart={(e) => {
          e.dataTransfer.setData(SLICE_DRAG_TYPE, entry.key);
          e.currentTarget.classList.add('opacity-40');
        }}
        onDragEnd={(e) => e.currentTarget.classList.remove('opacity-40')}
        onDragOver={(e) => {
          if (!draggable || !e.dataTransfer.types.includes(SLICE_DRAG_TYPE)) return;
          e.preventDefault();
          e.currentTarget.classList.add('shadow-[inset_0_2px_0_#8fd0ff]');
        }}
        onDragLeave={(e) => e.currentTarget.classList.remove('shadow-[inset_0_2px_0_#8fd0ff]')}
        onDrop={(e) => {
          e.currentTarget.classList.remove('shadow-[inset_0_2px_0_#8fd0ff]');
          const from = e.dataTransfer.getData(SLICE_DRAG_TYPE);
          if (!draggable || !from || from === entry.key) return;
          e.preventDefault();
          props.onReorder(from, entry);
        }}
        className={`group flex items-center gap-1 pl-1 pr-2 ${on ? 'bg-sel text-white' : 'text-gray-300 hover:bg-gray-800'} ${section === 'hidden' ? 'opacity-70' : ''}`}
      >
        {draggable ? (
          <span
            className="p-0.5 text-gray-500 opacity-0 group-hover:opacity-100 cursor-grab"
            title="Ziehen zum Umsortieren"
            aria-hidden="true"
          >
            <GripVertical size={12} />
          </span>
        ) : (
          <span className="w-4" />
        )}
        <button
          onClick={() => props.onSelect(on ? null : entry.value)}
          aria-pressed={on}
          className={`flex-1 min-w-0 flex items-center gap-2 py-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor ${on ? '' : 'hover:text-white'}`}
          title={entry.value}
        >
          <span className="flex-1 min-w-0 truncate">{entry.value}</span>
          <span
            className={`text-[11px] tabular-nums ${on ? 'text-gray-100' : 'text-gray-400'} group-hover:hidden group-focus-within:hidden`}
          >
            {entry.count}
          </span>
        </button>
        <span className="hidden group-hover:flex group-focus-within:flex items-center">
          {section === 'hidden' ? (
            <button
              onClick={() => props.onUnhide(entry)}
              className={ICON_BTN}
              title="Wieder einblenden"
              aria-label={`${entry.value} einblenden`}
            >
              <Eye size={12} />
            </button>
          ) : (
            <>
              <button
                onClick={() => props.onToggleFavorite(entry)}
                className={`${ICON_BTN} ${entry.favorite ? 'text-yellow-300' : ''}`}
                title={entry.favorite ? 'Favorit entfernen' : 'Als Favorit anpinnen'}
                aria-label={`${entry.value} ${entry.favorite ? 'lösen' : 'anpinnen'}`}
                aria-pressed={entry.favorite}
              >
                <Star size={12} />
              </button>
              <button
                onClick={() => props.onHide(entry)}
                className={ICON_BTN}
                title="Ausblenden"
                aria-label={`${entry.value} ausblenden`}
              >
                <EyeOff size={12} />
              </button>
            </>
          )}
        </span>
        {section === 'fav' && (
          <Star
            size={12}
            className="text-yellow-300 fill-yellow-300 shrink-0 group-hover:hidden group-focus-within:hidden"
          />
        )}
      </li>
    );
  };

  const head = (title: string) => (
    <li className="px-3 pt-2 pb-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">
      {title}
    </li>
  );

  return (
    <aside
      className="w-80 shrink-0 flex flex-col border-r border-gray-700 bg-gray-900"
      aria-label="Board-Navigation"
    >
      <div className="px-3 py-2 border-b border-gray-700 space-y-2 shrink-0">
        <nav className="flex items-center gap-1 text-xs" aria-label="Modus">
          <button
            onClick={props.onOpenDashboard}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-gray-400 hover:text-white hover:bg-gray-800"
          >
            <LayoutDashboard size={13} /> Dashboard
          </button>
          <span
            className="flex items-center gap-1.5 px-2 py-1 rounded bg-gray-800 text-white"
            aria-current="page"
          >
            <Kanban size={13} /> Board
          </span>
          <button
            onClick={props.onOpenAgents}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-gray-400 hover:text-white hover:bg-gray-800"
          >
            <Bot size={13} /> Agents
          </button>
        </nav>
        <div
          className="flex rounded border border-gray-700 bg-gray-900 p-0.5 text-xs"
          role="group"
          aria-label="Slice nach"
        >
          {SLICE_KINDS.map((k) => (
            <button
              key={k.key}
              onClick={() => props.onSliceKind(k.key)}
              aria-pressed={sliceKind === k.key}
              className={`flex-1 px-2 py-0.5 rounded ${sliceKind === k.key ? 'bg-sel text-white' : 'text-gray-300 hover:text-white'}`}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scrollbar pb-3">
        <section className="mx-2 mt-2 rounded-lg border border-gray-700 bg-gray-850 overflow-hidden">
          <h2 className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-300 bg-gray-800 border-b border-gray-700">
            <Layers size={12} />
            {kind.title}
            <span className="font-normal text-gray-400">
              {slices.favorites.length + slices.others.length}
            </span>
          </h2>
          <ul className="py-1">
            <li>
              <button
                onClick={() => props.onSelect(null)}
                aria-pressed={selected === null}
                className={`w-full flex items-center gap-2 pl-5 pr-2 py-1 text-left ${selected === null ? 'bg-sel text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
              >
                <span className="flex-1">Alle</span>
                <span className="text-[11px] tabular-nums text-gray-400">{props.allCount}</span>
              </button>
            </li>
            {slices.favorites.length > 0 && head('Favoriten')}
            {slices.favorites.map((e) => row(e, 'fav'))}
            {slices.favorites.length > 0 && slices.others.length > 0 && head(kind.title)}
            {others.map((e) => row(e, 'rest'))}
            {slices.others.length > MAX_SLICES && (
              <li>
                <button
                  onClick={() => setShowAll(!showAll)}
                  className="w-full pl-5 pr-2 py-1 text-left text-xs text-gray-400 hover:text-white"
                >
                  {showAll ? 'Weniger anzeigen' : `+ ${slices.others.length - MAX_SLICES} weitere`}
                </button>
              </li>
            )}
            {slices.favorites.length + slices.others.length === 0 && (
              <li className="px-5 py-1 text-xs text-gray-400">Keine Werte im Project gepflegt.</li>
            )}
            {slices.hidden.length > 0 && (
              <li>
                <button
                  onClick={() => setShowHidden(!showHidden)}
                  aria-expanded={showHidden}
                  className="w-full flex items-center gap-1.5 px-3 pt-2 pb-1 text-left text-[10.5px] font-semibold uppercase tracking-wide text-gray-400 hover:text-white"
                >
                  {showHidden ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  Ausgeblendet
                  <span className="font-normal tabular-nums">{slices.hidden.length}</span>
                </button>
              </li>
            )}
            {showHidden && slices.hidden.map((e) => row(e, 'hidden'))}
          </ul>
        </section>

        <section className="mx-2 mt-2 rounded-lg border border-gray-700 bg-gray-850 overflow-hidden">
          <h2 className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-300 bg-gray-800 border-b border-gray-700">
            <Bot size={12} />
            Agents
            <span className="font-normal text-gray-400">{activeAgents} aktiv</span>
          </h2>
          <ul className="py-1">
            {props.agents.map((a) => {
              const on = props.agentFilter === a.jobId;
              const toggle = () => props.onAgent(a.jobId);
              return (
                <li key={a.jobId}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={on}
                    onClick={toggle}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
                      e.preventDefault();
                      toggle();
                    }}
                    className={`px-3 py-1.5 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cursor ${on ? 'bg-sel' : 'hover:bg-gray-800'}`}
                  >
                    <div className="flex items-center gap-2">
                      <AgentGlyph session={a.session} />
                      <span className={`flex-1 min-w-0 truncate ${on ? 'text-white' : 'text-gray-200'}`}>
                        {a.session?.name ?? a.jobId}
                      </span>
                      <span className="font-mono text-[10.5px] text-gray-400">{a.jobId}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 mt-1 pl-5">
                      {a.issueKeys.slice(0, 3).map((key) => (
                        <button
                          key={key}
                          onClick={(e) => {
                            e.stopPropagation();
                            props.onOpenIssue(key);
                          }}
                          className="font-mono text-[10.5px] px-1 rounded bg-gray-950/60 border border-gray-700 text-gray-200 hover:border-cursor hover:text-white"
                          title={`${key} öffnen`}
                        >
                          {shortKey(key)}
                        </button>
                      ))}
                      {a.issueKeys.length > 3 && (
                        <span className="text-[10.5px] text-gray-400">+{a.issueKeys.length - 3}</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
            {props.agents.length === 0 && (
              <li className="px-3 py-2 text-xs text-gray-400">Kein Agent an diesen Issues.</li>
            )}
          </ul>
          <p className="px-3 py-2 text-[11px] leading-snug text-gray-400 border-t border-gray-700">
            Klick auf einen Agent filtert das Board auf seine Issues. Nochmal klicken hebt den Filter
            auf.
          </p>
        </section>
      </div>
    </aside>
  );
};
