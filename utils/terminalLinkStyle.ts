/**
 * URLs and file paths in a terminal stay visibly links: colored and underlined, not only on hover.
 * xterm has no per-range text style, so each visible link gets a decoration (foreground color plus
 * an underline drawn by its element). Only the viewport is scanned, again whenever its text changes.
 */
import type { IDecoration, IDisposable, Terminal } from '@xterm/xterm';
import { findFilePaths, logicalLine } from './fileLinks';

export const LINK_COLOR = '#60a5fa';

const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>]+/gi;
// Trailing sentence punctuation and closing brackets/quotes are not part of a URL
const URL_TAIL = /[.,;:!?)\]}'"]+$/;

/** Link ranges in one logical line, string offsets, end exclusive, sorted */
export function findLinkRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(URL_TAIL, '');
    if (url.length > url.indexOf('://') + 3) ranges.push([m.index, m.index + url.length]);
  }
  for (const p of findFilePaths(text)) ranges.push([p.start, p.end]);
  return ranges.sort((a, b) => a[0] - b[0]);
}

export function styleTerminalLinks(terminal: Terminal): IDisposable {
  let decorations: IDecoration[] = [];
  let signature = '';
  let frame = 0;

  const clear = () => {
    for (const d of decorations) d.dispose();
    decorations = [];
  };

  const decorate = (row: number, x: number, width: number, cursor: number) => {
    const marker = terminal.registerMarker(row - cursor);
    if (!marker) return;
    const decoration = terminal.registerDecoration({
      marker,
      x,
      width,
      foregroundColor: LINK_COLOR,
      layer: 'top',
    });
    if (!decoration) return marker.dispose();
    decoration.onRender((el) => {
      el.style.borderBottom = `1px solid ${LINK_COLOR}`;
      el.style.boxSizing = 'border-box';
      el.style.pointerEvents = 'none'; // clicks and hover stay with the link providers
    });
    decoration.onDispose(() => marker.dispose());
    decorations.push(decoration);
  };

  const scan = () => {
    frame = 0;
    const buffer = terminal.buffer.active;
    const top = buffer.viewportY;
    const bottom = top + terminal.rows;
    const rows: string[] = [];
    for (let y = top; y < bottom; y++) rows.push(buffer.getLine(y)?.translateToString(true) ?? '');
    // Decorations trigger a render themselves: only redo them when the visible text moved or changed
    const next = `${buffer.type}|${top}|${rows.join('\n')}`;
    if (next === signature) return;
    signature = next;
    clear();
    const cursor = buffer.baseY + buffer.cursorY;
    const seen = new Set<number>();
    for (let y = top; y < bottom; y++) {
      const { text, cells, start } = logicalLine(terminal, y);
      if (seen.has(start)) continue;
      seen.add(start);
      for (const [from, to] of findLinkRanges(text)) {
        // one decoration per row the link covers (soft-wrapped links)
        for (let i = from; i < to; ) {
          const [x, row] = cells[i];
          let j = i;
          while (j + 1 < to && cells[j + 1][1] === row) j++;
          if (row >= top && row < bottom) decorate(row, x, cells[j][0] - x + 1, cursor);
          i = j + 1;
        }
      }
    }
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(scan);
  };
  const subs = [
    terminal.onRender(schedule),
    terminal.onScroll(schedule),
    terminal.onResize(schedule),
  ];
  schedule();
  return {
    dispose: () => {
      if (frame) cancelAnimationFrame(frame);
      subs.forEach((s) => s.dispose());
      clear();
    },
  };
}
