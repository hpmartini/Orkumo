import { useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

/** Tailwind's md breakpoint: the sticky scroll walk needs a viewport that can hold it. */
export function useIsDesktop() {
  // false first, like the prerendered HTML; the effect switches to the walk on wide screens
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)');
    const onChange = () => setDesktop(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return desktop;
}

/** prefers-reduced-motion, but false on the first render so hydration matches the prerendered HTML. */
export function useReduceMotion() {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && !!reduce;
}
