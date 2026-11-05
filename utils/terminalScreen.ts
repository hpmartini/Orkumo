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
