import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** Where keystrokes currently go: the agent list, an attached terminal, or a modal (palette, dialogs) */
export type FocusZone = 'rail' | 'terminal' | 'palette' | 'other';

type Closest = { closest(selector: string): unknown } | null | undefined;

/**
 * Without `rail` anything outside a terminal or dialog counts as the rail (document-level keys
 * drive the list). With it, focus on other controls (tabs, toolbar, peek reply) is 'other'.
 */
export function zoneOf(el: Closest, rail?: { contains(n: unknown): boolean } | null): FocusZone {
  if (el?.closest('.xterm')) return 'terminal';
  if (el?.closest('[role="dialog"], [data-focus-zone="palette"]')) return 'palette';
  if (rail && el && (el as { tagName?: string }).tagName !== 'BODY' && !rail.contains(el))
    return 'other';
  return 'rail';
}

export type FocusChord = 'toggle' | 'rail' | 'terminal';

/**
 * F6 / Shift+F6 toggles (the standard "next region" key), Ctrl+Alt+Left/Right is the
 * laptop-friendly pair. Esc is not usable: xterm hands it to the agent.
 */
export function focusChord(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'>
): FocusChord | null {
  if (e.key === 'F6' && !e.ctrlKey && !e.altKey && !e.metaKey) return 'toggle';
  if (e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey) {
    if (e.key === 'ArrowLeft') return 'rail';
    if (e.key === 'ArrowRight') return 'terminal';
  }
  return null;
}

export const FOCUS_CHORD_LABEL = 'F6';

const ACTIVE_TEXTAREA =
  '[role="tabpanel"]:not(.hidden) [data-agent-pane][data-pane-active="true"] .xterm-helper-textarea';

/**
 * Tracks the focus zone from real DOM focus and provides keyboard switching between
 * the rail and the active terminal pane.
 */
export function useAgentFocusZone(enabled: boolean, railRef: RefObject<HTMLElement | null>) {
  const [zone, setZone] = useState<FocusZone>('rail');
  const zoneRef = useRef(zone);
  zoneRef.current = zone;

  useEffect(() => {
    if (!enabled) return;
    const sync = (el: Closest) => setZone(zoneOf(el, railRef.current));
    const onIn = (e: Event) => sync(e.target as Closest);
    // relatedTarget is null when focus leaves the page or goes to body: that is the rail
    const onOut = (e: Event) => sync((e as Event & { relatedTarget: Closest }).relatedTarget);
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    sync(document.activeElement);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, [enabled, railRef]);

  const focusZone = useCallback(
    (target: 'rail' | 'terminal') => {
      if (target === 'terminal') {
        document.querySelector<HTMLElement>(ACTIVE_TEXTAREA)?.focus();
      } else {
        const rail = railRef.current;
        if (rail && !rail.contains(document.activeElement)) rail.focus();
        // a terminal textarea keeps focus until the rail takes it; make sure the zone follows
        else if (rail) setZone('rail');
      }
    },
    [railRef]
  );

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const chord = focusChord(e);
      if (!chord || zoneRef.current === 'palette') return;
      e.preventDefault();
      e.stopPropagation(); // keep the chord away from xterm
      if (chord === 'toggle') focusZone(zoneRef.current === 'terminal' ? 'rail' : 'terminal');
      else focusZone(chord);
    };
    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, [enabled, focusZone]);

  return { zone, focusZone };
}
