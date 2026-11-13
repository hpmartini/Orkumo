import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Search,
} from 'lucide-react';
import {
  codeRows,
  findCodeTarget,
  pushRecent,
  OTHER_FOLDERS_KEY,
  samePath,
  worktreesKey,
  type CodeGroup,
  type CodeProject,
  type CodeRow,
  type CodeTarget,
} from '../../utils/codeTarget';
import { usePopover } from '../AgentsView/PullRequestsPanel';
import { isMac } from '../CommandPalette/CommandPaletteProvider';

/** Folders opened in Code mode, newest first */
export const CODE_RECENT_KEY = 'devOrbitCodeRecent';
/** Picker folds: collapsed scan-root groups (their keys), projects showing all worktrees (`wt:…`) */
export const CODE_FOLDS_KEY = 'devOrbitCodePickerFolds';
const RECENT_SHOWN = 6;
const SHORTCUT = isMac ? '⌘O' : 'Ctrl+O';

function loadList(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveList(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // stays in memory only
  }
}

/** Records a folder Code mode opened for the picker's Recent section */
export function rememberCodeFolder(path: string) {
  saveList(CODE_RECENT_KEY, pushRecent(loadList(CODE_RECENT_KEY), path));
}

/** Path to show for a row: worktree paths inside their project are relative to it */
function fullDisplay(project: CodeProject, row: CodeTarget): string {
  return row === project || /^[~/]/.test(row.display)
    ? row.display
    : `${project.display}/${row.display}`;
}

const KIND_ICON = {
  project: FolderGit2,
  checkout: FolderGit2,
  worktree: GitBranch,
  folder: Folder,
};

/** Section of a row: Recent or the key of its scan-root group */
const RECENT = 'recent';

type Row = CodeRow & { section: string };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Folder of Code mode: trigger with the open project and worktree, popover combobox to search
 * and open any project, worktree or agent folder of the context (Cmd/Ctrl+O).
 */
