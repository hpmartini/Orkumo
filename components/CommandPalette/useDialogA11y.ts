import { useEffect, useRef } from 'react';
import type React from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog a11y: moves focus in on open, restores it to the previously focused element
 * on close and returns a keydown handler that keeps Tab inside the dialog.
 * The trap only reacts to events from inside its own dialog, so stacked dialogs coexist.
 */
export function useDialogA11y(
  open: boolean,
  dialogRef: React.RefObject<HTMLElement | null>,
  initialFocus: () => HTMLElement | null | undefined
): React.KeyboardEventHandler<HTMLElement> {
  const initialFocusRef = useRef(initialFocus);
  initialFocusRef.current = initialFocus;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => {
      (initialFocusRef.current() ?? dialogRef.current)?.focus();
    });
    return () => {
      cancelAnimationFrame(id);
      if (previous && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open, dialogRef]);

  return (e) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null
    );
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };
}
