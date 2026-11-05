/**
 * Remote access for the iOS app (Issue #120).
 *
 * Opt-in via DEVORBIT_REMOTE=true. The server is then meant to be reached through
 * `tailscale serve` (HTTPS proxy on the tailnet to localhost). Every request that
 * is not a direct loopback request needs the pairing token, sent as
 * `X-DevOrbit-Token` header; the `token` query param only for the /api/pty WebSocket upgrade and SSE.
 * Without the opt-in nothing changes: no token, no extra CORS origin.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDataPath } from './dataPath.js';

// Capacitor's WKWebView serves the bundled app from this origin.
export const CAPACITOR_ORIGIN = 'capacitor://localhost';

export const isRemoteEnabled = () => process.env.DEVORBIT_REMOTE === 'true';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
// Set by proxies (tailscale serve, reverse proxies): a loopback peer carrying them speaks for a remote client.
const FORWARD_HEADERS = [
  'x-forwarded-for',
  'x-forwarded-host',
  'forwarded',
  'tailscale-user-login',
];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Browsers send Origin on cross-site POSTs; cors() is open, so host-launching routes refuse non-loopback origins.
export function isLoopbackOrigin(origin) {
  if (!origin) return true;
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

const hostName = (host) => {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return '';
  }
};

/**
 * Direct request from this machine, not relayed by a proxy on its behalf. The Host header must
 * name loopback too: that rejects DNS rebinding (attacker domain resolving to 127.0.0.1) and
 * proxies like `tailscale serve`, which keep the tailnet name as Host.
 */
export function isLocalRequest(req) {
  if (!LOOPBACK.has(req.socket?.remoteAddress)) return false;
  if (!LOCAL_HOSTS.has(hostName(req.headers.host))) return false;
  return !FORWARD_HEADERS.some((h) => req.headers[h] !== undefined);
}

const tokenFile = () => path.join(getDataPath(), 'remote-token');
let cachedToken = null;

/** Pairing token, created on first use and kept in the data dir (mode 600). */
export function getToken() {
  if (cachedToken) return cachedToken;
  const file = tokenFile();
  try {
    cachedToken = fs.readFileSync(file, 'utf8').trim();
  } catch {
    cachedToken = '';
  }
  if (!cachedToken) {
    cachedToken = crypto.randomBytes(32).toString('base64url');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, cachedToken, { mode: 0o600 });
  }
  return cachedToken;
}

/** Constant-time comparison; hashing first equalises lengths for timingSafeEqual. */
export function isValidToken(candidate) {
  if (typeof candidate !== 'string' || !candidate) return false;
  const hash = (s) => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(hash(candidate), hash(getToken()));
}

/** EventSource and WebSocket cannot set headers; only they may carry the token in the URL (logs, history). */
function allowsQueryToken(req, url) {
  if (url.pathname === '/api/pty' && req.headers.upgrade?.toLowerCase() === 'websocket')
    return true;
  return req.method === 'GET' && (req.headers.accept ?? '').includes('text/event-stream');
}

function tokenFrom(req) {
  const header = req.headers['x-devorbit-token'];
  if (typeof header === 'string') return header;
  const url = new URL(req.url, 'http://x');
  if (!allowsQueryToken(req, url)) return undefined;
  return url.searchParams.get('token') ?? undefined;
}

/** True when the request may proceed. Used for HTTP requests and WebSocket upgrades alike. */
export function isAuthorized(req) {
  if (!isRemoteEnabled() || isLocalRequest(req)) return true;
  return isValidToken(tokenFrom(req));
}

export function requireRemoteToken(req, res, next) {
  // CORS preflights carry no custom headers; the cors middleware answers them before this runs.
  if (isAuthorized(req)) return next();
  res.status(401).json({ error: 'Pairing token missing or invalid' });
}

/** Deep link the app understands; also what a QR code would encode. */
export function pairingLink(serverUrl) {
  const params = new URLSearchParams({ url: serverUrl, token: getToken() });
  return `devorbit://pair?${params.toString()}`;
}

/** For tests: forget the cached token so a new data dir takes effect. */
export function resetTokenCache() {
  cachedToken = null;
}
