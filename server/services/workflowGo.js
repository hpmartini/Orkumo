/**
 * GO for the next mw stage (#145): set mw:build, or start the mw-board poll now instead of waiting
 * for its next launchd tick. mw 7 has no other approval (#136).
 */
import { z } from 'zod';
import { runOnHost } from './agentService.js';
import { BUILD_LABEL, sameGo } from '../../utils/workflowStage.js';

/** launchd job of `mw board install` */
export const MW_BOARD_JOB = 'de.martini-labs.mw-board';

/** Body `go` of POST /api/workflows/go: only the build GO; the poll has its own route */
export const workflowGoSchema = z.object({ kind: z.literal('build') }).strict();

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
 * Applies `go` if it is exactly the GO the fresh state `ctx` offers; `{ status, body }` for the route.
 * @param {{ source: unknown, item: { itemId: string, labels: { name: string }[] }, state: { go: any } }} ctx
 * @param {import('../../utils/workflowStage.js').WorkflowGo} go
 * @param {{ updateIssue: (source: unknown, itemId: string, patch: { labels: string[] }) => Promise<unknown> }} deps
 */
export async function applyGo(ctx, go, { updateIssue }) {
  if (!sameGo(ctx.state.go, go)) {
    return { status: 409, body: { error: 'Dieses GO ist nicht (mehr) offen', state: ctx.state } };
  }
  if (go.kind === 'poll') {
    await kickPoll();
    return { status: 200, body: { ok: true } };
  }
  const labels = [...ctx.item.labels.map((l) => l.name), BUILD_LABEL];
  const item = await updateIssue(ctx.source, ctx.item.itemId, { labels });
  // the label stands either way: a failed kick only means the regular poll picks it up
  const pollError = await kickPoll().then(
    () => null,
    (e) => e.message
  );
  return { status: 200, body: { ok: true, item, pollError } };
}
