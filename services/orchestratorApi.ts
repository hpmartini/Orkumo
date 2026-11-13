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

/** "New orchestrator": the default harness as an agent pane in the orchestrator workspace */
export const startOrchestrator = (): Promise<QuickAgent> =>
  request('/orchestrator/start', { method: 'POST' });
