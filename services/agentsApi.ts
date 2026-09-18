/**
 * API client for the Claude Code agent view (`/api/agents/*`).
 */
import { API_BASE_URL } from '../utils/apiConfig';
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
} from '../types';

const API_BASE = API_BASE_URL;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
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
  return request<AgentsResponse>(`/agents${query({ cwd: options.cwd, all: options.all })}`);
}

export async function fetchAgentsRawJson(
  options: { cwd?: string | null; all?: boolean } = {}
): Promise<string> {
  const response = await fetch(
    `${API_BASE}/agents/json${query({ cwd: options.cwd, all: options.all })}`
  );
  if (!response.ok) throw new Error('Failed to fetch agents JSON');
  return response.text();
}

export function dispatchAgent(body: AgentDispatchRequest): Promise<AgentDispatchResult> {
  return request<AgentDispatchResult>('/agents/dispatch', {
    method: 'POST',
    body: JSON.stringify(body),
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
  const response = await fetch(`${API_BASE}/agents/${encodeURIComponent(id)}`, {
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

export async function fetchAgentRepos(
  cwd?: string | null
): Promise<{ cwd: string; repos: AgentRepo[] }> {
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
    eventSource = new EventSource(`${API_BASE}/agents/stream`);
    eventSource.addEventListener('connected', () => {
      attempts = 0;
      handlers.onConnectionChange?.(true);
    });
    eventSource.addEventListener('sessions', (event) => {
      try {
        handlers.onSessions(JSON.parse((event as MessageEvent).data));
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
