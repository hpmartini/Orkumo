import { useEffect, useState } from 'react';
import { BrowserPreviewPanel } from './CodingView/BrowserPreviewPanel';
import { registerShellBrowser, routeLink, SHELL_BROWSER_KEY } from '../utils/links';

const readUrl = () => {
  try {
    const url = localStorage.getItem(SHELL_BROWSER_KEY);
    // parked state is stored input: only http(s) may reach the iframe
    return url && routeLink(url, 'builtin') === 'builtin' ? url : null;
  } catch {
    return null;
  }
};

const storeUrl = (url: string | null) => {
  try {
    if (url) localStorage.setItem(SHELL_BROWSER_KEY, url);
    else localStorage.removeItem(SHELL_BROWSER_KEY);
  } catch {
    // storage unavailable: the panel just isn't restored after a reload
  }
};

/**
 * Built-in browser on the right of the shell (#140), the same in every mode:
 * app links and links without their own pane land here; a new link replaces the page.
 */
export function ShellBrowser() {
  const [url, setUrl] = useState<string | null>(readUrl);

  useEffect(
    () =>
      registerShellBrowser((next) => {
        storeUrl(next);
        setUrl(next);
      }),
    []
  );

  if (!url) return null;

  const close = () => {
    storeUrl(null);
    setUrl(null);
  };

  return (
    <aside
      aria-label="Built-in browser"
      className="absolute inset-0 z-30 md:relative md:inset-auto md:w-[45%] md:min-w-[360px] flex flex-col min-h-0 border-l border-gray-800 bg-gray-900"
    >
      <BrowserPreviewPanel url={url} appId="shell-browser" onHide={close} />
    </aside>
  );
}
