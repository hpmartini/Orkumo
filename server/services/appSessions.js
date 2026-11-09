/**
 * Sessions started in the Claude app (iOS, Android, web) that run on this machine through
 * Remote Control: `claude agents --json` lists them as plain interactive sessions named
 * `claude-<xx>`. Their registry entry (`~/.claude/sessions/<pid>.json`) carries the claude.ai
 * session id; title, origin and turn status come from claude.ai with the subscription login.
 */
/* global AbortSignal */
import fsp from 'fs/promises';
import path from 'path';
import { readClaudeOauth } from './usageService.js';

const BRIDGE_ID_RE = /^session_[A-Za-z0-9]{8,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INFO_TTL_MS = 60_000;
const INFO_FAILED_TTL_MS = 5 * 60_000;
const OAUTH_TTL_MS = 5 * 60_000;

/** claude.ai session id of an app session (registry entry of an interactive pid), else null */
export async function readBridgeEntry(sessionsDir, pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  let entry;
  try {
    entry = JSON.parse(await fsp.readFile(path.join(sessionsDir, `${pid}.json`), 'utf-8'));
  } catch {
    return null;
  }
  // Background jobs register a bridge id too (Remote Control); only interactive ones came from the app
  if (entry?.kind !== 'interactive' || !BRIDGE_ID_RE.test(entry.bridgeSessionId || '')) return null;
  return {
    bridgeSessionId: entry.bridgeSessionId,
    sessionId: UUID_RE.test(entry.sessionId || '') ? entry.sessionId : null,
    cwd: typeof entry.cwd === 'string' ? entry.cwd : null,
  };
}

export const appSessionUrl = (bridgeSessionId) => `https://claude.ai/code/${bridgeSessionId}`;

let oauthMemo = { at: 0, value: null };
const infoCache = new Map();

/**
 * Title, origin ("ios", "android", "web", …) and turn status of a claude.ai session.
 * null when the login is missing or claude.ai does not answer (cached briefly, never thrown).
 */
export async function fetchAppSessionInfo(
  bridgeSessionId,
  { claudeDir, now = Date.now(), readOauth = readClaudeOauth, fetchFn = fetch } = {}
) {
  if (!BRIDGE_ID_RE.test(bridgeSessionId || '')) return null;
  const cached = infoCache.get(bridgeSessionId);
  if (cached && now < cached.until) return cached.value;
  if (cached?.pending) return cached.pending;
  const pending = (async () => {
    if (now - oauthMemo.at > OAUTH_TTL_MS)
      oauthMemo = { at: now, value: await readOauth(claudeDir) };
    const oauth = oauthMemo.value;
    if (!oauth?.accessToken || (oauth.expiresAt && oauth.expiresAt < now)) return null;
    const res = await fetchFn(`https://api.anthropic.com/v1/sessions/${bridgeSessionId}`, {
      headers: {
        Authorization: `Bearer ${oauth.accessToken}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'ccr-byoc-2025-07-29',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return {
      title: typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : null,
      origin: typeof body?.origin === 'string' ? body.origin : null,
      statusCategory: body?.post_turn_summary?.status_category || null,
      statusDetail: body?.post_turn_summary?.status_detail || null,
    };
  })().catch(() => null);
  infoCache.set(bridgeSessionId, { until: 0, value: cached?.value ?? null, pending });
  const value = await pending;
  infoCache.set(bridgeSessionId, {
    until: now + (value ? INFO_TTL_MS : INFO_FAILED_TTL_MS),
    // A failed refresh keeps the last good title
    value: value ?? cached?.value ?? null,
  });
  return value ?? cached?.value ?? null;
}

/** Test hook: forget cached claude.ai answers and the login */
export function resetAppSessionCache() {
  infoCache.clear();
  oauthMemo = { at: 0, value: null };
}
