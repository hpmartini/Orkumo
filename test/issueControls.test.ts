import { describe, expect, it } from 'vitest';
import {
  currentMode,
  insertIntoDraft,
  quoteComment,
  replyText,
  setMode,
  startText,
  toggleLabel,
} from '../utils/issueControls';

const comment = { author: 'hpmartini', body: 'Zeile 1\n\nZeile 3\n', url: 'https://x/c1' };

describe('toggleLabel', () => {
  it('adds without touching the other labels', () => {
    expect(toggleLabel(['bug', 'wf:go'], 'wf:build', true)).toEqual(['bug', 'wf:go', 'wf:build']);
  });
  it('removes only the label', () => {
    expect(toggleLabel(['bug', 'wf:build', 'x'], 'wf:build', false)).toEqual(['bug', 'x']);
  });
  it('does not duplicate', () => {
    expect(toggleLabel(['wf:go'], 'wf:go', true)).toEqual(['wf:go']);
  });
});

const modes = {
  options: [
    { text: 'Default', label: null },
    { text: 'Image', label: 'wf:image' },
  ],
  drop: ['wf:old-a', 'wf:old-b'],
};

describe('mode labels', () => {
  it('reads default without mode label', () => {
    expect(currentMode(['bug', 'wf:go'], modes)).toBeNull();
    expect(currentMode(['wf:image'], modes)).toBe('wf:image');
    // dropped labels are no mode
    expect(currentMode(['wf:old-b'], modes)).toBeNull();
  });
  it('sets exactly one mode label and keeps the rest', () => {
    expect(setMode(['bug', 'wf:old-a', 'wf:dynamic'], modes, 'wf:image')).toEqual([
      'bug',
      'wf:dynamic',
      'wf:image',
    ]);
    expect(setMode(['bug', 'wf:image'], modes, null)).toEqual(['bug']);
  });
  it('drops the listed labels on any mode change', () => {
    expect(setMode(['wf:old-b', 'wf:old-a', 'x'], modes, null)).toEqual(['x']);
    expect(setMode(['wf:old-b'], modes, 'wf:image')).toEqual(['wf:image']);
  });
});

describe('comment quoting', () => {
  it('quotes every line with attribution', () => {
    expect(quoteComment(comment)).toBe(
      '> **@hpmartini** [schrieb](https://x/c1):\n>\n> Zeile 1\n>\n> Zeile 3\n\n'
    );
  });
  it('drops workflow markers (HTML comments) from the quote', () => {
    const q = quoteComment({ ...comment, body: 'Text\n\n<!-- wf:start session=x -->' });
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

describe('startText (AC-4)', () => {
  it('started, queued, no slot, other reason', () => {
    expect(startText({ action: 'start', reason: 'x' })).toBe('gestartet');
    expect(startText({ action: 'resume', reason: 'x' })).toBe('gestartet');
    expect(startText({ action: 'queued', reason: 'mit dem nächsten Poll' })).toBe(
      'mit dem nächsten Poll'
    );
    expect(startText({ action: 'queued', reason: '' })).toBe('startet später');
    expect(startText({ action: 'none', reason: 'kein Platz frei (2/4)', full: true })).toBe(
      'kein Platz frei (2/4), startet, sobald einer frei wird'
    );
    expect(startText({ action: 'none', reason: 'nichts freigegeben' })).toBe('nichts freigegeben');
    expect(startText({ action: 'none', reason: '' })).toBe('nicht gestartet');
  });
});
