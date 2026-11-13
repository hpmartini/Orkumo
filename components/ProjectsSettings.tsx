import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FolderGit2,
  FolderOpen,
  GitMerge,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type { ProjectEntry } from '../types';
import {
  createCustomProject,
  deleteCustomProject,
  fetchProjects,
  mergeProject,
  renameDetectedProject,
  setProjectDisabled,
  updateCustomProject,
} from '../services/api';

/** Fired on `window` to open the settings at the Projects section, optionally at one project */
export const PROJECT_SETTINGS_EVENT = 'orkumo:project-settings';

export function openProjectSettings(projectId?: string) {
  window.dispatchEvent(new window.CustomEvent(PROJECT_SETTINGS_EVENT, { detail: { projectId } }));
}

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-1';
const ICON_BUTTON = `p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${FOCUS}`;
const TEXT_BUTTON = `px-2.5 py-1 rounded-md text-xs text-gray-200 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${FOCUS}`;
const INPUT =
  'w-full min-w-0 px-2.5 py-1.5 bg-gray-950 border border-gray-700 rounded-md text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const HOME = /^\/(?:Users|home)\/[^/]+/;
const shortPath = (p: string) => p.replace(HOME, '~');

interface Props {
  /** Project to scroll to and highlight (rail group menu "Project settings…") */
  focusProjectId?: string | null;
  /** Changes when the scan directories change: the list is re-read */
  refreshKey?: string;
  /** After every change: the app re-reads its projects, so the rail regroups live */
  onChange: () => void;
}

/**
 * Project configuration: the detected git repositories plus own projects; rename, disable,
 * merge into another project, add and delete own ones. Overrides live in settings.json.
 */
