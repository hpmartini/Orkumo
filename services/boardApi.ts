/**
 * API client for the Agent Task Board (`/api/board/*`).
 */
import { API_BASE_URL } from '../utils/apiConfig';
import type { BoardData, BoardSettings } from '../types';

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
