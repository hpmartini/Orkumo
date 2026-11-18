import { describe, it, expect } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { findFilePaths, createFileLinkProvider } from '../utils/fileLinks';

const paths = (text: string) => findFilePaths(text).map((m) => m.path);

describe('findFilePaths', () => {
  it('finds the path from the issue screenshot', () => {
    const p = '/Users/example/docs/2026-11-03_rechnung-entwurf_beispiel.pdf';
    const text = `- Wo: ${p}`;
    const [m] = findFilePaths(text);
    expect(m.path).toBe(p);
    expect(text.slice(m.start, m.end)).toBe(p);
  });

  it('finds ~/, ./, ../ and bare relative paths with an extension', () => {
    expect(paths('see ~/notes/todo.md and ./a/b and ../up/x.ts or src/utils/x.ts')).toEqual([
      '~/notes/todo.md',
      './a/b',
      '../up/x.ts',
      'src/utils/x.ts',
    ]);
  });

  it('reads :line and :line:col, keeping them out of the path', () => {
    const [m] = findFilePaths('error in components/App.tsx:12:3 here');
    expect(m).toMatchObject({ path: 'components/App.tsx', line: 12, col: 3 });
    const [n] = findFilePaths('/tmp/a.log:7');
    expect(n).toMatchObject({ path: '/tmp/a.log', line: 7, col: undefined, end: 12 });
  });

  it('drops trailing punctuation and surrounding brackets', () => {
    expect(paths('Saved to /tmp/out.png.')).toEqual(['/tmp/out.png']);
    expect(paths('(see /tmp/a.txt), then [./b.md]; done')).toEqual(['/tmp/a.txt', './b.md']);
  });

  it('accepts quoted paths with spaces', () => {
    expect(paths('open "/Users/hape/My Docs/a b.pdf" now')).toEqual([
      '/Users/hape/My Docs/a b.pdf',
    ]);
  });

  it('never treats URLs or prose as paths', () => {
    expect(paths('https://github.com/hpmartini/Orkumo/issues/188')).toEqual([]);
    expect(paths('visit http://localhost:3000/api/x.json now')).toEqual([]);
    expect(paths('and/or, km/h, 1/2, / alone, ~/ alone')).toEqual([]);
  });
});

/** Minimal xterm buffer: one string per row, `wrapped` marks soft-wrapped continuation rows */
function fakeTerminal(rows: Array<{ text: string; wrapped?: boolean }>, wide = new Set<string>()) {
  const toCells = (text: string) =>
    [...text].flatMap((ch) =>
      wide.has(ch)
        ? [
            { ch, w: 2 },
            { ch: '', w: 0 },
          ]
        : [{ ch, w: 1 }]
    );
  let current = { ch: '', w: 1 };
  const nullCell = { getChars: () => current.ch, getWidth: () => current.w };
  return {
    buffer: {
      active: {
        getNullCell: () => nullCell,
        getLine: (y: number) => {
          const row = rows[y];
          if (!row) return undefined;
          const cells = toCells(row.text);
          return {
            isWrapped: !!row.wrapped,
            length: cells.length,
            getCell: (x: number) => {
              current = cells[x];
              return nullCell;
            },
          };
        },
      },
    },
  } as unknown as Terminal;
}

const links = (term: Terminal, y: number) => {
  let out: unknown;
  createFileLinkProvider(term, () => {}).provideLinks(y, (l) => (out = l));
  return out as Array<{ text: string; range: unknown }> | undefined;
};

describe('createFileLinkProvider', () => {
  it('maps a path after a wide char to the right cells', () => {
    const term = fakeTerminal([{ text: '✅ /tmp/a.pdf' }], new Set(['✅']));
    const [link] = links(term, 1)!;
    expect(link.text).toBe('/tmp/a.pdf');
    // ✅ takes cells 1-2, the space cell 3, so the path starts at cell 4
    expect(link.range).toEqual({ start: { x: 4, y: 1 }, end: { x: 13, y: 1 } });
  });

  it('follows a path across a soft wrap from either row', () => {
    const term = fakeTerminal([{ text: 'x /Users/ha' }, { text: 'pe/a.pdf ok', wrapped: true }]);
    const expected = { start: { x: 3, y: 1 }, end: { x: 8, y: 2 } };
    expect(links(term, 1)?.[0]).toMatchObject({ text: '/Users/hape/a.pdf', range: expected });
    expect(links(term, 2)?.[0]).toMatchObject({ text: '/Users/hape/a.pdf', range: expected });
  });

  it('returns undefined for rows without paths', () => {
    expect(links(fakeTerminal([{ text: 'nothing here' }]), 1)).toBeUndefined();
  });
});
