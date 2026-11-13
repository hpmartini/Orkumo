import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';

const navigatorProto = Object.getPrototypeOf(window.navigator);
const platform = Object.getOwnPropertyDescriptor(navigatorProto, 'platform');
afterEach(() => {
  cleanup();
  if (platform) Object.defineProperty(navigatorProto, 'platform', platform);
  document.body.innerHTML = '';
});

function setup(mac: boolean) {
  Object.defineProperty(navigatorProto, 'platform', {
    configurable: true,
    get: () => (mac ? 'MacIntel' : 'Linux x86_64'),
  });
  const openSettings = vi.fn();
  renderHook(() =>
    useKeyboardShortcuts({
      shortcuts: null,
      actions: [
        { id: 'openSettings', handler: openSettings },
        { id: 'openSettingsAlt', handler: openSettings },
      ],
    })
  );
  return openSettings;
}

const press = (target: HTMLElement, init: ConstructorParameters<typeof KeyboardEvent>[1]) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

/** A terminal's focus target: xterm's hidden textarea inside `.xterm` */
function terminalTextarea() {
  const xterm = document.createElement('div');
  xterm.className = 'xterm';
  const textarea = document.createElement('textarea');
  xterm.appendChild(textarea);
  document.body.appendChild(xterm);
  return textarea;
}

describe('useKeyboardShortcuts', () => {
  it('opens the settings with Cmd+, also while a terminal or the composer has focus (macOS)', () => {
    const openSettings = setup(true);
    const event = press(terminalTextarea(), { key: ',', metaKey: true });
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves plain keys to a focused text field', () => {
    const openSettings = setup(true);
    const input = document.createElement('input');
    document.body.appendChild(input);
    press(input, { key: 's' });
    expect(openSettings).not.toHaveBeenCalled();
    press(document.body, { key: 's' });
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('off macOS leaves Ctrl chords to a terminal (readline), fires them elsewhere', () => {
    const openSettings = setup(false);
    press(terminalTextarea(), { key: ',', ctrlKey: true });
    expect(openSettings).not.toHaveBeenCalled();
    const input = document.createElement('input');
    document.body.appendChild(input);
    press(input, { key: ',', ctrlKey: true });
    expect(openSettings).toHaveBeenCalledTimes(1);
  });
});
