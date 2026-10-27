import React, { useMemo, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { AppConfig, ProjectContext } from '../types';
import { useDialogA11y } from './CommandPalette/useDialogA11y';
import { FIELD_INPUT } from './BoardView/IssueFields';
import { parseContextFilter } from '../utils/board';

interface ContextDialogProps {
  /** null creates a new context */
  context: ProjectContext | null;
  apps: AppConfig[];
  canDelete: boolean;
  onSave: (input: Omit<ProjectContext, 'id'>) => void;
  onDelete: () => void;
  onClose: () => void;
}

/** Create or edit a project context: name, member projects, board filter */
export const ContextDialog: React.FC<ContextDialogProps> = ({
  context,
  apps,
  canDelete,
  onSave,
  onDelete,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const trapTab = useDialogA11y(true, dialogRef, () => nameRef.current);
  const [name, setName] = useState(context?.name ?? '');
  const [allApps, setAllApps] = useState(context ? context.appIds === null : false);
  const [selected, setSelected] = useState(() => new Set(context?.appIds ?? []));
  const [filterText, setFilterText] = useState(context?.boardFilter.join(', ') ?? '');
  const [query, setQuery] = useState('');

  const choices = useMemo(
    () =>
      apps
        .filter((a) => !a.isArchived && a.name.toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [apps, query]
  );

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
        className="w-full max-w-[520px] bg-gray-800 border border-gray-600 rounded-xl shadow-2xl p-4"
      >
        <form onSubmit={submit}>
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

          <div className="space-y-3 text-xs">
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

            <fieldset>
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
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Projekte filtern"
                    aria-label="Projekte filtern"
                    className={`${FIELD_INPUT} mb-1.5`}
                  />
                  <ul className="max-h-56 overflow-y-auto rounded border border-gray-700 divide-y divide-gray-700/60">
                    {choices.map((app) => (
                      <li key={app.id}>
                        <label className="flex items-center gap-2 px-2 py-1.5 text-gray-200 hover:bg-gray-750 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selected.has(app.id)}
                            onChange={() => toggle(app.id)}
                            className="accent-blue-500"
                          />
                          <span className="truncate">{app.name}</span>
                          <span className="ml-auto truncate text-gray-500 max-w-[45%]">
                            {app.path}
                          </span>
                        </label>
                      </li>
                    ))}
                    {choices.length === 0 && (
                      <li className="px-2 py-1.5 text-gray-400">Keine Projekte gefunden</li>
                    )}
                  </ul>
                  <p className="mt-1 text-gray-400">{selected.size} ausgewählt</p>
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
