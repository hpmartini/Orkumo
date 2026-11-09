/**
 * API client for the Issues mode (`/api/issues`).
 */
import type { IssueListResponse, RepoIssueState } from '../types';
import { request } from './boardApi';

/** Issues of the context's repos; refresh=true bypasses the server's cache (manual refresh) */
export function fetchIssues(
  contextId: string | undefined,
  state: RepoIssueState,
  refresh = false
): Promise<IssueListResponse> {
  const params = new URLSearchParams({ state });
  if (contextId) params.set('context', contextId);
  if (refresh) params.set('refresh', '1');
  return request<IssueListResponse>(`/issues?${params}`);
}
