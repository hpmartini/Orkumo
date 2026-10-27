import { describe, it, expect } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { attachTerminalKeys, terminalKeyAction } from '../utils/terminalKeys';

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

describe('attachTerminalKeys', () => {
  const install = () => {
    let handler: (e: KeyboardEvent) => boolean = () => true;
    const terminal = {
      attachCustomKeyEventHandler: (fn: typeof handler) => {
        handler = fn;
      },
    } as unknown as Terminal;
    const sent: string[] = [];
    attachTerminalKeys(
      terminal,
      (d) => sent.push(d),
      () => {}
    );
    return { press: (e: KeyboardEvent) => handler(e), sent };
  };
  const event = (type: string, k: string, mods = {}) =>
    ({ ...key(k, mods, type), preventDefault: () => {} }) as unknown as KeyboardEvent;

  it('sends Shift+Enter once and swallows its keypress, so xterm adds no \\r', () => {
    const { press, sent } = install();
    expect(press(event('keydown', 'Enter', { shiftKey: true }))).toBe(false);
    expect(press(event('keypress', 'Enter', { shiftKey: true }))).toBe(false);
    expect(press(event('keyup', 'Enter', { shiftKey: true }))).toBe(false);
    expect(sent).toEqual(['\x1b[13;2u']);
  });

  it('lets plain Enter and typing through to xterm', () => {
    const { press, sent } = install();
    expect(press(event('keydown', 'Enter'))).toBe(true);
    expect(press(event('keypress', 'Enter'))).toBe(true);
    expect(press(event('keypress', 'a'))).toBe(true);
    expect(sent).toEqual([]);
  });
});
