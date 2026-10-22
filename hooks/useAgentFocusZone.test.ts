import { describe, it, expect } from 'vitest';
import { focusChord, zoneOf } from './useAgentFocusZone';

const key = (key: string, mods: Partial<KeyboardEvent> = {}) => ({
  key,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe('zoneOf', () => {
  const el = (match: string) => ({ closest: (s: string) => (s.includes(match) ? {} : null) });
  it('maps xterm to terminal, dialogs to palette, the rest to rail', () => {
    expect(zoneOf(el('.xterm'))).toBe('terminal');
    expect(zoneOf(el('role="dialog"'))).toBe('palette');
    expect(zoneOf(el('nothing'))).toBe('rail');
    expect(zoneOf(null)).toBe('rail');
    expect(zoneOf(el('nothing'), { contains: () => false })).toBe('other');
    expect(zoneOf(el('nothing'), { contains: () => true })).toBe('rail');
  });
});

describe('focusChord', () => {
  it('recognises F6 and Ctrl+Alt+arrows', () => {
    expect(focusChord(key('F6'))).toBe('toggle');
    expect(focusChord(key('F6', { shiftKey: true }))).toBe('toggle');
    expect(focusChord(key('ArrowLeft', { ctrlKey: true, altKey: true }))).toBe('rail');
    expect(focusChord(key('ArrowRight', { ctrlKey: true, altKey: true }))).toBe('terminal');
  });
  it('ignores everything else', () => {
    expect(focusChord(key('ArrowLeft'))).toBeNull();
    expect(focusChord(key('F6', { ctrlKey: true }))).toBeNull();
    expect(focusChord(key('Escape'))).toBeNull();
  });
});
