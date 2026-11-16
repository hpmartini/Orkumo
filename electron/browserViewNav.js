/**
 * Browser-like navigation for the embedded preview (BrowserView) (#182):
 * reload and history shortcuts stay inside the view, and every navigation
 * reports url + history state to the renderer.
 *
 * Mouse side buttons need no code: Chromium navigates on button 3/4 by itself
 * (scripts/review/182-smoke.mjs checks that). Mouse tools on macOS often send the
 * browser shortcuts Cmd+[ / Cmd+] instead, which the view did not handle.
 */

/** 'reload' | 'back' | 'forward' | null for a before-input-event input */
export function viewShortcut(input, platform = process.platform) {
  if (input.type !== 'keyDown') return null;
  if (input.key === 'F5') return 'reload';
  const mac = platform === 'darwin';
  const mod = mac ? input.meta : input.control;
  if (mod && !input.alt && input.key.toLowerCase() === 'r') return 'reload';
  // Chrome's history shortcuts; Cmd+Arrow stays with text editing on macOS
  if (mac && input.meta && !input.alt && !input.control) {
    if (input.key === '[') return 'back';
    if (input.key === ']') return 'forward';
  }
  if (!mac && input.alt && !input.control && !input.meta) {
    if (input.key === 'ArrowLeft') return 'back';
    if (input.key === 'ArrowRight') return 'forward';
  }
  return null;
}

/** Back/forward; a no-op at either end of the history */
export function goHistory(webContents, direction) {
  const history = webContents.navigationHistory;
  if (direction === 'back' && history.canGoBack()) history.goBack();
  else if (direction === 'forward' && history.canGoForward()) history.goForward();
}

/** Wire one view's webContents; send(state) reports { url, canGoBack, canGoForward } */
export function wireBrowserViewNav(webContents, send, platform = process.platform) {
  webContents.on('before-input-event', (event, input) => {
    const action = viewShortcut(input, platform);
    if (!action) return;
    // preventDefault also stops the menu accelerator (Cmd+R would reload the whole app)
    event.preventDefault();
    if (action === 'reload') webContents.reload();
    else goHistory(webContents, action);
  });

  const report = () => {
    const history = webContents.navigationHistory;
    send({
      url: webContents.getURL(),
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
    });
  };
  webContents.on('did-navigate', report);
  webContents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
    if (isMainFrame) report();
  });
}

/**
 * Where a window.open from the view goes: 'popup' (a sized window.open: OAuth/Google
 * Identity popups post their result to window.opener, so they need a real child
 * window; loaded into the view, accounts.google.com/gsi/transform stays white),
 * 'view' (target=_blank links), or null (non-http, blocked).
 */
export function windowOpenTarget({ url, disposition }, route) {
  if (route(url) !== 'renderer') return null;
  return disposition === 'new-window' ? 'popup' : 'view';
}

/**
 * Wire window.open for one view; returns the live set of its popup windows (the
 * caller closes them with the view). route(url) is validation.js windowOpenRoute.
 */
export function wireViewPopups(webContents, { parent, partition, route }) {
  const popups = new Set();
  webContents.setWindowOpenHandler((details) => {
    const target = windowOpenTarget(details, route);
    if (target === 'view') webContents.loadURL(details.url).catch(() => {});
    if (target !== 'popup') return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent,
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          partition,
        },
      },
    };
  });
  webContents.on('did-create-window', (popup) => {
    popups.add(popup);
    popup.on('closed', () => popups.delete(popup));
    // A popup's own window.open stays inside the popup
    popup.webContents.setWindowOpenHandler(({ url }) => {
      if (route(url) === 'renderer') popup.webContents.loadURL(url).catch(() => {});
      return { action: 'deny' };
    });
  });
  return popups;
}
