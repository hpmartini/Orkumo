/**
 * Backend target (docs/MODULES.md, "Backend target"): the whole UI talks to another Orkumo instance
 * through a module route of this server, e.g. `/modules/mesh/peer/<key>`. Every API call, SSE
 * stream and WebSocket then goes to `/api<prefix>/...` (utils/apiConfig.ts), which the module relays.
 *
 * Read once at load: switching reloads the window, so no request, open stream or cached state of
 * one instance survives into the other.
 */

/** Only module routes: a prefix can never point the client at a host route or another origin */
export const MODULE_PREFIX_RE = /^\/modules\/[a-z0-9-]+(?:\/[A-Za-z0-9._~-]+)*$/;

export const BACKEND_KEY = 'orkumo.backend';
const MAX_LABEL = 80;

export interface Backend {
  prefix: string;
  label: string;
}

function toBackend(prefix: unknown, label: unknown): Backend | null {
  if (typeof prefix !== 'string' || !MODULE_PREFIX_RE.test(prefix)) return null;
  if (typeof label !== 'string' || !label.trim() || label.length > MAX_LABEL) return null;
  return { prefix, label };
}

/** Stored backend; anything invalid is removed so it cannot linger */
function load(): Backend | null {
  try {
    const raw = localStorage.getItem(BACKEND_KEY);
    if (raw === null) return null;
    let backend: Backend | null = null;
    try {
      const parsed = JSON.parse(raw) as { prefix?: unknown; label?: unknown } | null;
      backend = parsed && toBackend(parsed.prefix, parsed.label);
    } catch {
      // not JSON: removed below
    }
    if (!backend) localStorage.removeItem(BACKEND_KEY);
    return backend;
  } catch {
    // storage unavailable: this machine
    return null;
  }
}

const backend = typeof window !== 'undefined' ? load() : null;

/** Instance the UI talks to; null is this machine */
export function getBackend(): Backend | null {
  return backend;
}

/** Connects the whole UI to the instance behind `prefix` and reloads; invalid input is ignored */
export function connectBackend(prefix: string, label: string): void {
  const next = toBackend(prefix, label);
  if (!next) return;
  try {
    localStorage.setItem(BACKEND_KEY, JSON.stringify(next));
  } catch {
    return; // not stored: a reload would land on this machine again
  }
  window.location.reload();
}

/** Back to this machine; reloads */
export function disconnectBackend(): void {
  try {
    localStorage.removeItem(BACKEND_KEY);
  } catch {
    // storage unavailable: nothing was stored
  }
  window.location.reload();
}