export const ProjectsSettings: React.FC<Props> = ({ focusProjectId, refreshKey, onChange }) => {
  const [projects, setProjects] = useState<ProjectEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openSections, setOpenSections] = useState<Set<'disabled' | 'merged'>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [merging, setMerging] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ label: string; run: () => Promise<unknown> } | null>(null);
  const [adding, setAdding] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setProjects(await fetchProjects());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load projects');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // The undo offer fades after a while; the Disabled / Merged sections keep the way back
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 10_000);
    return () => clearTimeout(timer);
  }, [undo]);

  /** Run a change, re-read the list and let the app regroup; errors stay visible with the row */
  const act = useCallback(
    async (
      key: string,
      change: () => Promise<unknown>,
      undoOffer?: { label: string; run: () => Promise<unknown> }
    ) => {
      setBusy(key);
      setActionError(null);
      try {
        await change();
        setUndo(undoOffer ?? null);
        await load();
        onChange();
        return true;
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'The change failed. Try again.');
        return false;
      } finally {
        setBusy(null);
      }
    },
    [load, onChange]
  );

  const byId = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects]);
  const matches = useCallback(
    (p: ProjectEntry) => {
      const q = query.trim().toLowerCase();
      return (
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.detectedName.toLowerCase().includes(q) ||
        p.path.toLowerCase().includes(q)
      );
    },
    [query]
  );
  const sorted = useMemo(
    () => [...(projects ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [projects]
  );
  const active = sorted.filter((p) => p.state === 'active');
  const disabled = sorted.filter((p) => p.state === 'disabled');
  const merged = sorted.filter((p) => p.state === 'merged');
  const mergedInto = useMemo(() => {
    const map = new Map<string, ProjectEntry[]>();
    for (const p of merged) map.set(p.mergedInto!, [...(map.get(p.mergedInto!) ?? []), p]);
    return map;
  }, [merged]);

  // Rail "Project settings…": open the project's section, scroll to it and mark it briefly
  useEffect(() => {
    if (!focusProjectId || !projects) return;
    const target = byId.get(focusProjectId);
    if (!target) return;
    setQuery('');
    if (target.state !== 'active')
      setOpenSections((s) => new Set(s).add(target.state as 'disabled' | 'merged'));
    setHighlight(focusProjectId);
    const frame = requestAnimationFrame(() =>
      listRef.current
        ?.querySelector(`[data-project-id="${window.CSS.escape(focusProjectId)}"]`)
        ?.scrollIntoView({ block: 'center' })
    );
    const timer = setTimeout(() => setHighlight(null), 2500);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
    // Only when asked for a project or once the list is there, not on every reload
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusProjectId, projects === null]);

  const toggleSection = (key: 'disabled' | 'merged') =>
    setOpenSections((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const rename = async (p: ProjectEntry, raw: string) => {
    const name = raw.trim();
    setRenaming(null);
    if (name === p.name || (!name && p.source === 'custom')) return;
    await act(`rename:${p.id}`, () =>
      p.source === 'custom'
        ? updateCustomProject(p.id, { name })
        : renameDetectedProject(p.id, name === p.detectedName ? '' : name)
    );
  };

  const merge = async (p: ProjectEntry, target: ProjectEntry) => {
    setMerging(null);
    await act(`merge:${p.id}`, () => mergeProject(p.id, target.id), {
      label: `Merged “${p.name}” into “${target.name}”.`,
      run: () => mergeProject(p.id, null),
    });
  };

  const counts = (p: ProjectEntry) => {
    const members = [p, ...(mergedInto.get(p.id) ?? [])];
    const worktrees = members.reduce((n, m) => n + m.worktrees.length, 0);
    const known = members.every((m) => m.sessionCount !== null);
    const sessions = members.reduce((n, m) => n + (m.sessionCount ?? 0), 0);
    return { worktrees, sessions: known ? sessions : null };
  };

  const rowClass = (id: string) =>
    `rounded-lg border px-3 py-2 transition-colors ${
      highlight === id ? 'border-blue-500 bg-blue-500/10' : 'border-gray-700 bg-gray-900'
    }`;

  const renderActive = (p: ProjectEntry) => {
    const { worktrees, sessions } = counts(p);
    const members = mergedInto.get(p.id) ?? [];
    const rowBusy = busy?.endsWith(`:${p.id}`);
    return (
      <li key={p.id} data-project-id={p.id} className={`group ${rowClass(p.id)}`}>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              {renaming === p.id ? (
                <RenameInput
                  project={p}
                  onDone={(v) => rename(p, v)}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <span className="text-sm text-gray-100 truncate" title={p.name}>
                  {p.name}
                </span>
              )}
              {p.source === 'custom' && <Badge>Own</Badge>}
              {p.source === 'detected' && p.userNamed && renaming !== p.id && (
                <span className="text-[11px] text-gray-500 truncate" title="Detected name">
                  was {p.detectedName}
                </span>
              )}
              {rowBusy && <RefreshCw size={12} className="animate-spin text-blue-400 shrink-0" />}
            </div>
            <div className="flex items-center gap-x-2 text-xs text-gray-500 min-w-0">
              <span className="font-mono truncate min-w-0" title={p.paths.join('\n')}>
                {shortPath(p.path)}
                {p.paths.length > 1 && ` +${p.paths.length - 1}`}
              </span>
              {worktrees > 0 && <span className="shrink-0">· {plural(worktrees, 'worktree')}</span>}
              {sessions !== null && sessions > 0 && (
                <span className="shrink-0">· {plural(sessions, 'agent')}</span>
              )}
            </div>
            {members.length > 0 && (
              <div className="text-xs text-gray-500 truncate">
                Includes {members.map((m) => m.name).join(', ')}
              </div>
            )}
          </div>
          {confirmDelete === p.id ? (
            <div
              className="flex items-center gap-1.5 shrink-0"
              role="group"
              aria-label="Confirm delete"
            >
              <span className="text-xs text-gray-300">Delete this project?</span>
              <button
                autoFocus
                onClick={() => {
                  setConfirmDelete(null);
                  act(`delete:${p.id}`, () => deleteCustomProject(p.id));
                }}
                className={`px-2.5 py-1 rounded-md text-xs text-white bg-red-600 hover:bg-red-500 ${FOCUS}`}
              >
                Delete
              </button>
              <button onClick={() => setConfirmDelete(null)} className={TEXT_BUTTON}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-0.5 shrink-0 opacity-70 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
              <button
                onClick={() => setRenaming(p.id)}
                disabled={!!busy}
                className={ICON_BUTTON}
                title="Rename"
                aria-label={`Rename ${p.name}`}
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => setMerging(merging === p.id ? null : p.id)}
                disabled={!!busy || active.length < 2}
                className={`${ICON_BUTTON} ${merging === p.id ? 'text-white bg-gray-700' : ''}`}
                title="Merge into another project"
                aria-label={`Merge ${p.name} into another project`}
                aria-expanded={merging === p.id}
              >
                <GitMerge size={14} />
              </button>
              {p.source === 'custom' ? (
                <button
                  onClick={() => setConfirmDelete(p.id)}
                  disabled={!!busy}
                  className={`${ICON_BUTTON} hover:text-red-400 hover:bg-red-500/10`}
                  title="Delete own project"
                  aria-label={`Delete ${p.name}`}
                >
                  <Trash2 size={14} />
                </button>
              ) : (
                <button
                  onClick={() =>
                    act(`disable:${p.id}`, () => setProjectDisabled(p.id, true), {
                      label: `Disabled “${p.name}”.`,
                      run: () => setProjectDisabled(p.id, false),
                    })
                  }
                  disabled={!!busy}
                  className={ICON_BUTTON}
                  title="Disable: hide from the rail, palette and contexts"
                  aria-label={`Disable ${p.name}`}
                >
                  <EyeOff size={14} />
                </button>
              )}
            </div>
          )}
        </div>
        {merging === p.id && (
          <MergePicker
            source={p}
            targets={active.filter((t) => t.id !== p.id)}
            onPick={(t) => merge(p, t)}
            onCancel={() => setMerging(null)}
          />
        )}
      </li>
    );
  };

  const visibleActive = active.filter(matches);
  const visibleDisabled = disabled.filter(matches);
  const visibleMerged = merged.filter(matches);

  return (
    <section aria-labelledby="admin-projects-title" ref={listRef}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="admin-projects-title" className="text-sm font-medium text-gray-200">
            Projects
          </h3>
          <p className="text-xs text-gray-400 mt-1">
            Git repositories found in the project directories. Worktrees belong to their main
            repository, and folders without git are not projects. Agents outside every project are
            listed under “No project”.
          </p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          aria-expanded={adding}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-500 transition-colors ${FOCUS}`}
        >
          <Plus size={15} />
          Add project
        </button>
      </div>

      {adding && (
        <AddProjectForm
          onCancel={() => setAdding(false)}
          onAdd={async (input) => {
            await createCustomProject(input);
            setAdding(false);
            await load();
            onChange();
          }}
        />
      )}

      {undo && (
        <div
          role="status"
          className="mt-3 flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-sm text-gray-200"
        >
          <Check size={15} className="text-green-400 shrink-0" />
          <span className="flex-1 min-w-0 truncate">{undo.label}</span>
          <button
            onClick={() => act('undo', undo.run)}
            disabled={!!busy}
            className={`flex items-center gap-1 ${TEXT_BUTTON}`}
          >
            <Undo2 size={13} />
            Undo
          </button>
          <button onClick={() => setUndo(null)} className={ICON_BUTTON} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-300 text-sm"
        >
          <span className="flex-1">{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className={ICON_BUTTON}
            aria-label="Dismiss error"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {loadError && !projects ? (
        <div className="mt-3 flex items-center gap-3 p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-300">
          <span className="flex-1">Couldn't load the projects: {loadError}</span>
          <button onClick={load} className={TEXT_BUTTON}>
            Retry
          </button>
        </div>
      ) : !projects ? (
        <div className="flex items-center justify-center py-8" aria-label="Loading projects">
          <RefreshCw className="animate-spin text-blue-500" size={22} />
        </div>
      ) : (
        <>
          <div className="relative mt-3">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Filter ${plural(projects.length, 'project')} by name or path…`}
              aria-label="Filter projects"
              className={`${INPUT} pl-8`}
            />
          </div>

          {active.length === 0 ? (
            <p className="text-sm text-gray-400 py-4">
              No git repositories in the project directories. Add a directory above, or add a
              project.
            </p>
          ) : visibleActive.length === 0 ? (
            <p className="text-sm text-gray-400 py-3">No active project matches “{query}”.</p>
          ) : (
            <ul
              className="mt-2 space-y-1.5 max-h-[22rem] overflow-y-auto pr-1"
              aria-label="Active projects"
            >
              {visibleActive.map(renderActive)}
            </ul>
          )}

          <CollapsedSection
            title="Disabled"
            hint="Hidden from the rail, the palette and the context pickers."
            count={disabled.length}
            open={openSections.has('disabled') || (!!query.trim() && visibleDisabled.length > 0)}
            onToggle={() => toggleSection('disabled')}
          >
            {visibleDisabled.map((p) => (
              <li
                key={p.id}
                data-project-id={p.id}
                className={`flex items-center gap-2 ${rowClass(p.id)}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-300 truncate">{p.name}</div>
                  <div className="text-xs text-gray-500 font-mono truncate">
                    {shortPath(p.path)}
                  </div>
                </div>
                <button
                  onClick={() => act(`enable:${p.id}`, () => setProjectDisabled(p.id, false))}
                  disabled={!!busy}
                  className={`flex items-center gap-1 ${TEXT_BUTTON}`}
                  aria-label={`Enable ${p.name}`}
                >
                  <Eye size={13} />
                  Enable
                </button>
              </li>
            ))}
          </CollapsedSection>

          <CollapsedSection
            title="Merged"
            hint="Their agents, worktrees and context memberships belong to the target project."
            count={merged.length}
            open={openSections.has('merged') || (!!query.trim() && visibleMerged.length > 0)}
            onToggle={() => toggleSection('merged')}
          >
            {visibleMerged.map((p) => {
              const target = byId.get(p.mergedInto!);
              return (
                <li
                  key={p.id}
                  data-project-id={p.id}
                  className={`flex items-center gap-2 ${rowClass(p.id)}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-300 truncate">
                      {p.name}
                      <span className="text-gray-500"> → {target?.name ?? 'unknown project'}</span>
                    </div>
                    <div className="text-xs text-gray-500 font-mono truncate">
                      {shortPath(p.path)}
                    </div>
                  </div>
                  <button
                    onClick={() => act(`unmerge:${p.id}`, () => mergeProject(p.id, null))}
                    disabled={!!busy}
                    className={`flex items-center gap-1 ${TEXT_BUTTON}`}
                    aria-label={`Undo merge of ${p.name}`}
                  >
                    <Undo2 size={13} />
                    Unmerge
                  </button>
                </li>
              );
            })}
          </CollapsedSection>
        </>
      )}
    </section>
  );
};

