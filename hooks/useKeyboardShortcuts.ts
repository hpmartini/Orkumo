import { useEffect, useCallback, useMemo } from 'react';
import { KeyboardShortcut, KeyboardShortcuts, DEFAULT_KEYBOARD_SHORTCUTS } from '../types';

interface ShortcutAction {
  id: keyof KeyboardShortcuts;
  handler: () => void;
}

interface UseKeyboardShortcutsOptions {
  shortcuts: KeyboardShortcuts | null | undefined;
  actions: ShortcutAction[];
  enabled?: boolean;
}

/**
 * Format a shortcut for display (e.g., "⌘1" or "Ctrl+1")
 */
export function formatShortcut(shortcut: KeyboardShortcut): string {
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const parts: string[] = [];

  if (shortcut.modifiers?.ctrl) {
    parts.push(isMac ? '⌃' : 'Ctrl');
  }
  if (shortcut.modifiers?.alt) {
    parts.push(isMac ? '⌥' : 'Alt');
  }
  if (shortcut.modifiers?.shift) {
    parts.push(isMac ? '⇧' : 'Shift');
  }
  if (shortcut.modifiers?.meta) {
    parts.push(isMac ? '⌘' : 'Ctrl');
  }

  // Format the key
  let key = shortcut.key.toUpperCase();
  if (key === ' ') key = 'Space';

  parts.push(key);

  return isMac ? parts.join('') : parts.join('+');
}

/**
 * Check if a keyboard event matches a shortcut
 */
function matchesShortcut(event: KeyboardEvent, shortcut: KeyboardShortcut): boolean {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  // Check the key (case-insensitive)
  if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) {
    return false;
  }

  // Check modifiers
  const modifiers = shortcut.modifiers || {};

  // For meta/ctrl, we check both on Mac (cmd) and non-Mac (ctrl)
  const expectMeta = modifiers.meta || false;
  const expectCtrl = modifiers.ctrl || false;

  // On Mac, meta key is Cmd. On other platforms, we treat meta shortcuts as Ctrl
  if (isMac) {
    if (expectMeta && !event.metaKey) return false;
    if (!expectMeta && event.metaKey) return false;
    if (expectCtrl && !event.ctrlKey) return false;
    if (!expectCtrl && event.ctrlKey) return false;
  } else {
    // On non-Mac, both meta and ctrl shortcuts use Ctrl key
    const needsCtrl = expectMeta || expectCtrl;
    if (needsCtrl && !event.ctrlKey) return false;
    if (!needsCtrl && event.ctrlKey) return false;
  }

  if ((modifiers.alt || false) !== event.altKey) return false;
  if ((modifiers.shift || false) !== event.shiftKey) return false;

  return true;
}

/**
 * Hook to handle keyboard shortcuts globally
 */
export function useKeyboardShortcuts({
  shortcuts,
  actions,
  enabled = true,
}: UseKeyboardShortcutsOptions): void {
  // Merge stored shortcuts with defaults (stored shortcuts override defaults, but new defaults are added)
  const effectiveShortcuts = useMemo(() => {
    if (!shortcuts) return DEFAULT_KEYBOARD_SHORTCUTS;
    // Merge: defaults first, then override with stored shortcuts
    return { ...DEFAULT_KEYBOARD_SHORTCUTS, ...shortcuts };
  }, [shortcuts]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Don't trigger shortcuts when typing in input fields
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // Check each registered action
      for (const action of actions) {
        const shortcut = effectiveShortcuts[action.id];
        if (shortcut && matchesShortcut(event, shortcut)) {
          event.preventDefault();
          event.stopPropagation();
          action.handler();
          return;
        }
      }
    },
    [enabled, actions, effectiveShortcuts]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [handleKeyDown]);
}

/**
 * Get the shortcut string for a specific action
 */
export function getShortcutString(
  shortcuts: KeyboardShortcuts | null | undefined,
  actionId: keyof KeyboardShortcuts
): string {
  // Merge with defaults to ensure new shortcuts are always available
  const effectiveShortcuts = shortcuts
    ? { ...DEFAULT_KEYBOARD_SHORTCUTS, ...shortcuts }
    : DEFAULT_KEYBOARD_SHORTCUTS;
  const shortcut = effectiveShortcuts[actionId];
  return shortcut ? formatShortcut(shortcut) : '';
}
