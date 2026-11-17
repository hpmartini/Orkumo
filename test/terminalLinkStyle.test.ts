import { describe, expect, it } from 'vitest';
import { findLinkRanges } from '../utils/terminalLinkStyle';

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
