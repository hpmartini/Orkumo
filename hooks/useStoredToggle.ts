import { useCallback, useState } from 'react';

/** On/off view switch kept in localStorage; a blocked or broken storage keeps it in memory only */
export function useStoredToggle(key: string, fallback = false): [boolean, () => void] {
  const [on, setOn] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? fallback : stored === 'true';
    } catch {
      return fallback;
    }
  });
  const toggle = useCallback(() => {
    setOn((prev) => {
      try {
        localStorage.setItem(key, String(!prev));
      } catch {
        // switch stays in memory only
      }
      return !prev;
    });
  }, [key]);
  return [on, toggle];
}
