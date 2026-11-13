/** Minimal app shape the agents view needs (name + path) to offer dispatch directories. */
export interface AgentConfigLike {
  id: string;
  name: string;
  path: string;
  port?: number;
  addresses?: string[];
  status?: string;
  isFavorite?: boolean;
  /** Project fields for the rail's Project grouping (see ProjectApp in utils/agentSessions.ts) */
  paths?: string[];
  worktrees?: string[];
  mergedIds?: string[];
  userNamed?: boolean;
}