export const FolderPicker: React.FC<{
  groups: CodeGroup[];
  /** Path of the open folder (or the one being opened) */
  current: string | null;
  /** Registers Cmd/Ctrl+O while the mode is visible */
  active: boolean;
  onPick: (path: string) => void;
}> = ({ groups, current, active, onPick }) => {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const match = findCodeTarget(groups, current);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (!mod || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'o') return;
      e.preventDefault();
      setOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);

  const TriggerIcon = match ? KIND_ICON[match.target.kind] : current ? Folder : FolderOpen;
  const worktree = match && match.target !== match.project ? match.target : null;
  const shownPath = match ? fullDisplay(match.project, match.target) : current;

  return (
    <div className="relative min-w-0 flex">
      <button
        ref={triggerRef}
        type="button"
        data-popover-trigger
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Folder: ${match ? match.target.label : current || 'none'}. Change folder (${SHORTCUT})`}
        title={current ? `${current} (${SHORTCUT} to switch)` : `Open a project (${SHORTCUT})`}
        onClick={() => setOpen((o) => !o)}
        className={`group min-w-0 max-w-2xl flex items-center gap-2 h-7 pl-2 pr-1.5 rounded border text-sm transition-colors focus-visible:outline-2 focus-visible:outline-blue-400 ${open ? 'bg-gray-800 border-gray-600' : 'bg-gray-900 border-gray-700 hover:border-gray-600 hover:bg-gray-800/70'}`}
      >
        <TriggerIcon
          size={14}
          aria-hidden
          className={`shrink-0 ${match ? 'text-blue-400' : 'text-gray-500'}`}
        />
        {match ? (
          <>
            <span className="min-w-0 truncate font-medium text-gray-100">
              {match.project.label}
            </span>
            {worktree && (
              <span className="min-w-0 flex items-center gap-1 text-gray-300">
                <span aria-hidden className="text-gray-500">
                  /
                </span>
                <span className="truncate">{worktree.label}</span>
              </span>
            )}
          </>
        ) : (
          <span className={`min-w-0 truncate ${current ? 'text-gray-100' : 'text-gray-400'}`}>
            {current ? current.split('/').pop() : 'Open a project…'}
          </span>
        )}
        {shownPath && (
          <span className="hidden sm:block min-w-0 flex-1 truncate font-mono text-xs text-gray-500">
            {shownPath}
          </span>
        )}
        <ChevronDown
          size={14}
          aria-hidden
          className="shrink-0 text-gray-500 group-hover:text-gray-300"
        />
      </button>
      {open && (
        <FolderPickerPanel
          groups={groups}
          current={match?.target.path ?? current}
          left={triggerRef.current?.getBoundingClientRect().left ?? 0}
          onClose={close}
          onPick={(path) => {
            setOpen(false);
            rememberCodeFolder(path);
            onPick(path);
          }}
        />
      )}
    </div>
  );
};

const FolderPickerPanel: React.FC<{
  groups: CodeGroup[];
  current: string | null;
  /** Viewport x of the trigger: the panel never runs past the right edge */
  left: number;
  onClose: () => void;
  onPick: (path: string) => void;
}> = ({ groups, current, left, onClose, onPick }) => {
  const ref = usePopover(onClose);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [query, setQuery] = useState('');
  const [folds, setFolds] = useState<ReadonlySet<string>>(() => new Set(loadList(CODE_FOLDS_KEY)));
  // Worktrees opened while searching: forgotten with the query, never stored
  const [searchExpanded, setSearchExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [recentPaths] = useState(() => loadList(CODE_RECENT_KEY));
  const searching = query.trim() !== '';

  // Clicking into the Web-IDE frame sends no mousedown here, only a window blur
  useEffect(() => {
    window.addEventListener('blur', onClose);
    return () => window.removeEventListener('blur', onClose);
  }, [onClose]);

  const expanded = searching ? searchExpanded : folds;
  const listed = useMemo(
    () => codeRows(groups, { query, current, expanded }),
    [groups, query, current, expanded]
  );
  // Visible rows in display order, Recent first: the keyboard walks this list
  const rows = useMemo(() => {
    const list: Row[] = [];
    if (!searching)
      for (const path of recentPaths) {
        if (list.length === RECENT_SHOWN) break;
        const hit = samePath(path, current) ? null : findCodeTarget(groups, path);
        if (hit) list.push({ type: 'target', ...hit, section: RECENT });
      }
    for (const section of listed.sections)
      if (searching || !folds.has(section.key))
        for (const row of section.rows) list.push({ ...row, section: section.key });
    return list;
  }, [groups, listed, recentPaths, current, folds, searching]);

  const currentIndex = rows.findIndex(
    (r) => r.type === 'target' && r.section !== RECENT && samePath(r.target.path, current)
  );
  const [active, setActive] = useState(() => Math.max(0, currentIndex));
  const activeIndex = Math.min(active, rows.length - 1);
  const optionId = (i: number) => `${id}-row-${i}`;

  // After usePopover's effect, which focuses the panel itself; the open folder starts in view
  useEffect(() => {
    inputRef.current?.focus();
    if (currentIndex >= 0)
      document.getElementById(optionId(currentIndex))?.scrollIntoView?.({ block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggled = (set: ReadonlySet<string>, key: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  };
  const storeFolds = (next: Set<string>) => {
    setFolds(next);
    saveList(CODE_FOLDS_KEY, [...next]);
  };
  const toggleGroup = (key: string) => {
    storeFolds(toggled(folds, key, !folds.has(key)));
    setActive(0);
  };
  const setWorktreesOpen = (project: CodeProject, open: boolean) => {
    const key = worktreesKey(project);
    if (searching) setSearchExpanded(toggled(searchExpanded, key, open));
    else storeFolds(toggled(folds, key, open));
  };

  const choose = (row: Row) => {
    if (row.type === 'more') setWorktreesOpen(row.project, !row.expanded);
    else onPick(row.target.path);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const row = rows[activeIndex];
    // ←/→ fold worktrees only with the caret at the end; inside the query they move it
    const caretAtEnd = e.currentTarget.selectionStart === e.currentTarget.value.length;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && rows.length) {
      e.preventDefault();
      const next = (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      setActive(next);
      document.getElementById(optionId(next))?.scrollIntoView?.({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      // The same Enter would click the trigger open again once focus returns to it
      e.preventDefault();
      if (row) choose(row);
    } else if (e.key === 'ArrowRight' && caretAtEnd && row?.type === 'more' && !row.expanded) {
      e.preventDefault();
      setWorktreesOpen(row.project, true);
    } else if (e.key === 'ArrowLeft' && caretAtEnd && row && row.section !== RECENT) {
      // On the toggle or on a worktree it revealed: fold and land on the toggle
      const toggle = rows.findIndex(
        (r) => r.type === 'more' && r.project === row.project && r.section === row.section
      );
      const toggleRow = rows[toggle];
      if (toggleRow?.type !== 'more' || !toggleRow.expanded || toggle > activeIndex) return;
      e.preventDefault();
      setWorktreesOpen(row.project, false);
      setActive(toggle);
    }
  };

  const renderRow = (row: Row, i: number) => {
    const isActive = i === activeIndex;
    const common = {
      id: optionId(i),
      role: 'option',
      'aria-selected': isActive,
      onMouseMove: () => i !== active && setActive(i),
      // Focus stays in the search field
      onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
      onClick: () => choose(row),
    };
    if (row.type === 'more') {
      const Chevron = row.expanded ? ChevronDown : ChevronRight;
      return (
        <div
          key={`${row.section}:more:${row.project.path}`}
          {...common}
          aria-expanded={row.expanded}
          className={`flex items-center gap-2 h-7 pl-9 pr-3 cursor-pointer select-none text-xs ${isActive ? 'bg-sel text-white' : 'text-gray-400'}`}
        >
          <Chevron size={12} aria-hidden className="shrink-0" />
          <span className="truncate">
            {`${row.count} ${row.all ? '' : 'more '}worktree${row.count === 1 ? '' : 's'}`}
          </span>
        </div>
      );
    }
    const { project, target } = row;
    const Icon = KIND_ICON[target.kind];
    const isCurrent = samePath(target.path, current);
    const recent = row.section === RECENT;
    const nested = target !== project && !recent;
    const note = [
      recent && target !== project ? `in ${project.label}` : null,
      target.detail,
      target.qualifier,
    ].filter(Boolean);
    return (
      <div
        key={`${row.section}:${target.path}`}
        {...common}
        aria-current={isCurrent || undefined}
        title={target.path}
        className={`flex items-center gap-2 h-8 pr-3 cursor-pointer select-none ${nested ? 'pl-9' : 'pl-3'} ${isActive ? 'bg-sel' : ''}`}
      >
        <Icon
          size={nested ? 12 : 14}
          aria-hidden
          className={`shrink-0 ${isCurrent ? 'text-blue-300' : isActive ? 'text-gray-200' : 'text-gray-500'}`}
        />
        <span
          className={`shrink-0 max-w-[55%] truncate text-sm ${nested ? '' : 'font-medium'} ${isCurrent ? 'text-blue-200' : isActive ? 'text-white' : nested ? 'text-gray-200' : 'text-gray-100'}`}
        >
          {target.label}
        </span>
        {note.length > 0 && (
          <span
            className={`shrink-0 max-w-[30%] truncate text-xs ${isActive ? 'text-gray-200' : 'text-gray-400'}`}
          >
            {note.join(' · ')}
          </span>
        )}
        <span
          className={`min-w-0 flex-1 basis-0 truncate font-mono text-xs ${isActive ? 'text-gray-300' : 'text-gray-500'}`}
        >
          {recent ? fullDisplay(project, target) : target.display}
        </span>
        {isCurrent && <Check size={14} aria-label="Open now" className="shrink-0 text-blue-300" />}
      </div>
    );
  };

  const listId = `${id}-list`;
  const total = groups.reduce((n, g) => n + g.projects.length, 0);
  const projectCount = groups.reduce(
    (n, g) => n + (g.key === OTHER_FOLDERS_KEY ? 0 : g.projects.length),
    0
  );
  const sectionRows = (section: string) =>
    rows.flatMap((row, i) => (row.section === section ? [renderRow(row, i)] : []));
  const recentRows = sectionRows(RECENT);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label="Open a folder in Code"
      style={{ width: `min(40rem, calc(100vw - ${Math.round(left) + 8}px))` }}
      className="absolute left-0 top-full mt-1 z-40 flex flex-col bg-gray-900 border border-gray-700 rounded-lg shadow-[0_12px_32px_-8px_rgba(0,0,0,0.7)] outline-none overflow-hidden"
    >
      <label className="flex items-center gap-2 px-3 h-10 border-b border-gray-800 text-gray-500 focus-within:text-gray-300">
        <Search size={14} aria-hidden className="shrink-0" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={rows.length ? optionId(activeIndex) : undefined}
          aria-label="Search projects, worktrees and folders"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearchExpanded(new Set());
            setActive(0);
            listRef.current?.scrollTo?.({ top: 0 });
          }}
          onKeyDown={onKeyDown}
          placeholder="Search projects, worktrees, paths…"
          spellCheck={false}
          autoComplete="off"
          className="flex-1 min-w-0 bg-transparent text-sm text-gray-100 placeholder-gray-500 outline-none caret-blue-400"
        />
        <span className="shrink-0 text-[11px] tabular-nums text-gray-500">
          {searching
            ? `${plural(listed.projects, 'project')} · ${plural(listed.worktrees, 'worktree')}`
            : plural(projectCount, 'project')}
        </span>
      </label>

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Folders"
        className="max-h-[min(28rem,60vh)] overflow-y-auto overscroll-contain pb-1"
      >
        {recentRows.length > 0 && (
          <div role="group" aria-labelledby={`${id}-recent`}>
            <div
              id={`${id}-recent`}
              className="px-3 pt-2 pb-1 text-[11px] font-medium text-gray-400"
            >
              Recent
            </div>
            {recentRows}
          </div>
        )}
        {listed.sections.map((section, si) => {
          const groupOpen = searching || !folds.has(section.key);
          const headerId = `${id}-group-${si}`;
          return (
            <div key={section.key} role="group" aria-labelledby={headerId}>
              <button
                id={headerId}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggleGroup(section.key)}
                disabled={searching}
                aria-expanded={groupOpen}
                title={searching ? 'All matches are shown while searching' : undefined}
                className="sticky -top-px z-10 w-full flex items-center gap-1 px-3 pt-2 pb-1 bg-gray-900 text-[11px] font-medium text-gray-400 text-left hover:text-gray-200 disabled:hover:text-gray-400 disabled:cursor-default focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-400"
              >
                {groupOpen ? (
                  <ChevronDown size={12} aria-hidden className="shrink-0" />
                ) : (
                  <ChevronRight size={12} aria-hidden className="shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{section.label}</span>
                <span className="shrink-0 tabular-nums text-gray-500">{section.count}</span>
              </button>
              {groupOpen && sectionRows(section.key)}
            </div>
          );
        })}
        {total === 0 && (
          <p className="px-3 py-6 text-center text-sm text-gray-400">
            No projects in this context yet. Add project directories in Settings.
          </p>
        )}
        {total > 0 && listed.sections.length === 0 && (
          <div className="px-3 py-6 text-center text-sm">
            <p className="text-gray-300">No folder matches “{query.trim()}”.</p>
            <p className="mt-1 text-xs text-gray-500">
              Every word must appear in a project's name, folder or path, or in a worktree's.
            </p>
          </div>
        )}
      </div>

      <div className="hidden sm:flex items-center gap-3 px-3 h-7 border-t border-gray-800 text-[11px] text-gray-500">
        <span>
          <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> move
        </span>
        <span>
          <kbd className="kbd">↵</kbd> open
        </span>
        <span>
          <kbd className="kbd">←</kbd> <kbd className="kbd">→</kbd> worktrees
        </span>
        <span>
          <kbd className="kbd">esc</kbd> close
        </span>
        <span className="ml-auto">
          <kbd className="kbd">{SHORTCUT}</kbd> anywhere in Code
        </span>
      </div>
    </div>
  );
};
