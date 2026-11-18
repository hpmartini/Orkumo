/**
 * Orkumo's transport for the agents view of `@hpmartini/agents-ui`: the API clients in
 * `agentsApi` / `orchestratorApi`, grouped by capability, plus the PTY WebSocket and the local
 * file / Ghostty endpoints. Orkumo has every capability.
 */
import type { AgentsTransport, OpenFileOptions } from '@hpmartini/agents-ui';
import { ATTACHMENT_EXTENSIONS } from '../config/limits.js';
import { API_BASE_URL, getWsUrl } from '../utils/apiConfig';
import {
  agentWsUrl,
  getAgentTarget,
  pinTarget,
  targetOf,
  useAgentTarget,
} from '../utils/agentTarget';
import type { AgentSession } from '@hpmartini/agents-ui/types';
import * as api from './agentsApi';
import {
  fetchOrchestratorRoles,
  fetchOrchestratorWorkspace,
  startOrchestrator,
} from './orchestratorApi';

/**
 * PTY WebSocket URL for `claude attach <id>` (or a harness started with `cliArgs`), on the
 * instance the session runs on (#220)
 */
export function buildAttachUrl(
  sessionId: string,
  cwd: string,
  cols: number,
  rows: number,
  cliArgs: string[] = ['attach', sessionId],
  command: NonNullable<AgentSession['ptyCommand']> = 'claude'
): string {
  const ptySession = `agent-${sessionId}-${Date.now()}`;
  const args = encodeURIComponent(JSON.stringify(cliArgs));
  return `${agentWsUrl(sessionId)}?sessionId=${ptySession}&cwd=${encodeURIComponent(cwd)}&cols=${cols}&rows=${rows}&command=${command}&args=${args}`;
}

/** PTY WebSocket URL for a plain shell in `cwd` (#207): no command, so the server starts its default shell */
export function buildShellUrl(cwd: string, cols: number, rows: number): string {
  return `${getWsUrl('/api/pty')}?sessionId=shell-${Date.now()}-${Math.random().toString(36).slice(2)}&cwd=${encodeURIComponent(cwd)}&cols=${cols}&rows=${rows}`;
}

/** POST a local (never agent-targeted) endpoint; throws the server's `error` text */
async function postLocal(path: string, body: unknown): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || res.statusText);
  return data;
}

export const orkumoTransport: AgentsTransport = {
  agents: {
    fetchAgents: api.fetchAgents,
    subscribeToAgents: api.subscribeToAgents,
    dispatchAgent: api.dispatchAgent,
    stopAgent: api.stopAgent,
  },
  settings: {
    fetchAgentViewSettings: api.fetchAgentViewSettings,
    updateAgentViewSettings: api.updateAgentViewSettings,
  },
  pty: {
    attach: ({ id, cwd, cols, rows }) => new WebSocket(buildAttachUrl(id, cwd, cols, rows)),
    // Client-side sessions (harness starts, --session-id/--resume/--continue/--cloud)
    spawn: ({ id, cwd, cols, rows, command, args }) =>
      new WebSocket(buildAttachUrl(id, cwd, cols, rows, args, command)),
    shell: ({ cwd, cols, rows }) => new WebSocket(buildShellUrl(cwd, cols, rows)),
  },
  manage: {
    renameAgent: api.renameAgent,
    pinAgent: api.pinAgent,
    reorderAgents: api.reorderAgents,
    removeAgent: api.removeAgent,
    respawnAgent: api.respawnAgent,
    fetchAgentsRawJson: api.fetchAgentsRawJson,
  },
  daemon: {
    respawnAllAgents: api.respawnAllAgents,
    stopAgentDaemon: api.stopAgentDaemon,
  },
  messaging: {
    replyToAgent: api.replyToAgent,
    sendToPane: api.sendToPane,
    stopPane: api.stopPane,
  },
  contexts: { fetchAgentContexts: api.fetchAgentContexts },
  discovery: {
    fetchAgentRepos: api.fetchAgentRepos,
    fetchSubagents: api.fetchSubagents,
    fetchAgentCommands: api.fetchAgentCommands,
    fetchHarnesses: api.fetchHarnesses,
    fetchHarnessModels: api.fetchHarnessModels,
  },
  history: { fetchPastSessions: api.fetchPastSessions },
  cloud: { openCloudSession: api.openCloudSession },
  logs: { fetchAgentLogs: api.fetchAgentLogs },
  uploads: {
    uploadAttachment: api.uploadAttachment,
    agentImageUrl: api.agentImageUrl,
    attachmentExtensions: ATTACHMENT_EXTENSIONS,
  },
  chat: {
    openTranscriptView: api.openTranscriptView,
    subscribeToChat: api.subscribeToChat,
    fetchChatHistory: api.fetchChatHistory,
    fetchChatStatus: api.fetchChatStatus,
    fetchChatFiles: api.fetchChatFiles,
    fetchChatDirs: api.fetchChatDirs,
    fetchChatShell: api.fetchChatShell,
    chatImageUrl: api.chatImageUrl,
  },
  artifacts: {
    fetchChatArtifacts: api.fetchChatArtifacts,
    fetchChatArtifactContent: api.fetchChatArtifactContent,
  },
  servers: {
    fetchOrphanServers: api.fetchOrphanServers,
    stopOrphanServer: api.stopOrphanServer,
    fetchServerStats: api.fetchServerStats,
  },
  orchestrator: { fetchOrchestratorRoles, fetchOrchestratorWorkspace, startOrchestrator },
  files: {
    // VS Code via /files/open-in-editor, the default app or Finder via /files/open (#188)
    openFile: async (path: string, cwd: string, options: OpenFileOptions = {}) => {
      const { editor = false, reveal = false, line, col } = options;
      const body = await postLocal(
        `/files/${editor ? 'open-in-editor' : 'open'}`,
        editor ? { path, cwd, line, col } : reveal ? { path, cwd, reveal } : { path, cwd }
      );
      return { action: typeof body?.action === 'string' ? body.action : undefined };
    },
  },
  ghostty: {
    openInGhostty: async (request) => {
      await postLocal('/terminal/ghostty/open', request);
    },
  },
  targets: { useAgentTarget, getAgentTarget, targetOf, pinTarget },
};
