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
  Search,
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
import { SEARCH_SHORTCUT, isMac } from '../CommandPalette/CommandPaletteProvider';

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
    <div className="flex items-center gap-0.5 text-xs text-gray-400 min-w-0 flex-wrap whitespace-nowrap">
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
  /** Rail text search (#198), narrows the shown list */
  query: string;
  onQuery: (query: string) => void;
  linkSelected: ReadonlySet<string>;
  onToggleLink: (key: string) => void;
  /** Rendered first in the row (the grouping picker) */
  leading?: React.ReactNode;
  /** Rendered after the search (collapse / expand all) */
  trailing?: React.ReactNode;
}

/** Whether the quick-filter chips are expanded (collapsed by default) */
export const CHIPS_OPEN_KEY = 'devOrbitAgentFilterChipsOpen';

/**
 * One search for the rail: the text narrows the agent list and the PR / issue list below it;
 * a highlighted PR or issue narrows the agent list to the agents linked to it.
 */
const SearchPanel: React.FC<{
  query: string;
  onQuery: (query: string) => void;
  entries: LinkFilterEntry[];
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onClose: () => void;
}> = ({ query, onQuery, entries, selected, onToggle, onClose }) => {
  const ref = usePopover(onClose);
  const inputRef = useRef<HTMLInputElement>(null);
  // After usePopover's effect, which focuses the panel itself
  useEffect(() => inputRef.current?.focus(), []);
  const q = query.trim().toLowerCase();
  const shown = q
    ? entries.filter((e) => `${e.label} ${e.title}`.toLowerCase().includes(q))
    : entries;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label="Search agents, PRs and issues"
      className="absolute left-0 right-0 top-full mt-1 z-30 bg-gray-800 border border-gray-700 rounded-lg shadow-xl outline-none"
    >
      <div className="p-2 border-b border-gray-700">
        <label className="flex items-center gap-1.5 bg-gray-900 px-2 py-1 rounded text-gray-500 focus-within:ring-1 focus-within:ring-blue-500">
          <Search size={12} aria-hidden className="shrink-0" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              // Focus returns to the trigger: without this the same Enter would click it open again
              e.preventDefault();
              onClose();
            }}
            placeholder="Search agents, PRs and issues"
            aria-label="Search agents"
            className="w-full min-w-0 bg-transparent text-xs text-gray-200 placeholder-gray-500 outline-none"
          />
        </label>
      </div>
      <div className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        Pull requests and issues
      </div>
      <ul className="max-h-72 overflow-y-auto pb-1" aria-label="PRs and issues">
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
 * One row above the list: grouping (`leading`), sort, filter chips toggle, search, `trailing`
 * and the count.
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
  query,
  onQuery,
  leading,
  trailing,
}) => {
  const [open, setOpen] = useState(false);
  const [chipsOpen, setChipsOpenState] = useState(() => {
    try {
      return localStorage.getItem(CHIPS_OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const setChipsOpen = (open: boolean) => {
    setChipsOpenState(open);
    try {
      localStorage.setItem(CHIPS_OPEN_KEY, open ? '1' : '0');
    } catch {
      // stays in memory only
    }
  };
  const [searchOpen, setSearchOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const current = SORT_OPTIONS.find((o) => o.key === sort.key) || SORT_OPTIONS[0];

  // Cmd/Ctrl+K toggles the search; in a terminal off macOS Ctrl+K is readline's kill-line, so
  // there it takes Ctrl+Shift+K (as the palette does with P)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      const inTerminal = !isMac && !!(e.target as HTMLElement | null)?.closest?.('.xterm');
      if (!mod || e.altKey || e.key.toLowerCase() !== 'k' || e.shiftKey !== inTerminal) return;
      // Rail hidden (small screen on another route) or a modal on top: not ours
      const bar = barRef.current;
      if (!bar || bar.checkVisibility?.() === false) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      e.stopPropagation();
      setSearchOpen((v) => !v);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

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

  const searching = query.trim() !== '' || linkSelected.size > 0;

  return (
    <div ref={barRef} className="px-3 py-2 border-b border-gray-800 space-y-1.5 shrink-0">
      {/* relative: the search panel spans the whole row */}
      <div className="relative flex items-center gap-1 text-xs">
        {leading}
        <div className="relative min-w-0" ref={rootRef}>
          <button
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`Sort agents: ${current.label}`}
            title="Sort agents"
            className="w-full flex items-center gap-1 px-1.5 py-1 rounded text-gray-300 hover:bg-gray-800 border border-gray-800"
          >
            <ArrowUpDown size={12} className="shrink-0" />
            <span className="truncate">{current.label}</span>
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
          className="shrink-0 p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
        >
          {sort.dir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
        </button>
        <button
          onClick={() => setChipsOpen(!chipsOpen)}
          aria-expanded={chipsOpen}
          aria-controls="agent-filter-chips"
          title={chipsOpen ? 'Hide filters' : 'Show filters'}
          aria-label={chipsOpen ? 'Hide filters' : 'Show filters'}
          className={`shrink-0 flex items-center gap-1 px-1.5 py-1 rounded hover:bg-gray-800 ${
            active.size > 0 ? 'text-blue-300' : 'text-gray-400 hover:text-white'
          }`}
        >
          <ListFilter size={13} />
          {active.size > 0 && <span className="tabular-nums">{active.size}</span>}
        </button>
        <div className="min-w-0">
          <button
            onClick={() => setSearchOpen((v) => !v)}
            data-popover-trigger
            aria-haspopup="dialog"
            aria-expanded={searchOpen}
            title={`Search agents, PRs and issues (${SEARCH_SHORTCUT})`}
            aria-label={`Search agents, PRs and issues (${SEARCH_SHORTCUT})`}
            className={`max-w-full flex items-center gap-1 px-1.5 py-1 rounded hover:bg-gray-800 ${
              searching ? 'text-blue-300' : 'text-gray-400 hover:text-white'
            } ${searchOpen ? 'bg-gray-800' : ''}`}
          >
            <Search size={13} className="shrink-0" />
            {query.trim() && <span className="truncate">{query.trim()}</span>}
            {linkSelected.size > 0 && (
              <span className="shrink-0 flex items-center gap-0.5 tabular-nums">
                <GitPullRequest size={11} aria-hidden />
                {linkSelected.size}
              </span>
            )}
          </button>
          {searchOpen && (
            <SearchPanel
              query={query}
              onQuery={onQuery}
              entries={linkEntries}
              selected={linkSelected}
              onToggle={onToggleLink}
              onClose={() => setSearchOpen(false)}
            />
          )}
        </div>
        {trailing}
        <span className="flex-1" />
        <span className="shrink-0 text-gray-500 tabular-nums whitespace-nowrap" aria-live="polite">
          {filtered ? `${shown} of ${total}` : `${total} ${total === 1 ? 'agent' : 'agents'}`}
        </span>
        {filtered && (
          <button
            onClick={onClear}
            className="shrink-0 p-1 rounded text-blue-300 hover:text-white hover:bg-gray-800"
            title="Clear all filters"
            aria-label="Clear all filters"
          >
            <X size={12} />
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
