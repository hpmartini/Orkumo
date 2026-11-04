import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import type { AppConfig, ProjectContext } from '../types';
import { useDialogA11y } from './CommandPalette/useDialogA11y';
import { FIELD_INPUT } from './BoardView/IssueFields';
import { parseContextFilter } from '../utils/board';
import { groupByRoot, projectRoot, shortPath } from '../utils/projectDirs';
import { shortenPath } from '../utils/agentSessions';

// Characters that fit the default 560px dialog at 11px mono; shortenPath cuts the start so the
// folder name stays visible, CSS truncate stays as fallback for narrower (resized) dialogs
const HEADER_PATH_CHARS = 72;
const ROW_PATH_CHARS = 68;

export const CONTEXT_DIALOG_SIZE_KEY = 'devOrbitContextDialogSize';
export const CONTEXT_DIALOG_COLLAPSED_KEY = 'devOrbitContextDialogCollapsed';
/** Collapse key of the group outside every project directory */
const OTHER_GROUP = '';

interface DialogSize {
  width: number;
  height: number;
}

function loadJson<T>(key: string, isValid: (v: unknown) => v is T): T | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    return isValid(value) ? value : null;
  } catch {
    return null;
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // stays in memory only
  }
}

const isSize = (v: unknown): v is DialogSize =>
  typeof v === 'object' &&
  v !== null &&
  Number.isFinite((v as DialogSize).width) &&
  Number.isFinite((v as DialogSize).height);
const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

interface ContextDialogProps {
  /** null creates a new context */
  context: ProjectContext | null;
  apps: AppConfig[];
  /** Configured project directories (admin panel): the list clusters by them */
  projectDirs: string[];
  canDelete: boolean;
  onSave: (input: Omit<ProjectContext, 'id'>) => void;
  onDelete: () => void;
  onClose: () => void;
  /** Opens the admin panel, where the project directories are configured */
  onOpenSettings: () => void;
}

