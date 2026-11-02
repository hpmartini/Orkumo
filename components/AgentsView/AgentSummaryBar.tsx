import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  CircleDot,
  GitPullRequest,
  ListFilter,
  X,
} from 'lucide-react';
import type { AgentDaemonStatus } from '../../types';
import {
  AgentQuickFilter,
  AgentSort,
  LinkFilterEntry,
  QUICK_FILTERS,
  SORT_OPTIONS,
} from '../../utils/agentSessions';
import { usePopover } from './PullRequestsPanel';

interface AgentSummaryBarProps {
  counts: {
    awaitingInput: number;
    working: number;
    completed: number;
    failed: number;
    cacheExpiring: number;
  };
  /** null while the context request is still loading */
  openPrs: number | null;
  runningServers: number | null;
  daemon: AgentDaemonStatus | null;
  /** Count of sessions that just finished (brief highlight) */
  justCompleted: number;
  active: ReadonlySet<AgentQuickFilter>;
  onToggle: (key: AgentQuickFilter) => void;
  onOpenPrs: () => void;
  onOpenServers: () => void;
  /** Which popover is open (for aria-expanded) */
  panel: 'prs' | 'servers' | null;
}

/**
 * Inline status strip for the header: state counts double as filter toggles.
 */
export const AgentSummaryBar: React.FC<AgentSummaryBarProps> = ({
  counts,
  openPrs,
  runningServers,
  daemon,
  justCompleted,
  active,
  onToggle,
  onOpenPrs,
  onOpenServers,
  panel,
}) => {
  const toggle = (key: AgentQuickFilter, count: number, label: string, tone: string) => (
    <button
      onClick={() => onToggle(key)}
      aria-pressed={active.has(key)}
      title={`${active.has(key) ? 'Remove filter' : 'Filter'}: ${label}`}
      className={`px-1.5 py-0.5 rounded tabular-nums hover:bg-gray-800 ${
        active.has(key) ? 'bg-gray-800 ring-1 ring-inset ring-gray-600' : ''
      } ${count > 0 ? tone : 'text-gray-500'}`}
    >
      {count} {label}
    </button>
  );

  return (
    <div className="flex items-center gap-0.5 text-xs text-gray-400 min-w-0 flex-wrap">
      <span
        className={`w-1.5 h-1.5 rounded-full mr-1.5 shrink-0 ${daemon?.running ? 'bg-emerald-500' : 'bg-gray-600'}`}
        title={`Supervisor ${daemon?.running ? 'running' : 'idle'}${daemon?.raw ? `\n${daemon.raw}` : ''}`}
        role="img"
        aria-label={`Supervisor ${daemon?.running ? 'running' : 'idle'}`}
      />
      {daemon?.versionMismatch && (
        <AlertTriangle
          size={11}
          className="text-yellow-400 mr-1"
          aria-label="Supervisor version mismatch"
        />
      )}
      {counts.awaitingInput > 0 ? (
        <button
          onClick={() => onToggle('needs-input')}
          aria-pressed={active.has('needs-input')}
          title="Filter: agents waiting for your input"
          className={`px-1.5 py-0.5 rounded font-semibold tabular-nums bg-yellow-500/15 text-yellow-300 hover:bg-yellow-500/25 ${
            active.has('needs-input') ? 'ring-1 ring-inset ring-yellow-500/60' : ''
          }`}
        >
          {counts.awaitingInput} awaiting input
        </button>
      ) : (
        toggle('needs-input', 0, 'awaiting input', '')
      )}
      {toggle('working', counts.working, 'working', 'text-orange-300')}
      {toggle('completed', counts.completed, 'completed', 'text-emerald-300')}
      {toggle('cache-expiring', counts.cacheExpiring, 'cache expiring', 'text-amber-300')}
      {(counts.failed > 0 || active.has('failed')) &&
        toggle('failed', counts.failed, 'failed', 'text-red-300')}
      <span className="text-gray-500 px-1" aria-hidden="true">
        |
      </span>
      <button
        onClick={onOpenPrs}
        disabled={openPrs === null}
        data-popover-trigger
        aria-haspopup="dialog"
        aria-expanded={panel === 'prs'}
        title="List open pull requests across all agents"
        className="px-1.5 py-0.5 rounded tabular-nums hover:bg-gray-800 disabled:opacity-50 disabled:hover:bg-transparent"
      >
        {openPrs ?? '-'} open {openPrs === 1 ? 'PR' : 'PRs'}
      </button>
      <button
        onClick={onOpenServers}
        disabled={runningServers === null}
        data-popover-trigger
        aria-haspopup="dialog"
        aria-expanded={panel === 'servers'}
        title="List servers listening in agent directories"
        className="px-1.5 py-0.5 rounded tabular-nums hover:bg-gray-800 disabled:opacity-50 disabled:hover:bg-transparent"
      >
        {runningServers ?? '-'} {runningServers === 1 ? 'server' : 'servers'} running
      </button>
      {justCompleted > 0 && <span className="text-emerald-400 px-1.5">+{justCompleted} done</span>}
    </div>
  );
};

