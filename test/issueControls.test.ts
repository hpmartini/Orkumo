import { describe, expect, it } from 'vitest';
import {
  DELEGATE_LABEL,
  REVIEW_LABEL,
  currentMode,
  insertIntoDraft,
  quoteComment,
  replyText,
  setMode,
  toggleLabel,
} from '../utils/issueControls';

const comment = { author: 'hpmartini', body: 'Zeile 1\n\nZeile 3\n', url: 'https://x/c1' };

describe('toggleLabel', () => {
  it('adds without touching the other labels', () => {
    expect(toggleLabel(['bug', 'mw:go'], 'mw:build', true)).toEqual(['bug', 'mw:go', 'mw:build']);
  });
  it('removes only the label', () => {
    expect(toggleLabel(['bug', 'mw:build', 'x'], 'mw:build', false)).toEqual(['bug', 'x']);
  });
  it('does not duplicate', () => {
    expect(toggleLabel(['mw:go'], 'mw:go', true)).toEqual(['mw:go']);
  });
});

describe('mode labels', () => {
  it('reads default without mode label', () => {
    expect(currentMode(['bug', 'mw:go'])).toBe('default');
    expect(currentMode(['mw:image'])).toBe('image');
    // mw 6 labels are no mode any more (#136)
    expect(currentMode(['mw:pipeline'])).toBe('default');
  });
  it('sets exactly one mode label and keeps the rest', () => {
    expect(setMode(['bug', 'mw:orchestrate', 'mw:dynamic'], 'image')).toEqual([
      'bug',
      'mw:dynamic',
      'mw:image',
    ]);
    expect(setMode(['bug', 'mw:image'], 'default')).toEqual(['bug']);
  });
  it('drops legacy mw 6 mode labels on any mode change', () => {
    expect(setMode(['mw:pipeline', 'mw:orchestrate', 'x'], 'default')).toEqual(['x']);
    expect(setMode(['mw:pipeline'], 'image')).toEqual(['mw:image']);
  });
  it('toggles the delegate and review switches', () => {
    expect(toggleLabel(['mw:go'], DELEGATE_LABEL, true)).toEqual(['mw:go', 'mw:delegate']);
    expect(toggleLabel(['mw:review', 'x'], REVIEW_LABEL, false)).toEqual(['x']);
  });
});

describe('comment quoting', () => {
  it('quotes every line with attribution', () => {
    expect(quoteComment(comment)).toBe(
      '> **@hpmartini** [schrieb](https://x/c1):\n>\n> Zeile 1\n>\n> Zeile 3\n\n'
    );
  });
  it('drops mw-board markers (HTML comments) from the quote', () => {
    const q = quoteComment({ ...comment, body: 'Text\n\n<!-- mw-board:start session=x -->' });
    expect(q).toBe('> **@hpmartini** [schrieb](https://x/c1):\n>\n> Text\n\n');
  });
  it('reply quotes and mentions the author', () => {
    const r = replyText(comment);
    expect(r.startsWith(quoteComment(comment))).toBe(true);
    expect(r.endsWith('@hpmartini ')).toBe(true);
  });
  it('appends to a non-empty draft', () => {
    expect(insertIntoDraft('', 'Q')).toBe('Q');
    expect(insertIntoDraft('Hallo  \n', 'Q')).toBe('Hallo\n\nQ');
  });
});
