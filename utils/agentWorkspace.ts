import type { AgentLayout } from '../types';

/** dataTransfer type carrying the session id of a dragged agent tab / pane */
export const AGENT_TAB_MIME = 'application/x-devorbit-agent-tab';

export type DropZone = 'left' | 'right' | 'top' | 'bottom';
export type InsertPosition = 'before' | 'after';

interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Which half of a tab the pointer is over (horizontal strip) */
export function insertPosition(rect: RectLike, x: number): InsertPosition {
  return x < rect.left + rect.width / 2 ? 'before' : 'after';
}

/** Edge zone of a pane closest to the pointer (diagonals resolve by the nearer edge) */
export function dropZone(rect: RectLike, x: number, y: number): DropZone {
  const fx = rect.width ? (x - rect.left) / rect.width : 0.5;
  const fy = rect.height ? (y - rect.top) / rect.height : 0.5;
  const distances: [DropZone, number][] = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy],
  ];
  return distances.reduce((best, d) => (d[1] < best[1] ? d : best))[0];
}

/** Split orientation for a zone: left/right side by side, top/bottom stacked */
export function layoutForZone(zone: DropZone): AgentLayout {
  return zone === 'left' || zone === 'right' ? 'columns' : 'rows';
}

/**
 * Index move that puts `id` directly before/after `targetId`, in the
 * `(from, to)` form of splice-out then splice-in. Null when nothing changes.
 */
export function reorderIndices(
  order: string[],
  id: string,
  targetId: string,
  position: InsertPosition
): { from: number; to: number } | null {
  const from = order.indexOf(id);
  const target = order.indexOf(targetId);
  if (from < 0 || target < 0 || id === targetId) return null;
  const slot = position === 'before' ? target : target + 1;
  const to = from < slot ? slot - 1 : slot;
  return to === from ? null : { from, to };
}

/** Move by one slot (keyboard); null at the ends */
export function stepIndices(
  order: string[],
  id: string,
  delta: -1 | 1
): { from: number; to: number } | null {
  const from = order.indexOf(id);
  const to = from + delta;
  return from < 0 || to < 0 || to >= order.length ? null : { from, to };
}

/** Zone -> position relative to the anchor pane (left/top come first) */
export function positionForZone(zone: DropZone): InsertPosition {
  return zone === 'left' || zone === 'top' ? 'before' : 'after';
}
