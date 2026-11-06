import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import {
  groupDirectories,
  samePath,
  shortenHome,
  type DirectoryChoice,
} from '../../utils/directoryGroups';

/** Collapsed parent directories (group keys), kept across openings of the picker */
const DIRECTORY_PICKER_COLLAPSED_KEY = 'devOrbitDirectoryPickerCollapsed';

function loadCollapsed(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DIRECTORY_PICKER_COLLAPSED_KEY) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Directory picker for the dispatch target, grouped by parent directory (#158) */
export const DirectoryPicker: React.FC<{
  choices: DirectoryChoice[];
  current: string | null;
  home: string | null;
  onCancel: () => void;
  onPick: (path: string) => void;
}> = ({ choices, current, home, onCancel, onPick }) => {
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState(current || '');
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const searching = query.trim() !== '';
  const groups = useMemo(
    () => groupDirectories(choices, { home, current, query }),
    [choices, home, current, query]
  );
  // The pinned group has no header and never collapses; filtering shows every match
  const isOpen = (group: (typeof groups)[number]) =>
    !group.label || searching || !collapsed.has(group.key);
  const first = groups.find(isOpen)?.entries[0];

  const updateCollapsed = (next: Set<string>) => {
    setCollapsed(next);
    try {
      localStorage.setItem(DIRECTORY_PICKER_COLLAPSED_KEY, JSON.stringify([...next]));
    } catch {
      // stays in memory only
    }
  };
  const toggleGroup = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    updateCollapsed(next);
  };
  const bulkActions = [
    {
      label: 'Collapse all directories',
      Icon: ChevronsDownUp,
      run: () => updateCollapsed(new Set(groups.filter((g) => g.label).map((g) => g.key))),
    },
    {
      label: 'Expand all directories',
      Icon: ChevronsUpDown,
      run: () => updateCollapsed(new Set()),
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[95] bg-black/60 flex items-start justify-center pt-24 p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-xl bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        // On the panel, not the search field: focus may sit on a header or entry button
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
      >
        <div className="flex items-center gap-1 px-4 py-3 border-b border-gray-800">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && first) onPick(first.path);
            }}
            placeholder="Directory for new sessions…"
            className="flex-1 min-w-0 bg-transparent text-sm text-gray-100 placeholder-gray-600 outline-none"
          />
          {bulkActions.map(({ label, Icon, run }) => (
            <button
              key={label}
              type="button"
              onClick={run}
              disabled={searching}
              className="shrink-0 p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-40 disabled:pointer-events-none"
              title={searching ? 'All matches are shown while filtering' : label}
              aria-label={label}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>
        <div className="max-h-[45vh] overflow-y-auto pb-1">
          {groups.map((group) => {
            const open = isOpen(group);
            const listId = `dir-group-${group.key}`;
            return (
              <div key={group.key} role="group" aria-label={group.label ?? 'Current and home'}>
                {group.label && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    disabled={searching}
                    aria-expanded={open}
                    aria-controls={listId}
                    title={group.label}
                    className="sticky top-0 z-10 w-full flex items-center gap-1 px-4 pt-3 pb-1 bg-gray-900 border-t border-gray-800/70 text-[11px] font-mono text-gray-400 text-left hover:text-gray-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-default"
                  >
                    {open ? (
                      <ChevronDown size={12} className="shrink-0" aria-hidden />
                    ) : (
                      <ChevronRight size={12} className="shrink-0" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 truncate">{group.label}</span>
                    <span className="shrink-0 font-sans tabular-nums">{group.entries.length}</span>
                  </button>
                )}
                <div id={listId} hidden={!open}>
                  {group.entries.map((entry) => (
                    <button
                      key={entry.path}
                      data-testid="dir-choice"
                      title={entry.path}
                      onClick={() => onPick(entry.path)}
                      className={`w-full text-left px-4 py-1.5 flex items-center gap-3 min-w-0 whitespace-nowrap hover:bg-gray-800 ${entry === first ? 'bg-gray-800/40' : ''} ${samePath(entry.path, current) ? 'text-blue-300' : 'text-gray-100'}`}
                    >
                      <span className="text-sm truncate min-w-0">{entry.name}</span>
                      <span className="text-xs text-gray-500 font-mono truncate min-w-0 flex-1 basis-0">
                        {group.label ? entry.detail : shortenHome(entry.path, home)}
                      </span>
                      <span className="shrink-0 text-[10px] text-gray-500">
                        {entry.sources.join(' · ')}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {groups.length === 0 && (
            <div className="px-4 py-4 text-sm text-gray-500">No matches.</div>
          )}
        </div>
        <div className="flex items-center gap-2 px-4 py-2 border-t border-gray-800">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && custom.trim()) onPick(custom.trim());
            }}
            placeholder="/absolute/path"
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs font-mono text-gray-100 outline-none focus:border-blue-500"
          />
          <button
            onClick={() => custom.trim() && onPick(custom.trim())}
            className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs"
          >
            Use path
          </button>
        </div>
      </div>
    </div>
  );
};