/** Create or edit a project context: name, member projects, board filter */
export const ContextDialog: React.FC<ContextDialogProps> = ({
  context,
  apps,
  projectDirs,
  canDelete,
  onSave,
  onDelete,
  onClose,
  onOpenSettings,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const trapTab = useDialogA11y(true, dialogRef, () => nameRef.current);
  const [name, setName] = useState(context?.name ?? '');
  const [allApps, setAllApps] = useState(context ? context.appIds === null : false);
  const [selected, setSelected] = useState(() => new Set(context?.appIds ?? []));
  const [filterText, setFilterText] = useState(context?.boardFilter.join(', ') ?? '');
  const [query, setQuery] = useState('');
  const [size, setSize] = useState(() => loadJson(CONTEXT_DIALOG_SIZE_KEY, isSize));
  const [collapsed, setCollapsed] = useState(
    () => new Set(loadJson(CONTEXT_DIALOG_COLLAPSED_KEY, isStringList) ?? [])
  );
  const searching = query.trim() !== '';

  // The native resize grip writes inline width/height; keep what the user dragged to on release.
  // Pointerup instead of a ResizeObserver: a shrinking window must not overwrite the saved size
  useEffect(() => {
    const onPointerUp = () => {
      const el = dialogRef.current;
      if (!el?.style.height) return; // never dragged: height is still auto
      const next = { width: el.offsetWidth, height: el.offsetHeight };
      setSize((prev) => {
        if (prev?.width === next.width && prev?.height === next.height) return prev;
        saveJson(CONTEXT_DIALOG_SIZE_KEY, next);
        return next;
      });
    };
    window.addEventListener('pointerup', onPointerUp);
    return () => window.removeEventListener('pointerup', onPointerUp);
  }, []);

  const choices = useMemo(
    () =>
      apps
        .filter((a) => !a.isArchived && a.name.toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [apps, query]
  );
  const groups = useMemo(
    () => groupByRoot(choices, (a) => projectRoot(a.path, projectDirs), projectDirs),
    [choices, projectDirs]
  );

  const updateCollapsed = (next: Set<string>) => {
    setCollapsed(next);
    saveJson(CONTEXT_DIALOG_COLLAPSED_KEY, [...next]);
  };
  const toggleGroup = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    updateCollapsed(next);
  };
  const bulkActions = [
    {
      label: 'Alle Verzeichnisse einklappen',
      Icon: ChevronsDownUp,
      run: () => updateCollapsed(new Set(groups.map((g) => g.root ?? OTHER_GROUP))),
    },
    {
      label: 'Alle Verzeichnisse ausklappen',
      Icon: ChevronsUpDown,
      run: () => updateCollapsed(new Set()),
    },
  ];

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      // Keep members that are archived or gone from the scan: they come back with the project
      appIds: allApps ? null : [...selected],
      boardFilter: parseContextFilter(filterText),
    });
    onClose();
  };

  const title = context ? 'Kontext bearbeiten' : 'Neuer Kontext';
  return (
    <div
      className="fixed inset-0 z-[90] bg-gray-950/70 flex items-start justify-center px-4 pt-[10vh]"
      onMouseDown={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="context-dialog-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          trapTab(e);
          if (e.key === 'Escape' && !e.defaultPrevented) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        onMouseDown={(e) => e.stopPropagation()}
        // Resizable by the native corner grip; min keeps every field usable, max keeps it on screen
        style={{ width: size?.width ?? 560, height: size?.height, maxWidth: 'calc(100vw - 2rem)' }}
        className="flex flex-col min-w-[420px] min-h-[320px] max-h-[85vh] resize overflow-auto bg-gray-800 border border-gray-600 rounded-xl shadow-2xl p-4"
      >
        <form onSubmit={submit} className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center mb-3">
            <h2 id="context-dialog-title" className="text-sm font-semibold text-gray-50">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto p-1.5 rounded-md text-gray-200 hover:bg-gray-700 hover:text-white focus-visible:outline-2 focus-visible:outline-blue-400"
              aria-label="Schließen"
            >
              <X size={15} />
            </button>
          </div>

          <div className="flex flex-col flex-1 min-h-0 gap-3 text-xs">
            <div>
              <label htmlFor="context-name" className="block text-gray-400 mb-1">
                Name
              </label>
              <input
                id="context-name"
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                required
                placeholder="z.B. Epic Zahlungen"
                className={FIELD_INPUT}
              />
            </div>

            {/* min-w-0: a fieldset is min-content wide by default, long paths overflowed the dialog */}
            <fieldset className="min-w-0 flex flex-col flex-1 min-h-0">
              <legend className="text-gray-400 mb-1">Projekte</legend>
              <label className="flex items-center gap-2 text-gray-200 mb-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allApps}
                  onChange={(e) => setAllApps(e.target.checked)}
                  className="accent-blue-500"
                />
                Alle Projekte
              </label>
              {!allApps && (
                <>
                  <div className="flex items-center gap-1 mb-1.5">
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Projekte filtern"
                      aria-label="Projekte filtern"
                      className={FIELD_INPUT}
                    />
                    {bulkActions.map(({ label, Icon, run }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={run}
                        disabled={searching}
                        className="shrink-0 p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700 focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-40 disabled:pointer-events-none"
                        title={searching ? 'Beim Filtern sind alle Treffer sichtbar' : label}
                        aria-label={label}
                      >
                        <Icon size={13} />
                      </button>
                    ))}
                  </div>
                  {/* Never resized: the list keeps its old 18rem cap; once sized it fills the dialog */}
                  <ul
                    data-testid="context-project-list"
                    className="flex-1 min-h-24 overflow-y-auto overscroll-contain rounded border border-gray-700"
                    style={size ? undefined : { maxHeight: '18rem' }}
                  >
                    {groups.map((group) => {
                      const key = group.root ?? OTHER_GROUP;
                      // Filtering shows every match, collapsed or not
                      const open = searching || !collapsed.has(key);
                      const listId = `context-group-${group.root ?? 'other'}`;
                      const picked = group.items.filter((a) => selected.has(a.id)).length;
                      return (
                        <li key={group.root ?? 'other'}>
                          <button
                            type="button"
                            onClick={() => toggleGroup(key)}
                            disabled={searching}
                            aria-expanded={open}
                            aria-controls={listId}
                            title={group.root ?? undefined}
                            className="sticky top-0 z-10 w-full flex items-center gap-1 px-2 py-1 bg-gray-850 border-b border-gray-700 text-[11px] text-gray-400 font-mono text-left hover:text-gray-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-default"
                          >
                            {open ? (
                              <ChevronDown size={12} className="shrink-0" aria-hidden />
                            ) : (
                              <ChevronRight size={12} className="shrink-0" aria-hidden />
                            )}
                            <span className="min-w-0 flex-1 truncate">
                              {group.root
                                ? shortenPath(shortPath(group.root, null), HEADER_PATH_CHARS)
                                : 'Außerhalb der Projektverzeichnisse'}
                            </span>
                            <span
                              className="shrink-0 font-sans tabular-nums"
                              title={`${picked} von ${group.items.length} ausgewählt`}
                            >
                              {picked}/{group.items.length}
                            </span>
                          </button>
                          <ul id={listId} hidden={!open} className="divide-y divide-gray-700/60">
                            {group.items.map((app) => (
                              <li key={app.id}>
                                <label
                                  className="flex items-center gap-2 min-w-0 px-2 py-1.5 text-gray-200 hover:bg-gray-750 cursor-pointer"
                                  title={`${app.name}\n${app.path}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selected.has(app.id)}
                                    onChange={() => toggle(app.id)}
                                    className="accent-blue-500 shrink-0"
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate">{app.name}</span>
                                    <span className="block truncate text-gray-500 font-mono text-[11px]">
                                      {shortenPath(shortPath(app.path, group.root), ROW_PATH_CHARS)}
                                    </span>
                                  </span>
                                </label>
                              </li>
                            ))}
                          </ul>
                        </li>
                      );
                    })}
                    {choices.length === 0 && (
                      <li className="px-2 py-1.5 text-gray-400">Keine Projekte gefunden</li>
                    )}
                  </ul>
                  <div className="mt-1 flex items-center gap-2 text-gray-400">
                    <span>{selected.size} ausgewählt</span>
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="ml-auto flex items-center gap-1 rounded px-1 text-blue-300 hover:text-blue-200 hover:underline focus-visible:outline-2 focus-visible:outline-blue-400"
                    >
                      <Settings size={12} /> Projektverzeichnisse verwalten
                    </button>
                  </div>
                </>
              )}
            </fieldset>

            <div>
              <label htmlFor="context-board-filter" className="block text-gray-400 mb-1">
                Board-Filter
              </label>
              <input
                id="context-board-filter"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="label:epic-zahlungen, milestone:v2, repo:owner/name"
                className={`${FIELD_INPUT} font-mono`}
              />
              <p className="mt-1 text-gray-400">
                Kommagetrennt, Arten repo, label, milestone, assignee. Gleiche Art = oder,
                verschiedene Arten = und. Leer zeigt das ganze Board.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4">
            {context && canDelete && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Kontext „${context.name}" löschen?`)) {
                    onDelete();
                    onClose();
                  }
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-red-300 hover:bg-red-500/15"
              >
                <Trash2 size={13} /> Löschen
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="ml-auto px-3 py-1.5 rounded-md text-xs text-gray-200 hover:bg-gray-700"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {context ? 'Speichern' : 'Anlegen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
