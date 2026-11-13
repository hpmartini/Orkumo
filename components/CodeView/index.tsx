import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Code2, Loader2, ShieldAlert } from 'lucide-react';
import type { AgentRepo, AppConfig } from '../../types';
import { checkCodeFolder, fetchAgentRepos } from '../../services/agentsApi';
import { codeTargets, codeUrl, findCodeTarget } from '../../utils/codeTarget';
import { FolderPicker, rememberCodeFolder } from './FolderPicker';
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
  const [home, setHome] = useState<string | null>(null);
  const [folder, setFolder] = useState<FolderState>({ kind: 'none' });

  useEffect(() => {
    if (!active) return;
    fetchAgentRepos()
      .then((data) => {
        setRepos(data.repos);
        setHome(data.home ?? null);
      })
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
      .then((path) => {
        if (!current()) return;
        setFolder({ kind: 'ok', path });
        // Jumps from agents, issues and PRs count as recent too, not only picks
        rememberCodeFolder(requested);
      })
      .catch(
        (err: Error) =>
          current() && setFolder({ kind: 'error', path: requested, message: err.message })
      );
  }, [requested, attempt]);

  const groups = useMemo(() => codeTargets(apps, repos, home), [apps, repos, home]);
  // The server answers with the real path; the picker may list the symlinked spelling
  const folderPath = folder.kind === 'none' ? null : folder.path;
  const current =
    [folderPath, requested].find((p) => findCodeTarget(groups, p)) ?? requested ?? folderPath;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-950">
      <div className="flex items-center gap-2 px-3 h-11 border-b border-gray-800 shrink-0">
        <Code2 size={16} className="text-blue-400 shrink-0" />
        <span className="text-sm font-semibold text-gray-200 mr-1">Code</span>
        <FolderPicker
          groups={groups}
          current={current}
          active={active}
          onPick={(path) => navigate(codeUrl(path))}
        />
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {folder.kind === 'none' && (
          <p className="m-auto text-sm text-gray-400">
            Open a project above, or jump here from an agent, issue or pull request.
          </p>
        )}
        {folder.kind === 'checking' && (
          <p role="status" className="m-auto flex items-center gap-2 text-sm text-gray-400">
            <Loader2 size={16} className="motion-safe:animate-spin text-blue-500" />
            Opening {folder.path}…
          </p>
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
