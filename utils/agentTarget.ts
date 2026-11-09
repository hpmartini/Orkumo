/**
 * Agent target (#220): which Orkumo instance the AgentsView talks to. '' is this machine; a
 * module (docs/MODULES.md, `host.setAgentTarget`) sets an API prefix like
 * `/modules/mesh/peer/<host>`, and every `/api/agents/*` call and the agent PTY WebSocket then go
 * to `/api<prefix>/agents/*` and `/api<prefix>/pty` on the local server, which relays them.
 *
 * Each session id remembers the target it was first seen on, so an open tab keeps talking to
 * its instance after the picker switches elsewhere.
 */
import { useSyncExternalStore } from 'react';
import { API_BASE_URL, getWsUrl } from './apiConfig';

// Only module routes: a target can never point the client at a host route or another origin
const TARGET_RE = /^\/modules\/[a-z0-9-]+(?:\/[A-Za-z0-9._~-]+)*$/;

let current = '';
const listeners = new Set<() => void>();
const pinned = new Map<string, string>();

export function isAgentTarget(target: unknown): target is string {
  return target === '' || (typeof target === 'string' && TARGET_RE.test(target));
}

export function getAgentTarget(): string {
  return current;
}

/** Switches the picker; ignores anything that is not '' or a module prefix */
export function setAgentTarget(target: string): void {
  if (!isAgentTarget(target) || target === current) return;
  current = target;
  listeners.forEach((l) => l());
}

export function subscribeAgentTarget(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAgentTarget(): string {
  return useSyncExternalStore(subscribeAgentTarget, getAgentTarget);
}

/** First target an id was seen on wins: a later list from another instance never moves a tab */
// shortcut: keyed by id alone; claude job ids are random, so an id on two instances does not
// happen in practice. Key by target+id once ids can collide (e.g. instance-local counters).
export function pinTarget(id: string, target: string): void {
  if (id && !pinned.has(id)) pinned.set(id, target);
}

/** Target of a session/chat id; ids never seen (new dispatch, `dispatch` path words) use the current one */
export function targetOf(id: string): string {
  return pinned.get(id) ?? current;
}

// `/agents/<id>/...` and `/agents/chat/<id>/...`
const ID_IN_PATH = /^\/agents\/(?:chat\/(?=[^/?]+\/|[^/?]+$))?([^/?]+)/;

/**
 * Full URL of an `/agents...` API path on the instance its session belongs to: `id`, else the id
 * in the path, else the current target
 */
export function agentApiUrl(path: string, id = ID_IN_PATH.exec(path)?.[1]): string {
  return `${API_BASE_URL}${id ? targetOf(decodeURIComponent(id)) : current}${path}`;
}

/** PTY WebSocket URL for a session's pane */
export function agentWsUrl(id: string): string {
  return getWsUrl(`/api${targetOf(id)}/pty`);
}

/** For tests */
export function resetAgentTarget(): void {
  current = '';
  pinned.clear();
  listeners.forEach((l) => l());
}
