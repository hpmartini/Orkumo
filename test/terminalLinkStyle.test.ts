import { describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { findLinkRanges, styleTerminalLinks } from '../utils/terminalLinkStyle';

const pick = (text: string) => findLinkRanges(text).map(([s, e]) => text.slice(s, e));

describe('findLinkRanges', () => {
  it('URLs without trailing punctuation, file paths with line and column', () => {
    expect(
      pick('PR: https://github.com/hpmartini/Orkumo/pull/298. See (src/app.ts:12:3) and ~/x/y.md')
    ).toEqual(['https://github.com/hpmartini/Orkumo/pull/298', 'src/app.ts:12:3', '~/x/y.md']);
  });

  it('no bare scheme, no words with slashes', () => {
    expect(pick('http:// and/or nothing')).toEqual([]);
  });
});

describe('styleTerminalLinks', () => {
  // A single soft-wrapped line far taller than the viewport (e.g. a minified bundle or JSON dump)
  it('scans only around the viewport, not the whole wrapped line (renderer OOM on start)', () => {
    const total = 20_000;
    const cols = 200;
    const rows = 50;
    let reads = 0;
    const cell = { getChars: () => 'a', getWidth: () => 1 };
    const line = (y: number) =>
      y < 0 || y >= total
        ? undefined
        : {
            isWrapped: y > 0,
            length: cols,
            getCell: () => {
              if (++reads > 1_000_000) throw new Error('scanned the whole wrapped line');
              return cell;
            },
            translateToString: () => 'a'.repeat(cols),
          };
    const frames: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => frames.push(fn));
    const sub = { dispose() {} };
    const term = {
      rows,
      buffer: {
        active: {
          type: 'normal',
          viewportY: total - rows,
          baseY: total - rows,
          cursorY: rows - 1,
          getLine: line,
          getNullCell: () => cell,
        },
      },
      onRender: () => sub,
      onScroll: () => sub,
      onResize: () => sub,
    } as unknown as Terminal;
    styleTerminalLinks(term);
    frames.shift()!();
    expect(reads).toBeLessThanOrEqual(3 * rows * cols);
    vi.unstubAllGlobals();
  });
});
