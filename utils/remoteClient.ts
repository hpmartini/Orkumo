/**
 * iOS app (Capacitor) connection to a DevOrbit server on the Mac (Issue #120).
 *
 * Pairing = server URL + token, stored in localStorage. The token rides on every
 * request to that server: header for fetch, `token` query param for EventSource and
 * WebSocket, which cannot set headers. Patching the three globals once keeps all
 * existing call sites (API_BASE_URL, getWsUrl, getSSEUrl) unchanged.
 */

export interface Pairing {
  url: string;
  token: string;
}

const STORAGE_KEY = 'devorbit.pairing';

/** Normalises user input to an origin like `https://mac.tail1.ts.net`; null if unusable. */
export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    // Plain http only to this device (simulator dev); anything else must be https.
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** `devorbit://pair?url=…&token=…` → pairing; anything else → null. */
export function parsePairingLink(link: string): Pairing | null {
  try {
    const url = new URL(link);
    if (url.protocol !== 'devorbit:' || url.host !== 'pair') return null;
    const server = normalizeServerUrl(url.searchParams.get('url') ?? '');
    const token = url.searchParams.get('token')?.trim();
    return server && token ? { url: server, token } : null;
  } catch {
    return null;
  }
}

/** `devorbit://open?path=/agents` → `/agents`; only app-internal paths. */
export function parseOpenLink(link: string): string | null {
  try {
    const url = new URL(link);
    if (url.protocol !== 'devorbit:' || url.host !== 'open') return null;
    const path = url.searchParams.get('path') ?? '';
    return path.startsWith('/') && !path.startsWith('//') ? path : null;
  } catch {
    return null;
  }
}

export function readPairing(): Pairing | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return parsed?.url && parsed?.token ? parsed : null;
  } catch {
    return null;
  }
}

export function savePairing(pairing: Pairing): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pairing));
}

/**
 * Drops a token the server rejected but keeps the URL, so re-pairing only needs a new token.
 * The rejected token is remembered so a repeated launch link cannot re-pair it in a loop.
 */
export function forgetToken(): void {
  const pairing = readPairing();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ url: pairing?.url ?? '', token: '', rejected: pairing?.token })
  );
}

export function isRejectedToken(token: string): boolean {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')?.rejected === token;
  } catch {
    return false;
  }
}

export function lastServerUrl(): string {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')?.url ?? '';
  } catch {
    return '';
  }
}

const sameServer = (target: string, server: string) => {
  try {
    const t = new URL(target);
    const s = new URL(server);
    return t.host === s.host && t.protocol.replace('ws', 'http') === s.protocol;
  } catch {
    return false;
  }
};

/** Adds the token as query param when the URL points at the paired server. */
export function withToken(target: string, pairing: Pairing): string {
  if (!sameServer(target, pairing.url)) return target;
  const url = new URL(target);
  url.searchParams.set('token', pairing.token);
  return url.toString();
}

/** Wraps fetch, EventSource and WebSocket so requests to the paired server carry the token. */
export function installRemoteAuth(pairing: Pairing, onUnauthorized: () => void): void {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const target =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!sameServer(target, pairing.url)) return nativeFetch(input, init);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    headers.set('X-DevOrbit-Token', pairing.token);
    const response = await nativeFetch(input, { ...init, headers });
    if (response.status === 401) onUnauthorized();
    return response;
  };

  const NativeEventSource = window.EventSource;
  window.EventSource = class extends NativeEventSource {
    constructor(url: string | URL, init?: ConstructorParameters<typeof EventSource>[1]) {
      super(withToken(String(url), pairing), init);
    }
  };

  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(withToken(String(url), pairing), protocols);
    }
  };
}
