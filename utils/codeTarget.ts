/**
 * Code mode: which folder a context (agent, issue, PR) opens in the Web-IDE.
 */
import type { AgentContext, AgentRepo, AgentSession } from '../types';

/** Route of the Code mode for `path` */
export const codeUrl = (path: string) => `/code?path=${encodeURIComponent(path)}`;

/** Board filtered to a repo ("owner/name") and, optionally, to the issues of one agent */
export const boardUrl = (repo: string, agentId?: string) =>
  `/board?${new URLSearchParams(agentId ? { repo, agent: agentId } : { repo })}`;

/** An agent works in its worktree; its cwd is the worktree (or a folder in it) otherwise */
export function agentFolder(
  session: Pick<AgentSession, 'cwd'> | undefined,
  ctx?: AgentContext | null
): string | null {
  return ctx?.repo?.worktreePath || session?.cwd || null;
}

/** Folder of the first linked agent that is still known; null sends the caller to its fallback */
export function linkedAgentFolder(
  jobIds: string[],
  sessionsById: Map<string, Pick<AgentSession, 'cwd'>>,
  contexts: Record<string, AgentContext> = {}
): string | null {
  for (const id of jobIds) {
    const folder = agentFolder(sessionsById.get(id), contexts[id]);
    if (folder) return folder;
  }
  return null;
}

export interface CodeFolder {
  name: string;
  path: string;
  group: 'Projects' | 'Worktrees & agents';
}

/** Folder picker entries: scanned projects first, then repos/worktrees/agent dirs; one per path */
export function codeFolders(
  apps: { name: string; path: string; isArchived?: boolean }[],
  repos: Pick<AgentRepo, 'name' | 'path'>[]
): CodeFolder[] {
  const seen = new Map<string, CodeFolder>();
  for (const app of apps) {
    if (!app.isArchived && !seen.has(app.path))
      seen.set(app.path, { name: app.name, path: app.path, group: 'Projects' });
  }
  for (const repo of repos) {
    if (!seen.has(repo.path))
      seen.set(repo.path, { name: repo.name, path: repo.path, group: 'Worktrees & agents' });
  }
  return [...seen.values()].sort(
    (a, b) =>
      Number(a.group !== 'Projects') - Number(b.group !== 'Projects') ||
      a.name.localeCompare(b.name)
  );
}