const Badge: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="shrink-0 px-1.5 py-px rounded border border-blue-500/40 text-[10px] uppercase tracking-wide text-blue-300">
    {children}
  </span>
);

const RenameInput: React.FC<{
  project: ProjectEntry;
  onDone: (value: string) => void;
  onCancel: () => void;
}> = ({ project, onDone, onCancel }) => {
  const [value, setValue] = useState(project.name);
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    if (v === null) onCancel();
    else onDone(v);
  };
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value);
        if (e.key === 'Escape') {
          e.stopPropagation();
          finish(null);
        }
      }}
      onBlur={() => finish(value)}
      maxLength={100}
      placeholder={project.source === 'detected' ? project.detectedName : 'Project name'}
      title={
        project.source === 'detected'
          ? `Enter saves, Esc cancels; empty restores “${project.detectedName}”`
          : 'Enter saves, Esc cancels'
      }
      aria-label={`New name for ${project.name}`}
      className={`${INPUT} py-0.5`}
    />
  );
};

const MergePicker: React.FC<{
  source: ProjectEntry;
  targets: ProjectEntry[];
  onPick: (target: ProjectEntry) => void;
  onCancel: () => void;
}> = ({ source, targets, onPick, onCancel }) => {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const options = targets.filter((t) => {
    const q = query.trim().toLowerCase();
    return !q || t.name.toLowerCase().includes(q) || t.path.toLowerCase().includes(q);
  });
  const pick = options[Math.min(index, options.length - 1)];
  const listId = `merge-targets-${source.id}`;
  return (
    <div className="mt-2 pt-2 border-t border-gray-800">
      <label htmlFor={`${listId}-input`} className="block text-xs text-gray-400 mb-1.5">
        Merge “{source.name}” into another project. Its agents, worktrees and context memberships
        then belong to that project; undo it any time under Merged.
      </label>
      <input
        id={`${listId}-input`}
        autoFocus
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-activedescendant={pick ? `${listId}-${pick.id}` : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIndex((i) => Math.min(i + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && pick) {
            onPick(pick);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          }
        }}
        placeholder="Target project…"
        className={INPUT}
      />
      <ul id={listId} role="listbox" className="mt-1 max-h-40 overflow-y-auto">
        {options.map((t) => (
          <li
            key={t.id}
            id={`${listId}-${t.id}`}
            role="option"
            aria-selected={t === pick}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(t)}
            className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-sm ${
              t === pick ? 'bg-blue-500/15 text-white' : 'text-gray-200 hover:bg-gray-800'
            }`}
          >
            <span className="truncate">{t.name}</span>
            <span className="ml-auto text-xs text-gray-500 font-mono truncate">
              {shortPath(t.path)}
            </span>
          </li>
        ))}
        {options.length === 0 && <li className="px-2 py-1 text-sm text-gray-500">No match.</li>}
      </ul>
      <div className="mt-1.5 flex justify-end">
        <button onClick={onCancel} className={TEXT_BUTTON}>
          Cancel
        </button>
      </div>
    </div>
  );
};

const CollapsedSection: React.FC<{
  title: string;
  hint: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ title, hint, count, open, onToggle, children }) => {
  if (count === 0) return null;
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <div className="mt-3">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className={`flex items-center gap-1.5 text-xs font-medium text-gray-300 hover:text-white rounded ${FOCUS}`}
      >
        <Icon size={14} />
        {title} ({count})
      </button>
      {open && (
        <>
          <p className="text-xs text-gray-400 mt-1 ml-5">{hint}</p>
          <ul className="mt-1.5 space-y-1.5">{children}</ul>
        </>
      )}
    </div>
  );
};

const AddProjectForm: React.FC<{
  onAdd: (input: { name?: string; paths: string[] }) => Promise<void>;
  onCancel: () => void;
}> = ({ onAdd, onCancel }) => {
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canBrowse = typeof window !== 'undefined' && !!window.electronAPI?.showOpenDialog;

  const submit = async () => {
    if (!path.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onAdd({ paths: [path.trim()], ...(name.trim() ? { name: name.trim() } : {}) });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Adding the project failed. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const browse = async () => {
    const result = await window.electronAPI!.showOpenDialog({
      title: 'Select the git repository',
      properties: ['openDirectory'],
      buttonLabel: 'Select',
    });
    if (result.success && !result.canceled && result.filePaths?.length)
      setPath(result.filePaths[0]);
  };

  return (
    <form
      className="mt-3 p-3 rounded-lg border border-gray-700 bg-gray-900 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="flex items-center gap-2 text-sm text-gray-200">
        <FolderGit2 size={15} className="text-blue-400" />
        Add a project
      </div>
      <label htmlFor="project-add-path" className="block text-xs text-gray-400">
        Folder of a git repository (the one that contains .git)
      </label>
      <div className="flex gap-2">
        <input
          id="project-add-path"
          autoFocus
          value={path}
          onChange={(e) => {
            setPath(e.target.value);
            setError(null);
          }}
          placeholder="/Users/you/PROJECTS/my-repo"
          aria-invalid={!!error}
          aria-describedby={error ? 'project-add-error' : undefined}
          className={`${error ? INPUT.replace('border-gray-700', 'border-red-500/70') : INPUT} font-mono`}
        />
        {canBrowse && (
          <button
            type="button"
            onClick={browse}
            className={`shrink-0 px-2.5 rounded-md bg-gray-700 text-gray-200 hover:bg-gray-600 ${FOCUS}`}
            title="Browse for the folder"
            aria-label="Browse for the folder"
          >
            <FolderOpen size={15} />
          </button>
        )}
      </div>
      <label htmlFor="project-add-name" className="block text-xs text-gray-400">
        Name (optional, defaults to the folder name)
      </label>
      <input
        id="project-add-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={100}
        className={INPUT}
      />
      {error && (
        <p id="project-add-error" role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className={TEXT_BUTTON}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={!path.trim() || saving}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS}`}
        >
          {saving ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
          {saving ? 'Checking…' : 'Add project'}
        </button>
      </div>
    </form>
  );
};
