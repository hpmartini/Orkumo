/**
 * API client for the Agent Task Board (`/api/board/*`).
 */
import { API_BASE_URL } from '../utils/apiConfig';
import type {
  BoardData,
  BoardIssueCreate,
  BoardIssueDetails,
  BoardIssuePatch,
  BoardItem,
  BoardRepoOptions,
  BoardSettings,
} from '../types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `${response.status} ${response.statusText}`
    );
  }
  return payload as T;
}

/** refresh=true bypasses the server's in-memory cache (manual refresh). */
export function fetchBoard(refresh = false): Promise<BoardData> {
  return request<BoardData>(`/board/items${refresh ? '?refresh=1' : ''}`);
}

export function setBoardItemStatus(
  itemId: string,
  optionId: string
): Promise<{ itemId: string; statusOptionId: string }> {
  return request(`/board/items/${encodeURIComponent(itemId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ optionId }),
  });
}

export function fetchRepoOptions(repo: string): Promise<BoardRepoOptions> {
  return request<BoardRepoOptions>(`/board/repo-options?repo=${encodeURIComponent(repo)}`);
}

export function fetchIssueDetails(issueId: string): Promise<BoardIssueDetails> {
  return request<BoardIssueDetails>(`/board/issues/${encodeURIComponent(issueId)}`);
}

/** Creates the issue and adds it to the board project; returns the new board item */
export function createBoardIssue(input: BoardIssueCreate): Promise<BoardItem> {
  return request<BoardItem>('/board/issues', { method: 'POST', body: JSON.stringify(input) });
}

/** Edits the issue behind a board item; returns the item as GitHub has it afterwards */
export function updateBoardIssue(itemId: string, patch: BoardIssuePatch): Promise<BoardItem> {
  return request<BoardItem>(`/board/items/${encodeURIComponent(itemId)}/issue`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** Local checkout of a GitHub repo ("owner/name"), null if none is known */
export async function fetchRepoPath(repo: string): Promise<string | null> {
  const { path } = await request<{ path: string | null }>(
    `/board/repo-path?repo=${encodeURIComponent(repo)}`
  );
  return path;
}

export function fetchBoardSettings(): Promise<BoardSettings> {
  return request<BoardSettings>('/board/settings');
}

/** Partial update; returns the full stored settings. Changing `source` drops the item cache. */
export function updateBoardSettings(patch: Partial<BoardSettings>): Promise<BoardSettings> {
  return request<BoardSettings>('/board/settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}
