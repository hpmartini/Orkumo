/**
 * GO for the next mw stage (#145): set mw:build, or start the issue now instead of waiting for the
 * next mw-board poll. mw 7 has no other approval (#136).
 */
import { z } from 'zod';
import { runOnHost } from './agentService.js';
import { BUILD_LABEL, ISSUE_URL_RE, sameGo } from '../../utils/workflowStage.js';

/** launchd job of `mw board install` */
export const MW_BOARD_JOB = 'de.martini-labs.mw-board';

/** Body `go` of the build GO route (Workflows module); the poll has its own route (POST /api/board/poll) */
export const workflowGoSchema = z.object({ kind: z.literal('build') }).strict();

/** Body of POST /api/board/start: the issue URL comes from the client (trust boundary) */
export const workflowStartSchema = z.object({ url: z.string().regex(ISSUE_URL_RE) }).strict();

/** Exit of an mw without `mw board go` (argparse) or no mw on the PATH at all */
const NO_BOARD_GO = /invalid choice: 'go'|unknown command|ENOENT|command not found/i;
export const POLL_FALLBACK = 'startet mit dem nächsten Poll';

/**
 * Starts the mw-board poll now. No `-k`: mw relies on launchd never overlapping two polls, and
 * killing one could interrupt a session start.
 * shortcut: a poll already running makes this a no-op and may have read the issue before its
 * label; the next tick picks it up. Upgrade if that delay matters (mw single-issue poll).
 * In Docker the container is not Hape's user, so HOST_UID names the host uid.
 */
export async function kickPoll(uid = process.env.HOST_UID || process.getuid?.()) {
  const r = await runOnHost('launchctl', ['kickstart', `gui/${uid}/${MW_BOARD_JOB}`], {
    timeout: 10_000,
  });
  if (r.code !== 0) {
    throw new Error(`mw-board-Poll nicht gestartet: ${(r.stderr || r.stdout).trim() || r.code}`);
  }
}

/**
 * Starts or wakes the issue now via `mw board go <url> --json`; `{ action, reason }` as mw prints it
 * (`start|resume|none`, also with a non-zero exit such as "kein Platz frei (4/4)"). An mw without
 * `board go` falls back to the poll kick: `{ action: 'poll', reason: POLL_FALLBACK }`.
 * @param {string} url
 * @returns {Promise<{ action: string, reason: string }>}
 */
export async function startNow(url) {
  if (!ISSUE_URL_RE.test(url)) {
    throw Object.assign(new Error('Keine GitHub-Issue-URL'), { status: 400 });
  }
  const r = await runOnHost('mw', ['board', 'go', url, '--json'], { timeout: 60_000 });
  try {
    const out = JSON.parse(r.stdout.trim().split('\n').pop() ?? '');
    if (typeof out?.action === 'string')
      return { action: out.action, reason: String(out.reason ?? '') };
  } catch {
    // no JSON: old mw or a crash, decided below
  }
  if (r.code !== 0 && NO_BOARD_GO.test(r.stderr)) {
    await kickPoll();
    return { action: 'poll', reason: POLL_FALLBACK };
  }
  throw new Error(`mw board go: ${(r.stderr || r.stdout).trim() || `Exit ${r.code}`}`);
}

/**
 * Applies `go` if it is exactly the GO the fresh state `ctx` offers; `{ status, body }` for the route.
 * @param {{ source: unknown, item: { itemId: string, url: string, labels: { name: string }[] }, state: { go: any } }} ctx
 * @param {import('../../utils/workflowStage.js').WorkflowGo} go
 * @param {{ updateIssue: (source: unknown, itemId: string, patch: { labels: string[] }) => Promise<unknown> }} deps
 */
export async function applyGo(ctx, go, { updateIssue }) {
  if (!sameGo(ctx.state.go, go)) {
    return { status: 409, body: { error: 'Dieses GO ist nicht (mehr) offen', state: ctx.state } };
  }
  if (go.kind === 'poll') {
    return { status: 200, body: { ok: true, start: await startNow(ctx.item.url) } };
  }
  const labels = [...new Set([...ctx.item.labels.map((l) => l.name), BUILD_LABEL])];
  const item = await updateIssue(ctx.source, ctx.item.itemId, { labels });
  // the label stands either way: a failed start only means the regular poll picks it up
  const start = await startNow(ctx.item.url).catch((e) => ({ action: 'error', reason: e.message }));
  return { status: 200, body: { ok: true, item, start } };
}
