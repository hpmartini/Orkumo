import { Terminal } from '@xterm/xterm';

// eslint-disable-next-line no-control-regex
const CUP_RE = /\x1b\[(\d+)(?:;(\d+))?[Hf]/g;
// eslint-disable-next-line no-control-regex
const CHA_RE = /\x1b\[(\d+)G/g;

/** Smallest screen that holds every absolute cursor target, so nothing wraps or clamps. */
function screenSize(raw: string): { cols: number; rows: number } {
  let cols = 200;
  let rows = 50;
  for (const m of raw.matchAll(CUP_RE)) {
    rows = Math.max(rows, Number(m[1]));
    if (m[2]) cols = Math.max(cols, Number(m[2]));
  }
  for (const m of raw.matchAll(CHA_RE)) cols = Math.max(cols, Number(m[1]));
  return { cols: Math.min(cols + 20, 1000), rows: Math.min(rows, 500) };
}

/**
 * Plays a raw TUI stream (`claude logs`: cursor jumps instead of spaces, partial redraws)
 * through a terminal emulator and returns the final screen as plain text lines.
 */
export async function renderTerminalScreen(raw: string): Promise<string> {
  const term = new Terminal({ ...screenSize(raw), scrollback: 2000, allowProposedApi: true });
  try {
    await new Promise<void>((resolve) => term.write(raw, resolve));
    const buffer = term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++)
      lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    while (lines.length && !lines[0].trim()) lines.shift();
    return lines.join('\n');
  } finally {
    term.dispose();
  }
}

/** Minimal xterm view `promptSuggestion` reads (the pane's live terminal) */
type ScreenTerminal = Pick<Terminal, 'rows' | 'cols'> & {
  buffer: { active: Pick<Terminal['buffer']['active'], 'viewportY' | 'getLine'> };
};

/** Claude Code's input line: the lowest `❯` row on screen and the column of its `❯` */
function inputRow(terminal: ScreenTerminal) {
  const buffer = terminal.buffer.active;
  for (let y = buffer.viewportY + terminal.rows - 1; y >= buffer.viewportY; y--) {
    const line = buffer.getLine(y);
    if (!line) continue;
    const marker = line.translateToString(true).search(/\S/);
    if (marker >= 0 && line.translateToString(true)[marker] === '❯') return { buffer, y, marker };
  }
  return null;
}

/** Text of row `y` from column `from`, and whether any of it is dim (ghost) or plain (typed) */
function rowText(terminal: ScreenTerminal, y: number, from: number) {
  const line = terminal.buffer.active.getLine(y);
  let text = '';
  let dim = false;
  let typed = false;
  for (let x = from; x < terminal.cols; x++) {
    const cell = line?.getCell(x);
    const chars = cell?.getChars() ?? '';
    if (!chars.trim()) {
      text += ' ';
      continue;
    }
    if (cell?.isDim()) dim = true;
    else typed = true;
    text += chars;
  }
  return { text: text.trim(), dim, typed };
}

/**
 * Claude Code's prompt suggestion: grey (dim) ghost text in its empty input line `❯ …`, the
 * lowest `❯` row on screen. null when the line holds typed text or nothing. `truncated`: the TUI
 * cut it at the pane's width with `…` (the rest is nowhere on screen, see `promptInput`).
 */
export function promptSuggestion(
  terminal: ScreenTerminal
): { text: string; truncated: boolean } | null {
  const row = inputRow(terminal);
  if (!row) return null;
  const { text, typed } = rowText(terminal, row.y, row.marker + 1);
  // typed by the user; the empty input's own hint is no suggestion
  if (typed || !text || /^Try "/.test(text)) return null;
  const truncated = text.endsWith('…');
  return { text: truncated ? text.slice(0, -1).trimEnd() : text, truncated };
}

/**
 * The text typed into Claude Code's input, over all rows it wraps to (indented below the `❯`
 * row). null for an empty input or one that shows a suggestion.
 */
export function promptInput(terminal: ScreenTerminal): string | null {
  const row = inputRow(terminal);
  if (!row) return null;
  const first = rowText(terminal, row.y, row.marker + 1);
  if (first.dim || !first.text) return null;
  const parts = [first.text];
  for (let y = row.y + 1; y < row.buffer.viewportY + terminal.rows; y++) {
    const line = row.buffer.getLine(y)?.translateToString(true) ?? '';
    // a wrapped row is indented past the marker; the box's border or the status starts left of it
    if (line.search(/\S/) < row.marker + 2) break;
    const next = rowText(terminal, y, row.marker + 1);
    if (next.dim) break;
    // shortcut: the TUI wraps at word boundaries, so rows join with a space; a single word longer
    // than the pane gets a stray space at its break
    parts.push(next.text);
  }
  return parts.join(' ');
}
