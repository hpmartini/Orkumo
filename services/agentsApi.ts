/**
 * API client for the Claude Code agent view (`/api/agents/*`).
 */
import { API_BASE_URL } from '../utils/apiConfig';
import { agentApiUrl, getAgentTarget, pinTarget, targetOf } from '../utils/agentTarget';
import type {
  AgentsResponse,
  AgentDispatchRequest,
  AgentDispatchResult,
  AgentLogs,
  AgentRemoveResult,
  AgentDaemonStatus,
  AgentSubagent,
  AgentRepo,
  AgentSlashCommand,
  AgentPastSession,
  AgentViewSettings,
  AgentSession,
  AgentNotification,
  AgentContext,
  AgentOrphanServer,
  AgentServerStats,
  AgentCacheInfo,
} from '../types';
import type { UsageLimits } from '../components/UsageView/types';

const API_BASE = API_BASE_URL;

/** `/agents...` goes to the session's instance (#220, utils/agentTarget); everything else stays local */
const apiUrl = (path: string, id?: string) =>
  path.startsWith('/agents') ? agentApiUrl(path, id) : `${API_BASE}${path}`;

/** Remembers the instance of every listed id, so its tab keeps talking there after a switch */
const pinAll = <T extends { id: string }>(items: T[], target: string): T[] => {
  items.forEach((item) => pinTarget(item.id, target));
  return items;
};

