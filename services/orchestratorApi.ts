/**
 * API client for orchestrators (`/api/orchestrator/*`, server/services/orchestratorService.js).
 */
import { API_BASE_URL } from '../utils/apiConfig';
import type { OrchestratorRole, OrchestratorWorkspace, QuickAgent } from '@hpmartini/agents-ui';

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

export const fetchOrchestratorWorkspace = (): Promise<OrchestratorWorkspace> =>
  request('/orchestrator/workspace');

export const fetchOrchestratorRoles = (): Promise<{ roles: OrchestratorRole[] }> =>
  request('/orchestrator/roles');

/** "New orchestrator": the default harness as an agent pane in the orchestrator workspace, optionally with a role */
export const startOrchestrator = (role?: string): Promise<QuickAgent> =>
  request('/orchestrator/start', { method: 'POST', body: JSON.stringify(role ? { role } : {}) });
