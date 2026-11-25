/**
 * API client for orchestrators (`/api/orchestrator/*`, server/services/orchestratorService.js).
 */
import { API_BASE_URL } from '../utils/apiConfig';
import { targetOf } from '../utils/agentTarget';
import type {
  ChatThread,
  ChatThreadList,
  OrchestratorRole,
  OrchestratorWorkspace,
  QuickAgent,
} from '@hpmartini/agents-ui';

/** `target`: instance prefix (utils/agentTarget) the call goes to; '' is this machine */
async function request<T>(path: string, init?: RequestInit, target = ''): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${target}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (payload && typeof payload.error === 'string' && payload.error) ||
        `${response.status} ${response.statusText}`
    );
  }
  return payload as T;
}

export const fetchOrchestratorWorkspace = (): Promise<OrchestratorWorkspace> =>
  request('/orchestrator/workspace');

export const fetchOrchestratorRoles = (): Promise<{ roles: OrchestratorRole[] }> =>
  request('/orchestrator/roles');

/** "New orchestrator": the default harness as an agent pane in the orchestrator workspace, optionally with a role */
export const startOrchestrator = (role?: string): Promise<QuickAgent> =>
  request('/orchestrator/start', { method: 'POST', body: JSON.stringify(role ? { role } : {}) });

export interface InstructBody {
  entry?: string;
  task?: { project: string; task: string };
  text: string;
  attachments?: { path: string; kind: 'image' | 'file' }[];
}

/**
 * Instruct (Status view): one message to the orchestrator; the server prepends the context header.
 * `session`: the agent pane the Status view is shown in; the report then lives on its instance
 */
export const instructOrchestrator = (
  orchestrator: string,
  body: InstructBody,
  session?: string
): Promise<{ delivered: boolean }> =>
  request(
    `/orchestrator/reports/${encodeURIComponent(orchestrator)}/instruct`,
    { method: 'POST', body: JSON.stringify(body) },
    session ? targetOf(session) : ''
  );

/**
 * Threads of an orchestrator chat (`session`: the pane's listed session). They live on the
 * session's instance (its orchestrators and thread store), so a peer pane asks the peer (#220)
 */
export const fetchThreads = (session: string): Promise<ChatThreadList> =>
  request(`/orchestrator/threads?session=${encodeURIComponent(session)}`, {}, targetOf(session));

export const createThread = async (
  session: string,
  body:
    | { task: { project: string; task: string } }
    | { name: { project: string; task: string }; parentKey?: string }
): Promise<ChatThread> =>
  (
    await request<{ thread: ChatThread }>(
      '/orchestrator/threads',
      {
        method: 'POST',
        body: JSON.stringify({ session, ...body }),
      },
      targetOf(session)
    )
  ).thread;

export const updateThread = async (
  session: string,
  id: string,
  patch: { closed?: boolean; readAt?: number; command?: string; cancelCommand?: boolean }
): Promise<ChatThread> =>
  (
    await request<{ thread: ChatThread }>(
      `/orchestrator/threads/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ session, ...patch }),
      },
      targetOf(session)
    )
  ).thread;
