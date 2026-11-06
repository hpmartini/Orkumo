import { describe, expect, it } from 'vitest';
import {
  browseHistory,
  chatSuggestions,
  continueList,
  historyStep,
  homeKey,
  indentList,
  splitImages,
  suggestionQuery,
} from '../utils/chatComposer';

describe('homeKey', () => {
  const text = 'one\ntwo\nthree';
  it('goes to the start of the line, then to the start of the line above', () => {
    expect(homeKey(text, 10)).toBe(8);
    expect(homeKey(text, 8)).toBe(4);
    expect(homeKey(text, 4)).toBe(0);
  });
  it('stays at 0 on the first line start (never loads history)', () => {
    expect(homeKey(text, 0)).toBeNull();
    expect(homeKey(text, 2)).toBe(0);
  });
});

describe('continueList', () => {
  it('continues a bullet with the same indent', () => {
    expect(continueList('  - a', 5)).toEqual({ value: '  - a\n  - ', caret: 10 });
  });
  it('increments numbered items and keeps task boxes', () => {
    expect(continueList('1. a', 4)?.value).toBe('1. a\n2. ');
    expect(continueList('- [x] a', 7)?.value).toBe('- [x] a\n- [ ] ');
  });
  it('ends the list on an empty item', () => {
    expect(continueList('- a\n- ', 6)).toEqual({ value: '- a\n', caret: 4 });
  });
  it('leaves plain lines alone', () => {
    expect(continueList('hello', 5)).toBeNull();
  });
});

describe('indentList', () => {
  it('indents a bullet line by 2 and outdents by up to 2', () => {
    expect(indentList('- a', 3, false)).toEqual({ value: '  - a', caret: 5 });
    expect(indentList('    - a', 7, true)).toEqual({ value: '  - a', caret: 5 });
    expect(indentList(' - a', 4, true)).toEqual({ value: '- a', caret: 3 });
  });
  it('keeps Tab for focus outside lists', () => {
    expect(indentList('text', 2, false)).toBeNull();
  });
});

describe('history', () => {
  it('only steps from the first / last line', () => {
    expect(historyStep('a\nb', 1, 'up')).toBe(true);
    expect(historyStep('a\nb', 3, 'up')).toBe(false);
    expect(historyStep('a\nb', 1, 'down')).toBe(false);
  });
  it('walks from the newest message and back to the draft', () => {
    const h = ['first', 'second'];
    expect(browseHistory(h, -1, 'draft', 'up')).toEqual({ index: 0, text: 'second' });
    expect(browseHistory(h, 0, 'draft', 'up')).toEqual({ index: 1, text: 'first' });
    expect(browseHistory(h, 1, 'draft', 'up')).toBeNull();
    expect(browseHistory(h, 0, 'draft', 'down')).toEqual({ index: -1, text: 'draft' });
    expect(browseHistory(h, -1, 'draft', 'down')).toBeNull();
  });
});

describe('suggestions', () => {
  it('opens on / at a line start and on @ anywhere', () => {
    expect(suggestionQuery('/com', 4)).toEqual({ trigger: '/', query: 'com', start: 0 });
    expect(suggestionQuery('see @src/ut', 11)).toEqual({ trigger: '@', query: 'src/ut', start: 4 });
    expect(suggestionQuery('a/b', 3)).toBeNull();
    expect(suggestionQuery('mail@x', 6)).toBeNull();
  });
  it('ranks prefix matches before substring and description matches', () => {
    const ctx = {
      commands: [
        { name: 'review', description: 'compact the diff' },
        { name: 'compact', description: 'free context', argumentHint: '<instructions>' },
        { name: 'autocompact', description: '' },
      ],
      agents: [{ name: 'reviewer', description: 'reviews' }],
      files: ['src/review.ts'],
    };
    expect(chatSuggestions('/', 'compact', ctx).map((s) => s.label)).toEqual([
      '/compact',
      '/autocompact',
      '/review',
    ]);
    expect(chatSuggestions('/', 'compact', ctx)[0].hint).toBe('<instructions>');
    expect(chatSuggestions('@', 'review', ctx).map((s) => s.insert)).toEqual([
      '@src/review.ts ',
      '@agent-reviewer ',
    ]);
  });
});

describe('splitImages', () => {
  it('separates appended image lines from the text', () => {
    expect(splitImages('look\n[Image: /d/agent-images/a.png]')).toEqual({
      text: 'look',
      images: ['/d/agent-images/a.png'],
    });
  });
});
