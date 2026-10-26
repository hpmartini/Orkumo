import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Code2, ShieldAlert } from 'lucide-react';
import type { AgentRepo, AppConfig } from '../../types';
import { checkCodeFolder, fetchAgentRepos } from '../../services/agentsApi';
import { codeFolders, codeUrl } from '../../utils/codeTarget';
import { WebIDEPanel } from '../CodingView/WebIDEPanel';
import { WebIDEErrorBoundary } from '../CodingView/WebIDEErrorBoundary';

interface CodeViewProps {
  /** Whether the view is visible (drives loading and URL state) */
  active: boolean;
  apps: AppConfig[];
}

type FolderState =
  | { kind: 'none' }
  | { kind: 'checking'; path: string }
  | { kind: 'ok'; path: string }
  | { kind: 'error'; path: string; message: string };

/** Code mode (`/code?path=<abs>`): the Web-IDE for any project, repo or agent worktree */
export const CodeView: React.FC<CodeViewProps> = ({ active, apps }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requested = active ? searchParams.get('path') : null;
  const [repos, setRepos] = useState<AgentRepo[]>([]);
  const [folder, setFolder] = useState<FolderState>({ kind: 'none' });

  useEffect(() => {
    if (!active) return;
    fetchAgentRepos()
      .then((data) => setRepos(data.repos))
      .catch(() => {});
  }, [active]);

  // Leaving the route keeps the last folder so the iframe survives a round trip
  const lastRequested = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    lastRequested.current = null;
    setAttempt((n) => n + 1);
  };
  useEffect(() => {
    if (!requested || requested === lastRequested.current) return;
    lastRequested.current = requested;
    // A newer request wins; a ref instead of effect cleanup survives StrictMode's re-run
    const current = () => lastRequested.current === requested;
    setFolder({ kind: 'checking', path: requested });
    checkCodeFolder(requested)
      .then((path) => current() && setFolder({ kind: 'ok', path }))
      .catch(
        (err: Error) =>
          current() && setFolder({ kind: 'error', path: requested, message: err.message })
      );
  }, [requested, attempt]);

  const folders = useMemo(() => codeFolders(apps, repos), [apps, repos]);
  // The server answers with the real path; the picker may list the symlinked spelling
  const current = [folder.kind === 'none' ? '' : folder.path, requested ?? ''].find((p) =>
    folders.some((f) => f.path === p)
  );
  const groups = ['Projects', 'Worktrees & agents'] as const;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-950">
      <div className="flex items-center gap-2 px-3 h-11 border-b border-gray-800 shrink-0">
        <Code2 size={16} className="text-blue-400 shrink-0" />
        <span className="text-sm font-semibold text-gray-200">Code</span>
        <select
          aria-label="Folder"
          value={current ?? ''}
          onChange={(e) => e.target.value && navigate(codeUrl(e.target.value))}
          className="ml-2 min-w-0 max-w-sm bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
        >
          <option value="">Choose a project or worktree…</option>
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {folders
                .filter((f) => f.group === group)
                .map((f) => (
                  <option key={f.path} value={f.path} title={f.path}>
                    {f.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        {folder.kind !== 'none' && (
          <span className="min-w-0 truncate font-mono text-xs text-gray-400" title={folder.path}>
            {folder.path}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {folder.kind === 'none' && (
          <p className="m-auto text-sm text-gray-400">
            Choose a folder, or jump here from an agent, issue or pull request.
          </p>
        )}
        {folder.kind === 'checking' && (
          <p className="m-auto text-sm text-gray-400">Checking {folder.path}…</p>
        )}
        {folder.kind === 'error' && (
          <div role="alert" className="m-auto max-w-md text-center text-sm text-red-300 space-y-2">
            <ShieldAlert size={24} className="mx-auto" />
            <p>Cannot open {folder.path}</p>
            <p className="text-gray-400">{folder.message}</p>
            <button
              onClick={retry}
              className="px-3 py-1 rounded text-gray-200 hover:text-white hover:bg-gray-800"
            >
              Retry
            </button>
          </div>
        )}
        {folder.kind === 'ok' && (
          <WebIDEErrorBoundary>
            <WebIDEPanel key={folder.path} directory={folder.path} />
          </WebIDEErrorBoundary>
        )}
      </div>
    </div>
  );
};
