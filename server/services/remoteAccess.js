/**
 * Remote access for the iOS app (Issue #120).
 *
 * Opt-in via DEVORBIT_REMOTE=true. The server is then meant to be reached through
 * `tailscale serve` (HTTPS proxy on the tailnet to localhost). Every request that
 * is not a direct loopback request needs the pairing token, sent as
 * `X-DevOrbit-Token` header or `token` query param (EventSource/WebSocket cannot set headers).
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

/** Direct request from this machine, not relayed by a proxy on its behalf. */
export function isLocalRequest(req) {
  if (!LOOPBACK.has(req.socket?.remoteAddress)) return false;
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

function tokenFrom(req) {
  const header = req.headers['x-devorbit-token'];
  if (typeof header === 'string') return header;
  const query = new URL(req.url, 'http://x').searchParams.get('token');
  return query ?? undefined;
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
