/**
 * Validation of cloud session targets for `claude --cloud <id|url>` / `claude --teleport`.
 *
 * Only an ID or a claude.ai/code URL is accepted: `--cloud` treats any other text as the
 * description of a NEW cloud session, so free text must never reach the CLI.
 * Mirrored in server/services/agentService.js (parseCloudTarget) - keep both in sync.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_ID_RE = /^session_[A-Za-z0-9]{8,64}$/;

export type CloudTarget = { ok: true; id: string } | { ok: false; error: string };

function isSessionId(value: string): boolean {
  return UUID_RE.test(value) || SESSION_ID_RE.test(value);
}

/** Extract the session id from a raw ID or a https://claude.ai/code/<id> URL. */
export function parseCloudTarget(input: string): CloudTarget {
  const raw = input.trim();
  if (isSessionId(raw)) return { ok: true, id: raw };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'Expected a session ID or a claude.ai/code URL' };
  }
  if (url.protocol !== 'https:' || url.hostname !== 'claude.ai' || url.username || url.password) {
    return { ok: false, error: 'Only https://claude.ai/code/… URLs are allowed' };
  }
  const match = url.pathname.match(/^\/code\/([^/]+)\/?$/);
  if (!match || !isSessionId(match[1])) {
    return { ok: false, error: 'URL does not contain a valid session ID' };
  }
  return { ok: true, id: match[1] };
}

/** CLI args for opening a session: `--cloud <id>`, or `--teleport` (picker) without a target. */
export function buildCloudArgs(target?: string | null): string[] {
  if (!target) return ['--teleport'];
  const parsed = parseCloudTarget(target);
  if (!parsed.ok) throw new Error(parsed.error);
  return ['--cloud', parsed.id];
}