/** `id`: session the call is about when the path has none (it then goes to that session's instance) */
async function request<T>(path: string, init?: RequestInit, id?: string): Promise<T> {
  const response = await fetch(apiUrl(path, id), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `${response.status} ${response.statusText}`;
    const error = new Error(message) as Error & { status?: number; payload?: unknown };
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload as T;
}

function query(params: Record<string, string | boolean | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function fetchAgents(
  options: { cwd?: string | null; all?: boolean } = {}
): Promise<AgentsResponse> {
  const target = getAgentTarget();
  return request<AgentsResponse>(`/agents${query({ cwd: options.cwd, all: options.all })}`).then(
    (data) => {
      pinAll(data.sessions ?? [], target);
      return data;
    }
  );
}

export async function fetchAgentsRawJson(
  options: { cwd?: string | null; all?: boolean } = {}
): Promise<string> {
  const response = await fetch(
    `${agentApiUrl('/agents/json')}${query({ cwd: options.cwd, all: options.all })}`
  );
  if (!response.ok) throw new Error('Failed to fetch agents JSON');
  return response.text();
}

export async function fetchAgentContexts(): Promise<Record<string, AgentContext>> {
  const { contexts } = await request<{ contexts: Record<string, AgentContext> }>('/agents/context');
  return contexts;
}

export async function fetchOrphanServers(): Promise<AgentOrphanServer[]> {
  return (await request<{ servers: AgentOrphanServer[] }>('/agents/servers/orphans')).servers;
}

export function stopOrphanServer(pid: number): Promise<{ stopped: number }> {
  return request(`/agents/servers/${pid}/stop`, { method: 'POST' });
}

/** CPU/memory per server pid; pids that vanished are missing from the result. */
export async function fetchServerStats(
  pids: number[],
  signal?: AbortSignal
): Promise<AgentServerStats[]> {
  const { stats } = await request<{ stats: AgentServerStats[] }>(
    `/agents/servers/stats${query({ pids: pids.join(',') })}`,
    { signal }
  );
  return stats;
}

export function dispatchAgent(body: AgentDispatchRequest): Promise<AgentDispatchResult> {
  const target = getAgentTarget();
  return request<AgentDispatchResult>('/agents/dispatch', {
    method: 'POST',
    body: JSON.stringify(body),
  }).then((result) => pinAll([result], target)[0]);
}

/** Stores an image on the server for a prompt; returns its local path (#105) */
export async function uploadAgentImage(file: Blob): Promise<string> {
  const data = await request<{ path: string }>('/agents/images', {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  return data.path;
}

export function openCloudSession(target?: string): Promise<{ args: string[] }> {
  return request<{ args: string[] }>('/agents/cloud-session', {
    method: 'POST',
    body: JSON.stringify({ target: target || null }),
  });
}

export function fetchAgentLogs(id: string, lines = 40): Promise<AgentLogs> {
  return request<AgentLogs>(`/agents/${encodeURIComponent(id)}/logs${query({ lines })}`);
}

export function replyToAgent(
  id: string,
  text: string,
  mode: 'auto' | 'attach' | 'resume' = 'auto'
): Promise<{ delivered: boolean; mode: string; output?: string }> {
  return request(`/agents/${encodeURIComponent(id)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ text, mode }),
  });
}

export function stopAgent(id: string): Promise<{ output: string }> {
  return request(`/agents/${encodeURIComponent(id)}/stop`, { method: 'POST' });
}

export function respawnAgent(id: string): Promise<{ output: string }> {
  return request(`/agents/${encodeURIComponent(id)}/respawn`, { method: 'POST' });
}

export function respawnAllAgents(): Promise<{ output: string }> {
  return request('/agents/respawn-all', { method: 'POST' });
}

export async function removeAgent(
  id: string,
  options: { discardUnpushed?: string | null; forceRemoveWorktree?: string | null } = {}
): Promise<AgentRemoveResult> {
  const response = await fetch(apiUrl(`/agents/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  const payload = (await response.json().catch(() => null)) as
    | AgentRemoveResult
    | { error: string }
    | null;
  if (response.status === 409 && payload && 'removed' in payload) return payload;
  if (!response.ok) {
    throw new Error(payload && 'error' in payload ? payload.error : 'Failed to delete session');
  }
  return payload as AgentRemoveResult;
}

export function renameAgent(id: string, name: string): Promise<{ id: string; name: string }> {
  return request(`/agents/${encodeURIComponent(id)}/name`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}

export function pinAgent(id: string, pinned: boolean): Promise<{ id: string; pinned: boolean }> {
  return request(`/agents/${encodeURIComponent(id)}/pin`, {
    method: 'PUT',
    body: JSON.stringify({ pinned }),
  });
}

export function reorderAgents(ids: string[]): Promise<{ ids: string[] }> {
  return request('/agents/order', { method: 'PUT', body: JSON.stringify({ ids }) });
}

export function fetchAgentDaemon(): Promise<AgentDaemonStatus> {
  return request<AgentDaemonStatus>('/agents/daemon');
}

/** Non-Claude harnesses (#195) and whether their CLI is installed (null: unknown, Docker) */
export function fetchHarnesses(): Promise<{ id: string; installed: boolean | null }[]> {
  return request('/agents/harnesses');
}

export function stopAgentDaemon(options: {
  any?: boolean;
  keepWorkers?: boolean;
}): Promise<{ output: string; code: number }> {
  return request('/agents/daemon/stop', { method: 'POST', body: JSON.stringify(options) });
}

export async function fetchSubagents(cwd?: string | null): Promise<AgentSubagent[]> {
  const data = await request<{ agents: AgentSubagent[] }>(`/agents/subagents${query({ cwd })}`);
  return data.agents;
}

/** Real path of `path` if the server lets the Web-IDE open it; rejects with status 403 otherwise */
export async function checkCodeFolder(path: string): Promise<string> {
  const data = await request<{ path: string }>(`/code/folder${query({ path })}`);
  return data.path;
}

export async function fetchAgentRepos(
  cwd?: string | null
): Promise<{ cwd: string; repos: AgentRepo[]; home?: string }> {
  return request(`/agents/repos${query({ cwd })}`);
}

export async function fetchAgentCommands(cwd?: string | null): Promise<AgentSlashCommand[]> {
  const data = await request<{ commands: AgentSlashCommand[] }>(
    `/agents/commands${query({ cwd })}`
  );
  return data.commands;
}

export async function fetchPastSessions(
  options: { cwd?: string | null; q?: string } = {}
): Promise<AgentPastSession[]> {
  const data = await request<{ sessions: AgentPastSession[] }>(
    `/agents/past${query({ cwd: options.cwd, q: options.q })}`
  );
  return data.sessions;
}

export function fetchAgentViewSettings(): Promise<AgentViewSettings> {
  return request<AgentViewSettings>('/settings/agent-view');
}

export function updateAgentViewSettings(
  partial: Partial<AgentViewSettings>
): Promise<AgentViewSettings> {
  return request<AgentViewSettings>('/settings/agent-view', {
    method: 'PUT',
    body: JSON.stringify(partial),
  });
}

/**
 * Subscribe to the agents SSE stream. Reconnects with backoff.
 */
export function subscribeToAgents(handlers: {
  onSessions: (sessions: AgentSession[]) => void;
  onNotify?: (notification: AgentNotification) => void;
  onError?: (message: string) => void;
  onConnectionChange?: (connected: boolean) => void;
}): () => void {
  let eventSource: EventSource | null = null;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closing = false;

  const connect = () => {
    if (closing) return;
    const target = getAgentTarget();
    eventSource = new EventSource(apiUrl('/agents/stream'));
    eventSource.addEventListener('connected', () => {
      attempts = 0;
      handlers.onConnectionChange?.(true);
    });
    eventSource.addEventListener('sessions', (event) => {
      try {
        handlers.onSessions(pinAll(JSON.parse((event as MessageEvent).data), target));
      } catch (err) {
        console.error('Failed to parse agents sessions event', err);
      }
    });
    eventSource.addEventListener('notify', (event) => {
      try {
        handlers.onNotify?.(JSON.parse((event as MessageEvent).data));
      } catch (err) {
        console.error('Failed to parse agents notify event', err);
      }
    });
    eventSource.addEventListener('agent-error', (event) => {
      try {
        handlers.onError?.(JSON.parse((event as MessageEvent).data).message);
      } catch {
        // ignore
      }
    });
    eventSource.onerror = () => {
      handlers.onConnectionChange?.(false);
      eventSource?.close();
      eventSource = null;
      if (closing || attempts >= 10) return;
      const delay = Math.min(1000 * 2 ** attempts, 30000) + Math.random() * 500;
      attempts += 1;
      timer = setTimeout(connect, delay);
    };
  };

  connect();
  return () => {
    closing = true;
    if (timer) clearTimeout(timer);
    eventSource?.close();
  };
}

// ---------------------------------------------------------------------------
// Chat sessions (#189): `claude -p` in stream-json mode behind the Chat pane
// ---------------------------------------------------------------------------

export interface ChatSummary {
  id: string;
  cwd: string;
  name: string;
  sessionId: string | null;
  model: string | null;
  busy: boolean;
  running: boolean;
  startedAt: number;
  pendingPermissions: number;
  /** Agent id when this chat is a live view of an agent running in its own process */
  view?: string | null;
}

export interface ChatStartRequest {
  cwd: string;
  model?: string | null;
  permissionMode?: string | null;
  resume?: string;
  continue?: boolean;
  skipPermissions?: boolean;
  name?: string;
}

export const fetchChats = () => {
  const target = getAgentTarget();
  return request<{ chats: ChatSummary[] }>('/agents/chat').then((d) => pinAll(d.chats, target));
};

/** Live chat view of a running agent: no second process, works mid-turn */
export const viewAgentAsChat = (agentId: string) => {
  // The live view runs on the agent's instance; its chat id belongs there too
  const target = targetOf(agentId);
  return request<ChatSummary>(
    '/agents/chat/view',
    { method: 'POST', body: JSON.stringify({ agentId }) },
    agentId
  ).then((chat) => pinAll([chat], target)[0]);
};

export const startChat = (body: ChatStartRequest) => {
  const target = getAgentTarget();
  return request<ChatSummary>('/agents/chat', { method: 'POST', body: JSON.stringify(body) }).then(
    (chat) => pinAll([chat], target)[0]
  );
};

const chatPath = (id: string, action = '') =>
  `/agents/chat/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;

export const sendChatMessage = (id: string, text: string) =>
  request<ChatSummary>(chatPath(id, 'message'), {
    method: 'POST',
    body: JSON.stringify({ text }),
  });

export const answerChatPermission = (
  id: string,
  requestId: string,
  decision: 'allow' | 'deny' | 'always'
) =>
  request<ChatSummary>(chatPath(id, 'permission'), {
    method: 'POST',
    body: JSON.stringify({ requestId, decision }),
  });

export const interruptChat = (id: string) =>
  request<ChatSummary>(chatPath(id, 'interrupt'), { method: 'POST' });

export const stopChat = (id: string) =>
  request<{ stopped: boolean }>(chatPath(id), { method: 'DELETE' });

export interface ChatStatus {
  git: {
    branch: string | null;
    untracked: number;
    changed: number;
    ahead: number;
    behind: number;
  } | null;
  cache: AgentCacheInfo | null;
  limits: UsageLimits | null;
}

export const fetchChatStatus = (id: string) => request<ChatStatus>(chatPath(id, 'status'));

export const fetchChatFiles = (id: string, q: string) =>
  request<{ files: string[] }>(`${chatPath(id, 'files')}?q=${encodeURIComponent(q)}`).then(
    (d) => d.files
  );

export const fetchChatShell = (id: string, shellId: string) =>
  request<{ output: string; updatedAt: number; truncated: boolean }>(
    chatPath(id, `shells/${encodeURIComponent(shellId)}`)
  );

/** Preview URL of an image stored by uploadAgentImage; null for any other path */
export function agentImageUrl(path: string): string | null {
  const name = path.split('/').pop() ?? '';
  return /^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/.test(name) && path.includes('/agent-images/')
    ? agentApiUrl(`/agents/images/${name}`)
    : null;
}

/**
 * Chat event stream. Every (re)connect replays the whole history first, so `onOpen` resets
 * the client state. EventSource reconnects on its own; `onGone` fires once the chat is gone.
 */
export function subscribeToChat(
  id: string,
  handlers: { onOpen: () => void; onEvent: (event: unknown) => void; onGone: () => void }
): () => void {
  const source = new EventSource(apiUrl(chatPath(id, 'stream')));
  source.onopen = handlers.onOpen;
  source.onmessage = (e) => {
    try {
      handlers.onEvent(JSON.parse(e.data));
    } catch {
      // malformed line: skip
    }
  };
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) handlers.onGone();
  };
  return () => source.close();
}
