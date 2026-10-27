import type { Terminal } from '@xterm/xterm';

export type TerminalKeyAction = { type: 'input'; data: string } | { type: 'close-tab' };

type KeyLike = Pick<KeyboardEvent, 'type' | 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>;

/**
 * macOS editing shortcuts xterm.js does not map itself (same bytes as iTerm's
 * "Natural Text Editing"), plus Shift+Enter for Claude Code. null: xterm handles the key.
 */
export function terminalKeyAction(e: KeyLike): TerminalKeyAction | null {
  if (e.type !== 'keydown') return null;
  const only = (mod: 'shiftKey' | 'altKey' | 'metaKey') =>
    (['shiftKey', 'altKey', 'ctrlKey', 'metaKey'] as const).every((m) => e[m] === (m === mod));

  // CSI u encoding of Shift+Enter: newline in the Claude Code prompt
  if (e.key === 'Enter' && only('shiftKey')) return { type: 'input', data: '\x1b[13;2u' };
  // Ctrl+W: delete the word before the cursor
  if (e.key === 'Backspace' && only('altKey')) return { type: 'input', data: '\x17' };
  // Ctrl+U: delete to the start of the line
  if (e.key === 'Backspace' && only('metaKey')) return { type: 'input', data: '\x15' };
  if (e.key.toLowerCase() === 'w' && only('metaKey')) return { type: 'close-tab' };
  return null;
}

/**
 * Install the shortcuts on a terminal. Callbacks are read at key time, so pass
 * functions that resolve the current socket / tab (xterm keeps only one handler).
 */
export function attachTerminalKeys(
  terminal: Terminal,
  send: (data: string) => void,
  closeTab: () => void,
  passThrough: (e: KeyboardEvent) => boolean = () => true
): void {
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') {
      // xterm also runs the handler for keypress/keyup; a keypress let through after a
      // mapped keydown makes xterm send the plain key too (Shift+Enter would add `\r`
      // and submit the Claude Code prompt)
      const { key, shiftKey, altKey, ctrlKey, metaKey } = event;
      const mapped = terminalKeyAction({
        type: 'keydown',
        key,
        shiftKey,
        altKey,
        ctrlKey,
        metaKey,
      });
      return mapped ? false : passThrough(event);
    }
    const action = terminalKeyAction(event);
    if (!action) return passThrough(event);
    // keeps Electron/the browser from acting on Cmd+W and Backspace chords
    event.preventDefault();
    if (action.type === 'input') send(action.data);
    else closeTab();
    return false;
  });
}
