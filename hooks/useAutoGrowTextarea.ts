import React, { useCallback, useLayoutEffect, useState } from 'react';

const STEP = 24; // one line of leading-6

/**
 * Height for a prompt textarea: auto-grows with its content between min and max, or the
 * height the user dragged (pinned) when set. Scrolls once the content is taller.
 */
export function fitHeight(
  content: number,
  { min, max, pinned }: { min: number; max: number; pinned: number | null }
) {
  const height = pinned ? Math.max(min, pinned) : Math.min(Math.max(content, min), max);
  return { height, scroll: content > height };
}

function readPinned(key: string): number | null {
  try {
    const n = Number(localStorage.getItem(key));
    return n > 0 ? n : null;
  } catch {
    return null;
  }
}

function savePinned(key: string, value: number | null) {
  try {
    if (value) localStorage.setItem(key, String(Math.round(value)));
    else localStorage.removeItem(key);
  } catch {
    // height stays for this page only
  }
}

/**
 * Keeps a textarea's height fitted to its wrapped content. It re-measures on every value
 * change and on every width change: the wrap depends on the width, and a textarea measured
 * while hidden (other tab, session switch) reports scrollHeight 0 and stayed padding-high.
 * Returns props for a drag handle that pins the height (remembered under storageKey);
 * double-click, Delete or Backspace on the handle goes back to auto-grow.
 */
export function useAutoGrowTextarea(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
  { min, max, storageKey }: { min: number; max: number; storageKey: string }
) {
  const [pinned, setPinned] = useState(() => readPinned(storageKey));

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el || !el.clientWidth) return; // hidden: the ResizeObserver fits it once it shows
    el.style.height = 'auto';
    // border-box: scrollHeight excludes the border, so add it or the text scrolls by 2px
    const content = el.scrollHeight + el.offsetHeight - el.clientHeight;
    const { height, scroll } = fitHeight(content, { min, max, pinned });
    el.style.height = `${height}px`;
    el.style.overflowY = scroll ? 'auto' : 'hidden';
  }, [ref, min, max, pinned]);

  useLayoutEffect(fit, [fit, value]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let width = -1;
    const observer = new ResizeObserver(() => {
      // Only width changes matter; fit() itself changes the height
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, fit]);

  const pin = useCallback(
    (next: number | null) => {
      const clamped =
        next === null ? null : Math.min(Math.max(next, min), window.innerHeight * 0.7);
      setPinned(clamped);
      savePinned(storageKey, clamped);
    },
    [min, storageKey]
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.button !== 0) return;
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = el.offsetHeight;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    // The handle sits above the field at the bottom of the pane: dragging up makes it taller
    const move = (ev: { clientY: number }) => pin(startHeight + startY - ev.clientY);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const current = ref.current?.offsetHeight ?? min;
    if (e.key === 'ArrowUp') pin(current + STEP);
    else if (e.key === 'ArrowDown') pin(current - STEP);
    else if (e.key === 'Delete' || e.key === 'Backspace') pin(null);
    else return;
    e.preventDefault();
  };

  return {
    pinned: pinned !== null,
    handleProps: {
      role: 'separator',
      'aria-orientation': 'horizontal' as const,
      'aria-label': 'Resize input (double-click: fit to text)',
      'aria-valuenow': pinned ?? undefined,
      tabIndex: 0,
      title: pinned
        ? 'Drag to resize · double-click: fit to text again'
        : 'Drag to resize · grows with the text by itself',
      onPointerDown,
      onKeyDown,
      onDoubleClick: () => pin(null),
    },
  };
}