interface AgentFilterBarProps {
  sort: AgentSort;
  onSort: (sort: AgentSort) => void;
  active: ReadonlySet<AgentQuickFilter>;
  onToggle: (key: AgentQuickFilter) => void;
  /** Sessions matching each chip (over all sessions, ignoring other filters) */
  chipCounts: Record<AgentQuickFilter, number>;
  shown: number;
  total: number;
  /** Any filter (chips or text filter) is narrowing the list */
  filtered: boolean;
  onClear: () => void;
  /** Open PRs and linked issues of the agents in the current context */
  linkEntries: LinkFilterEntry[];
  linkSelected: ReadonlySet<string>;
  onToggleLink: (key: string) => void;
}

/** Searchable list of PRs and issues; a highlighted entry narrows the agent list to it. */
const LinkFilterPanel: React.FC<{
  entries: LinkFilterEntry[];
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onClose: () => void;
}> = ({ entries, selected, onToggle, onClose }) => {
  const ref = usePopover(onClose);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q
    ? entries.filter((e) => `${e.label} ${e.title}`.toLowerCase().includes(q))
    : entries;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label="Filter by pull request or issue"
      className="absolute left-0 top-full mt-1 z-30 w-72 bg-gray-800 border border-gray-700 rounded-lg shadow-xl outline-none"
    >
      <div className="p-2 border-b border-gray-700">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search PRs and issues"
          aria-label="Search PRs and issues"
          className="w-full bg-gray-900 px-2 py-1 rounded text-xs text-gray-200 placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <ul className="max-h-72 overflow-y-auto py-1" aria-label="PRs and issues">
        {shown.length === 0 && (
          <li className="px-3 py-2 text-xs text-gray-500">
            {entries.length === 0 ? 'No open PRs or issues here' : 'No match'}
          </li>
        )}
        {shown.map((entry) => {
          const on = selected.has(entry.key);
          const Icon = entry.kind === 'pr' ? GitPullRequest : CircleDot;
          return (
            <li key={entry.key}>
              <button
                role="checkbox"
                aria-checked={on}
                onClick={() => onToggle(entry.key)}
                title={entry.title}
                className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs transition-colors ${
                  on
                    ? 'bg-blue-500/20 text-blue-100 hover:bg-blue-500/30'
                    : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                }`}
              >
                <Icon
                  size={12}
                  className={`shrink-0 ${entry.kind === 'pr' ? 'text-yellow-400' : 'text-emerald-400'}`}
                  aria-hidden="true"
                />
                <span className="shrink-0 font-mono tabular-nums">{entry.label}</span>
                <span className="truncate min-w-0">{entry.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

/**
 * Sort menu, filter chips and the "N of M" count above the list.
 */
export const AgentFilterBar: React.FC<AgentFilterBarProps> = ({
  sort,
  onSort,
  active,
  onToggle,
  chipCounts,
  shown,
  total,
  filtered,
  onClear,
  linkEntries,
  linkSelected,
  onToggleLink,
}) => {
  const [open, setOpen] = useState(false);
  const [chipsOpen, setChipsOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = SORT_OPTIONS.find((o) => o.key === sort.key) || SORT_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="px-3 py-2 border-b border-gray-800 space-y-1.5 shrink-0">
      <div className="flex items-center gap-1.5 text-xs">
        <div className="relative" ref={rootRef}>
          <button
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            title="Sort agents"
            className="flex items-center gap-1.5 px-2 py-1 rounded text-gray-300 hover:bg-gray-800 border border-gray-800"
          >
            <ArrowUpDown size={12} />
            {current.label}
          </button>
          {open && (
            <div
              role="menu"
              className="absolute left-0 top-full mt-1 z-30 min-w-[180px] bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1"
            >
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  role="menuitemradio"
                  aria-checked={option.key === sort.key}
                  onClick={() => {
                    onSort({ key: option.key, dir: option.dir });
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-gray-200 hover:bg-gray-700 hover:text-white"
                >
                  <span className="w-3">{option.key === sort.key && <Check size={12} />}</span>
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => onSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
          disabled={!current.directional}
          title={
            current.directional
              ? `Direction: ${sort.dir === 'asc' ? 'ascending' : 'descending'} (click to reverse)`
              : 'This sort has a fixed direction'
          }
          aria-label="Reverse sort direction"
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
        >
          {sort.dir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
        </button>
        <button
          onClick={() => setChipsOpen((v) => !v)}
          aria-expanded={chipsOpen}
          aria-controls="agent-filter-chips"
          title={chipsOpen ? 'Hide filters' : 'Show filters'}
          aria-label={chipsOpen ? 'Hide filters' : 'Show filters'}
          className={`flex items-center gap-1 px-1.5 py-1 rounded hover:bg-gray-800 ${
            active.size > 0 ? 'text-blue-300' : 'text-gray-400 hover:text-white'
          }`}
        >
          <ListFilter size={13} />
          {active.size > 0 && <span className="tabular-nums">{active.size}</span>}
        </button>
        <div className="relative">
          <button
            onClick={() => setLinksOpen((v) => !v)}
            data-popover-trigger
            aria-haspopup="dialog"
            aria-expanded={linksOpen}
            title="Filter by pull request or issue"
            aria-label="Filter by pull request or issue"
            className={`flex items-center gap-1 px-1.5 py-1 rounded hover:bg-gray-800 ${
              linkSelected.size > 0 ? 'text-blue-300' : 'text-gray-400 hover:text-white'
            }`}
          >
            <GitPullRequest size={13} />
            {linkSelected.size > 0 && <span className="tabular-nums">{linkSelected.size}</span>}
          </button>
          {linksOpen && (
            <LinkFilterPanel
              entries={linkEntries}
              selected={linkSelected}
              onToggle={onToggleLink}
              onClose={() => setLinksOpen(false)}
            />
          )}
        </div>
        <div className="flex-1" />
        <span className="text-gray-500 tabular-nums" aria-live="polite">
          {filtered ? `${shown} of ${total}` : `${total} ${total === 1 ? 'agent' : 'agents'}`}
        </span>
        {filtered && (
          <button
            onClick={onClear}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-blue-300 hover:text-white hover:bg-gray-800"
            title="Clear all filters"
          >
            <X size={11} /> Clear
          </button>
        )}
      </div>
      {chipsOpen && (
        <div
          id="agent-filter-chips"
          className="flex flex-wrap gap-1"
          role="group"
          aria-label="Filter agents"
        >
          {QUICK_FILTERS.map((chip) => {
            const on = active.has(chip.key);
            const count = chipCounts[chip.key];
            return (
              <button
                key={chip.key}
                onClick={() => onToggle(chip.key)}
                aria-pressed={on}
                title={chip.title}
                className={`px-2 py-0.5 rounded-full text-[11px] border tabular-nums ${
                  on
                    ? 'bg-blue-500/20 border-blue-500/50 text-blue-200'
                    : count === 0
                      ? 'border-gray-800 text-gray-500 hover:bg-gray-800'
                      : 'border-gray-700 text-gray-300 hover:bg-gray-800'
                }`}
              >
                {chip.label} <span className={on ? 'text-blue-300' : 'text-gray-500'}>{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
