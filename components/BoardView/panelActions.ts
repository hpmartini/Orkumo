import toast from 'react-hot-toast';
import type { NavigateFunction } from 'react-router-dom';
import type { AgentSession, BoardItem } from '../../types';
import { fetchRepoPath } from '../../services/boardApi';
import { fetchAgentContexts } from '../../services/agentsApi';
import { codeUrl, linkedAgentFolder } from '../../utils/codeTarget';

/** Links carry the job id or the first 8 chars of the session UUID (mw-board) */
export const sessionsByLinkId = (sessions: AgentSession[]) =>
  new Map<string, AgentSession>(
    sessions.flatMap((s) => [
      ...(s.sessionId ? [[s.sessionId.slice(0, 8), s] as const] : []),
      [s.id, s] as const,
    ])
  );

/** Opens the agent task composer prefilled with the issue, in its local checkout if known */
export async function startAgentOn(navigate: NavigateFunction, it: BoardItem) {
  // No local checkout found (or lookup failed): composer keeps its own directory
  const cwd = it.repo ? await fetchRepoPath(it.repo).catch(() => null) : null;
  navigate('/agents', { state: { dispatch: `Bearbeite ${it.url} `, cwd } });
}

/** Code mode in the folder of the first linked agent, else the repo's local checkout */
export async function openCodeFor(
  navigate: NavigateFunction,
  jobIds: string[],
  sessionsById: Map<string, AgentSession>,
  repo: string | null
) {
  // An agent's cwd can be the main checkout while it works in a worktree
  const contexts = jobIds.length ? await fetchAgentContexts().catch(() => ({})) : {};
  const folder =
    linkedAgentFolder(jobIds, sessionsById, contexts) ??
    (repo ? await fetchRepoPath(repo).catch(() => null) : null);
  if (folder) navigate(codeUrl(folder));
  else toast.error(`Kein lokaler Checkout von ${repo ?? 'diesem Issue'} gefunden`);
}
