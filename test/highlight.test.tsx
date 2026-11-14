import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { highlight, MAX_HIGHLIGHT_CHARS, type Token } from '../utils/highlight';
import { ChatMarkdown } from '../components/AgentsView/Chat/ChatMarkdown';

const kinds = (tokens: Token[]) => tokens.filter((t) => t.kind).map((t) => [t.kind, t.text]);

describe('highlight (#19 AK-8)', () => {
  it('colours keywords, strings, numbers, comments and types of TypeScript', () => {
    const tokens = highlight('const a: Foo = "x"; // note\nreturn 42;', 'ts');
    expect(kinds(tokens)).toEqual([
      ['keyword', 'const'],
      ['type', 'Foo'],
      ['string', '"x"'],
      ['comment', '// note'],
      ['keyword', 'return'],
      ['number', '42'],
    ]);
    // the tokens are the code, nothing lost or added
    expect(tokens.map((t) => t.text).join('')).toBe('const a: Foo = "x"; // note\nreturn 42;');
  });

  it('knows python, shell, json, sql and diffs', () => {
    expect(kinds(highlight('def f():\n    return None  # done', 'python'))).toEqual([
      ['keyword', 'def'],
      ['keyword', 'return'],
      ['literal', 'None'],
      ['comment', '# done'],
    ]);
    expect(kinds(highlight('echo "$HOME" # hi', 'bash'))).toEqual([
      ['keyword', 'echo'],
      ['string', '"$HOME"'],
      ['comment', '# hi'],
    ]);
    expect(kinds(highlight('{"a": 1, "b": true}', 'json'))).toEqual([
      ['attr', '"a"'],
      ['number', '1'],
      ['attr', '"b"'],
      ['literal', 'true'],
    ]);
    expect(kinds(highlight('SELECT * FROM t -- all', 'sql'))).toEqual([
      ['keyword', 'SELECT'],
      ['keyword', 'FROM'],
      ['comment', '-- all'],
    ]);
    expect(kinds(highlight('@@ -1 +1 @@\n-old\n+new\n', 'diff'))).toEqual([
      ['meta', '@@ -1 +1 @@\n'],
      ['removed', '-old\n'],
      ['added', '+new\n'],
    ]);
  });

  it('leaves unknown languages and huge blocks plain', () => {
    expect(highlight('const x = 1', 'brainfuck')).toEqual([{ text: 'const x = 1', kind: null }]);
    expect(highlight('const x = 1', undefined)).toEqual([{ text: 'const x = 1', kind: null }]);
    const big = 'a'.repeat(MAX_HIGHLIGHT_CHARS + 1);
    expect(highlight(big, 'ts')).toEqual([{ text: big, kind: null }]);
  });

  it('an unterminated string or comment runs to the end without hanging', () => {
    expect(kinds(highlight('x = "open', 'js'))).toEqual([['string', '"open']]);
    expect(kinds(highlight('/* open', 'js'))).toEqual([['comment', '/* open']]);
  });

  it('ChatMarkdown renders fenced code with highlighted tokens', () => {
    const { container } = render(<ChatMarkdown text={'```js\nconst s = "hi";\n```'} />);
    const tokens = [...container.querySelectorAll('[data-token]')].map((el) => [
      el.getAttribute('data-token'),
      el.textContent,
    ]);
    expect(tokens).toEqual([
      ['keyword', 'const'],
      ['string', '"hi"'],
    ]);
    expect(container.querySelector('pre')?.textContent).toBe('const s = "hi";');
  });
});
