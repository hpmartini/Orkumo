import { useEffect, useState } from 'react';

/** Button label follows the visitor's platform; the link itself is the same for everyone. */
export function useDownloadLabel() {
  const [label, setLabel] = useState('Get the builds');
  useEffect(() => {
    const ua = navigator.userAgent;
    // iPadOS masquerades as "Macintosh"; only the touch points give it away.
    const ipadOs = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
    if (/iPhone|iPad|iPod/i.test(ua) || /Android/i.test(ua) || ipadOs) return;
    if (/Mac OS X|Macintosh/i.test(ua)) setLabel('Download for macOS');
    else if (/Linux/i.test(ua)) setLabel('Download for Linux');
  }, []);
  return label;
}
