/**
 * Where a clicked link opens (#140): the built-in browser by default, the system browser on request.
 * Every link source (terminal, app UI, Electron window.open from the Web-IDE) goes through openLink.
 */

export type LinkTarget = 'builtin' | 'system';
export type LinkRoute = 'builtin' | 'system' | 'blocked';

/** Never navigated to from a link: script or local-file access */
const BLOCKED_PROTOCOLS = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:']);

/** Pure decision: only http(s) ever reaches the built-in browser; other schemes keep their old path */
export function routeLink(url: string, target: LinkTarget): LinkRoute {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return 'blocked';
  }
  if (BLOCKED_PROTOCOLS.has(protocol)) return 'blocked';
  if (protocol !== 'http:' && protocol !== 'https:') return 'system';
  return target === 'builtin' ? 'builtin' : 'system';
}

/** URL of the shell browser panel; per context like the attached agent tabs (UI_KEYS in useProjectContexts) */
export const SHELL_BROWSER_KEY = 'devOrbitShellBrowser';

let linkTarget: LinkTarget = 'builtin';
let shellBrowser: ((url: string) => void) | null = null;

export const getLinkTarget = () => linkTarget;
export function setLinkTarget(target: LinkTarget) {
  linkTarget = target;
}

/** The shell's browser panel registers here; returns the unregister function */
export function registerShellBrowser(open: (url: string) => void) {
  shellBrowser = open;
  return () => {
    if (shellBrowser === open) shellBrowser = null;
  };
}

/** System browser, bypassing the built-in one (Electron's window.open is routed back into the app) */
export function openInSystemBrowser(url: string) {
  if (window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(url).catch(console.error);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Open a link per the configured target. `builtin` overrides the shell panel
 * (agent terminals open a split pane next to themselves instead).
 */
export function openLink(url: string, builtin?: (url: string) => void): LinkRoute {
  const route = routeLink(url, linkTarget);
  const openBuiltin = builtin ?? shellBrowser;
  if (route === 'builtin' && openBuiltin) openBuiltin(url);
  else if (route !== 'blocked') openInSystemBrowser(url);
  return route;
}

/**
 * Document-level click handler: `target="_blank"` http(s) anchors anywhere in the app follow openLink,
 * so the individual components keep plain anchors (copy link, middle-click) without their own logic.
 */
export function interceptAnchorClick(event: MouseEvent) {
  // modifier clicks keep the browser's own "open in new tab/window"
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey) return;
  const anchor = (event.target as HTMLElement | null)?.closest?.<HTMLAnchorElement>('a[href]');
  // mailto: and friends keep the browser's default handling
  if (!anchor || anchor.target !== '_blank' || !/^https?:/i.test(anchor.href)) return;
  event.preventDefault();
  openLink(anchor.href);
}

/**
 * Capture phase: rail anchors stop propagation (so the row doesn't toggle), which would hide
 * the click from a bubbling document listener. Returns the cleanup.
 */
export function installAnchorInterception() {
  document.addEventListener('click', interceptAnchorClick, true);
  return () => document.removeEventListener('click', interceptAnchorClick, true);
}
