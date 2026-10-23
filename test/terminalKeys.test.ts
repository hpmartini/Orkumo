import { describe, it, expect } from 'vitest';
import { terminalKeyAction } from '../utils/terminalKeys';

const key = (
  k: string,
  mods: Partial<Record<'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey', boolean>> = {},
  type = 'keydown'
) => ({
  type,
  key: k,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});

describe('terminalKeyAction', () => {
  it('maps the macOS editing shortcuts to readline bytes', () => {
    expect(terminalKeyAction(key('Backspace', { altKey: true }))).toEqual({
      type: 'input',
      data: '\x17',
    });
    expect(terminalKeyAction(key('Backspace', { metaKey: true }))).toEqual({
      type: 'input',
      data: '\x15',
    });
    expect(terminalKeyAction(key('Enter', { shiftKey: true }))).toEqual({
      type: 'input',
      data: '\x1b[13;2u',
    });
  });

  it('closes the tab on Cmd+W only', () => {
    expect(terminalKeyAction(key('w', { metaKey: true }))).toEqual({ type: 'close-tab' });
    expect(terminalKeyAction(key('W', { metaKey: true }))).toEqual({ type: 'close-tab' });
    // Ctrl+W is the shell's own word delete
    expect(terminalKeyAction(key('w', { ctrlKey: true }))).toBeNull();
    expect(terminalKeyAction(key('w', { metaKey: true, shiftKey: true }))).toBeNull();
  });

  it('leaves everything else to xterm', () => {
    expect(terminalKeyAction(key('a'))).toBeNull();
    expect(terminalKeyAction(key('Backspace'))).toBeNull();
    expect(terminalKeyAction(key('Enter'))).toBeNull();
    expect(terminalKeyAction(key('@', { altKey: true }))).toBeNull(); // Option+L on a German layout
    expect(terminalKeyAction(key('Backspace', { altKey: true, metaKey: true }))).toBeNull();
    expect(terminalKeyAction(key('Backspace', { altKey: true }, 'keyup'))).toBeNull();
  });
});
