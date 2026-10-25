/**
 * Board items written locally (create, edit, status) versus a board fetch that may not show
 * them yet. Plain JS so both the server (Node) and the client (Vite) import the same rule.
 */

/** GitHub's project item listing can lag a fresh addProjectV2ItemById this long */
export const CREATE_GRACE_MS = 2 * 60_000;

/**
 * @typedef {{ item: { itemId: string }, at: number, created?: boolean }} RecentWrite
 */

/**
 * Items of a fetch that started at `startedAt`, with recent writes re-applied:
 * a write at or after `startedAt` wins (the fetch predates it); a created item missing from
 * the fetch is added while younger than `graceMs`.
 * @template {{ itemId: string }} T
 * @param {T[]} items
 * @param {Iterable<RecentWrite>} writes
 * @param {number} startedAt
 * @param {number} now
 * @param {number} [graceMs]
 * @returns {T[]}
 */
export function mergeRecentWrites(items, writes, startedAt, now, graceMs = CREATE_GRACE_MS) {
  const out = [...items];
  for (const w of writes) {
    const newer = w.at >= startedAt;
    const i = out.findIndex((x) => x.itemId === w.item.itemId);
    if (i >= 0) {
      if (newer) out[i] = /** @type {T} */ (w.item);
    } else if (newer || (w.created && now - w.at < graceMs)) {
      out.push(/** @type {T} */ (w.item));
    }
  }
  return out;
}

/**
 * Writes still needed after merging a fetch that started at `startedAt`: newer ones, and
 * created ones inside the grace window.
 * @param {RecentWrite} w
 */
export const keepWrite = (w, startedAt, now, graceMs = CREATE_GRACE_MS) =>
  w.at >= startedAt || (!!w.created && now - w.at < graceMs);
