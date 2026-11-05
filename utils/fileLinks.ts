/**
 * File paths in terminal output as Cmd/Ctrl-clickable links (#188).
 * Detection is pure; the xterm link provider maps matches back to buffer cells (wide chars, soft wraps).
 */
import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm';

export interface FilePathMatch {
  /** String offsets in the scanned text, end exclusive, `:line:col` included */
  start: number;
  end: number;
  path: string;
  line?: number;
  col?: number;
}

// Characters a path may contain unquoted; `:` ends it so `file:12:3` and `https://` split cleanly
const C = String.raw`[^\s'"\`()<>\[\]{}|;,:*?]`;
// Boundary before a path: start, whitespace, quote, bracket or `=` (`--out=/x`); not `:` so URLs never match
const UNQUOTED = new RegExp(
  String.raw`(?<=^|[\s'"\`(\[<=])((?:~|\.{1,2})?\/${C}+|${C}+\/${C}*)(?::(\d+)(?::(\d+))?)?`,
  'g'
);
// Quoted paths may contain spaces, but must start like a path
const QUOTED = /(["'`])((?:~|\.{1,2})?\/[^"'`\n]+?)\1/g;
const URL_RE = /[a-z][a-z0-9+.-]*:\/\/\S+/gi;

export function findFilePaths(text: string): FilePathMatch[] {
  const taken: Array<[number, number]> = [];
  for (const m of text.matchAll(URL_RE)) taken.push([m.index, m.index + m[0].length]);
  const free = (start: number, end: number) => !taken.some(([s, e]) => start < e && end > s);
  const result: FilePathMatch[] = [];

  for (const m of text.matchAll(QUOTED)) {
    const start = m.index + 1;
    const end = start + m[2].length;
    if (!free(start, end)) continue;
    taken.push([start, end]);
    result.push({ start, end, path: m[2] });
  }

  for (const m of text.matchAll(UNQUOTED)) {
    let path = m[1];
    const start = m.index;
    if (!free(start, start + m[0].length)) continue;
    // trailing sentence punctuation is not part of the path
    const hasPos = m[2] !== undefined;
    if (!hasPos) path = path.replace(/\.+$/, '');
    if (path === '/' || path === '~/' || /^\.{1,2}\/$/.test(path)) continue;
    // bare relative paths (src/x.ts) need an extension, otherwise "and/or" would be a link
    if (!/^(~|\.{1,2})?\//.test(path) && !/\/[^/]*\.\w+$/.test(path)) continue;
    const end = hasPos ? start + m[0].length : start + path.length;
    result.push({
      start,
      end,
      path,
      line: hasPos ? Number(m[2]) : undefined,
      col: m[3] !== undefined ? Number(m[3]) : undefined,
    });
  }
  return result.sort((a, b) => a.start - b.start);
}

/** Wrapped rows around `y` (0-based) joined into one string, with each char's cell position */
function logicalLine(terminal: Terminal, y: number) {
  const buffer = terminal.buffer.active;
  let top = y;
  while (top > 0 && buffer.getLine(top)?.isWrapped) top--;
  let text = '';
  const cells: Array<[number, number]> = [];
  const cell = buffer.getNullCell();
  for (let row = top; ; row++) {
    const line = buffer.getLine(row);
    if (!line || (row > top && !line.isWrapped)) break;
    for (let x = 0; x < line.length; x++) {
      line.getCell(x, cell);
      if (cell.getWidth() === 0) continue; // right half of a wide char
      const chars = cell.getChars() || ' ';
      for (let i = 0; i < chars.length; i++) cells.push([x, row]);
      text += chars;
    }
  }
  return { text, cells };
}

/** Link provider for file paths; `activate` gets the click and the match */
export function createFileLinkProvider(
  terminal: Terminal,
  activate: (event: MouseEvent, match: FilePathMatch) => void
): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const { text, cells } = logicalLine(terminal, y - 1);
      const links: ILink[] = findFilePaths(text)
        .map((match) => {
          const [sx, sy] = cells[match.start];
          const [ex, ey] = cells[match.end - 1];
          return {
            // 1-based, end inclusive
            range: { start: { x: sx + 1, y: sy + 1 }, end: { x: ex + 1, y: ey + 1 } },
            text: text.slice(match.start, match.end),
            activate: (event: MouseEvent) => activate(event, match),
          };
        })
        .filter((link) => link.range.start.y <= y && link.range.end.y >= y);
      callback(links.length ? links : undefined);
    },
  };
}
