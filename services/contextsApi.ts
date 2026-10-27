/**
 * API client for project contexts (`/api/contexts/*`, #97).
 */
import type { ProjectContext } from '../types';
import { request } from './boardApi';

export interface ContextList {
  contexts: ProjectContext[];
  activeContextId: string;
}

/** Client localStorage entries of a context (key -> raw value) */
export type ContextUi = Record<string, string | null>;

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

export const fetchContexts = () => request<ContextList>('/contexts');

export const createContext = (input: Omit<ProjectContext, 'id'>) =>
  request<ProjectContext>('/contexts', json('POST', input));

export const updateContext = (id: string, patch: Partial<Omit<ProjectContext, 'id'>>) =>
  request<ProjectContext>(`/contexts/${encodeURIComponent(id)}`, json('PATCH', patch));

export const reorderContexts = (ids: string[]) =>
  request<ContextList>('/contexts/order', json('PUT', { ids }));

export const deleteContext = (id: string) =>
  request<ContextList>(`/contexts/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Switches to `id`; `ui` belongs to context `from`. Returns the ui stored for `id`. */
export const activateContext = (id: string, ui: ContextUi, from: string) =>
  request<{ activeContextId: string; ui: ContextUi | null }>(
    `/contexts/${encodeURIComponent(id)}/activate`,
    json('POST', { ui, from })
  );
