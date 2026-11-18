/**
 * API client for orchestrators (`/api/orchestrator/*`, server/services/orchestratorService.js).
 */
import { API_BASE_URL } from '../utils/apiConfig';
import type { QuickAgent } from './agentsApi';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
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

export interface OrchestratorWorkspace {
  dir: string;
  cli: string;
  /** Typed into / replied to a session that was just marked as orchestrator */
  briefing: string;
}

export const fetchOrchestratorWorkspace = (): Promise<OrchestratorWorkspace> =>
  request('/orchestrator/workspace');

/** A role file `<workspace>/roles/<id>.md`; briefing assigns it to a running orchestrator */
export interface OrchestratorRole {
  id: string;
  title: string;
  briefing: string;
}

export const fetchOrchestratorRoles = (): Promise<{ roles: OrchestratorRole[] }> =>
  request('/orchestrator/roles');

/** "New orchestrator": the default harness as an agent pane in the orchestrator workspace, optionally with a role */
export const startOrchestrator = (role?: string): Promise<QuickAgent> =>
  request('/orchestrator/start', { method: 'POST', body: JSON.stringify(role ? { role } : {}) });
