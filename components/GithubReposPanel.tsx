import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  CloudDownload,
  Eye,
  EyeOff,
  GitFork,
  Github,
  Lock,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { Choice } from '@hpmartini/agents-ui/components/Choice';
import { cloneGithubRepo, fetchGithubRepos, type GithubRepo } from '../services/api';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-1';
const ROW_BUTTON = `flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${FOCUS}`;
const HOME = /^\/(?:Users|home)\/[^/]+/;

interface Props {
  /** Enable / disable a local project through the settings' shared action (undo, reload) */
  onSetDisabled: (projectId: string, name: string, disabled: boolean) => Promise<boolean>;
  /** A clone landed: the project list and the app reload */
  onCloned: () => Promise<void>;
  onClose: () => void;
}

/**
 * The gh user's GitHub repositories: local ones switch between active and disabled, the rest clone
 * with `gh repo clone` into a project directory and become projects right away.
 */
export const GithubReposPanel: React.FC<Props> = ({ onSetDisabled, onCloned, onClose }) => {
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [directories, setDirectories] = useState<string[]>([]);
  const [dir, setDir] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchGithubRepos();
      setRepos(data.repos);
      setDirectories(data.directories);
      setDir((d) => (d && data.directories.includes(d) ? d : (data.directories[0] ?? '')));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Loading the GitHub repositories failed.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patchLocal = (slug: string, local: GithubRepo['local']) =>
    setRepos((list) => list?.map((r) => (r.slug === slug ? { ...r, local } : r)) ?? null);

  const clone = async (repo: GithubRepo) => {
    setBusy(repo.slug);
    setError(null);
    try {
      const { projectId } = await cloneGithubRepo(repo.slug, dir);
      await onCloned();
      // No project for the clone (e.g. beyond the scan depth): show what the server sees
      if (projectId)
        patchLocal(repo.slug, { projectId, name: repo.slug.split('/')[1], state: 'active' });
      else await load();
    } catch (err) {
      setError(`Cloning ${repo.slug} failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (repo: GithubRepo) => {
    const local = repo.local!;
    const disable = local.state === 'active';
    setBusy(repo.slug);
    if (await onSetDisabled(local.projectId, local.name, disable))
      patchLocal(repo.slug, { ...local, state: disable ? 'disabled' : 'active' });
    setBusy(null);
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (repos ?? []).filter(
      (r) =>
        (showArchived || !r.archived || r.local) &&
        (!q || r.slug.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q))
    );
  }, [repos, query, showArchived]);
  const archivedCount = repos?.filter((r) => r.archived && !r.local).length ?? 0;

  return (
    <div
      className="mt-3 p-3 rounded-lg border border-gray-700 bg-gray-900 space-y-2"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-2 text-sm text-gray-200">
        <Github size={15} className="text-blue-400" />
        <span className="flex-1">GitHub repositories</span>
        <button
          onClick={load}
          disabled={!repos && !error}
          className={`p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 ${FOCUS}`}
          title="Reload from GitHub"
          aria-label="Reload from GitHub"
        >
          <RefreshCw size={14} className={!repos && !error ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={onClose}
          className={`p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 ${FOCUS}`}
          aria-label="Close GitHub repositories"
        >
          <X size={14} />
        </button>
      </div>
      <p className="text-xs text-gray-400">
        Repositories of your GitHub account (via gh). Local ones switch between active and disabled;
        the others clone into a project directory and appear as a project.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"
          />
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by owner/name or description…"
            aria-label="Filter GitHub repositories"
            className={`w-full pl-8 pr-2.5 py-1.5 rounded-md bg-gray-800 border border-gray-700 text-sm text-gray-100 placeholder:text-gray-500 ${FOCUS}`}
          />
        </div>
        {directories.length > 1 && (
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span aria-hidden>Clone into</span>
            <Choice
              label="Clone into"
              value={dir}
              onChange={setDir}
              options={directories.map((d) => ({ value: d, label: d.replace(HOME, '~') }))}
              className="max-w-[14rem] font-mono"
            />
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}

      {!repos ? (
        !error && (
          <div className="flex items-center gap-2 py-4 text-xs text-gray-400" aria-live="polite">
            <RefreshCw size={14} className="animate-spin text-blue-500" />
            Reading your repositories from GitHub…
          </div>
        )
      ) : (
        <>
          {directories.length === 0 && (
            <p className="text-xs text-amber-300">Add a project directory above to clone into.</p>
          )}
          {visible.length === 0 ? (
            <p className="text-sm text-gray-400 py-3">
              {query.trim() ? `No repository matches “${query}”.` : 'No repositories.'}
            </p>
          ) : (
            <ul
              className="space-y-1 max-h-[22rem] overflow-y-auto pr-1"
              aria-label="GitHub repositories"
            >
              {visible.map((r) => (
                <RepoRow
                  key={r.slug}
                  repo={r}
                  busy={busy === r.slug}
                  locked={!!busy}
                  canClone={!!dir}
                  target={dir ? `${dir.replace(HOME, '~')}/${r.slug.split('/')[1]}` : ''}
                  onClone={() => clone(r)}
                  onToggle={() => toggle(r)}
                />
              ))}
            </ul>
          )}
          {archivedCount > 0 && (
            <button
              onClick={() => setShowArchived((v) => !v)}
              className={`text-xs text-gray-400 hover:text-gray-200 ${FOCUS}`}
            >
              {showArchived ? 'Hide' : 'Show'} {archivedCount} archived on GitHub
            </button>
          )}
        </>
      )}
    </div>
  );
};

const RepoRow: React.FC<{
  repo: GithubRepo;
  busy: boolean;
  locked: boolean;
  canClone: boolean;
  target: string;
  onClone: () => void;
  onToggle: () => void;
}> = ({ repo, busy, locked, canClone, target, onClone, onToggle }) => {
  const { local } = repo;
  const [owner, name] = repo.slug.split('/');
  return (
    <li className="flex items-center gap-2 rounded-md px-2.5 py-1.5 hover:bg-gray-800/70">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 text-sm">
          <span className="text-gray-500 truncate shrink-[2]">{owner}/</span>
          <span className="text-gray-100 truncate">{name}</span>
          {repo.private && (
            <Lock size={11} className="shrink-0 text-gray-500" aria-label="Private" />
          )}
          {repo.fork && <GitFork size={11} className="shrink-0 text-gray-500" aria-label="Fork" />}
          {repo.archived && (
            <Archive size={11} className="shrink-0 text-gray-500" aria-label="Archived on GitHub" />
          )}
        </div>
        {repo.description && (
          <div className="text-xs text-gray-500 truncate" title={repo.description}>
            {repo.description}
          </div>
        )}
      </div>
      {local?.state === 'merged' ? (
        <span className="shrink-0 text-xs text-gray-500">Merged</span>
      ) : local ? (
        <button
          onClick={onToggle}
          disabled={locked}
          aria-pressed={local.state === 'active'}
          className={`${ROW_BUTTON} ${
            local.state === 'active'
              ? 'text-green-300 bg-green-500/10 hover:bg-green-500/20'
              : 'text-gray-400 bg-gray-800 hover:bg-gray-700 hover:text-gray-200'
          }`}
          title={
            local.state === 'active'
              ? 'Active: in the rail, palette, contexts and the Issues list. Click to disable.'
              : 'Disabled: hidden everywhere. Click to enable.'
          }
        >
          {busy ? (
            <RefreshCw size={12} className="animate-spin" />
          ) : local.state === 'active' ? (
            <Eye size={12} />
          ) : (
            <EyeOff size={12} />
          )}
          {local.state === 'active' ? 'Active' : 'Disabled'}
        </button>
      ) : (
        <button
          onClick={onClone}
          disabled={locked || !canClone}
          className={`${ROW_BUTTON} text-gray-200 bg-gray-700 hover:bg-gray-600`}
          title={canClone ? `Clone to ${target}` : 'Add a project directory first'}
          aria-label={`Clone ${repo.slug}`}
        >
          {busy ? <RefreshCw size={12} className="animate-spin" /> : <CloudDownload size={12} />}
          {busy ? 'Cloning…' : 'Clone'}
        </button>
      )}
    </li>
  );
};
