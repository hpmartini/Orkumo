/**
 * Application menu template; plain data so it is testable without Electron.
 * macOS gets a real app menu (About, Check for Updates…, Settings… Cmd+,, Hide, Quit) in front of File.
 * Settings… sends 'open-settings'. The renderer's own Cmd+, (hooks/useKeyboardShortcuts.ts) calls
 * preventDefault, so Chromium does not pass the key on to the menu; when focus is outside the page (embedded
 * browser view, Web-IDE frame) the accelerator opens the settings. Both paths only open, never toggle.
 *
 * @param {{ appName: string, isMac: boolean, onRefresh: () => void, onCheckForUpdates: () => void,
 *   onOpenSettings: () => void, openExternal: (url: string) => void }} actions
 */
export function buildMenuTemplate({
  appName,
  isMac,
  onRefresh,
  onCheckForUpdates,
  onOpenSettings,
  openExternal,
}) {
  const checkForUpdates = { label: 'Check for Updates…', click: onCheckForUpdates };
  const settings = { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: onOpenSettings };
  const appMenu = {
    label: appName,
    submenu: [
      { role: 'about' },
      checkForUpdates,
      { type: 'separator' },
      settings,
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };
  return [
    ...(isMac ? [appMenu] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Refresh', accelerator: 'CmdOrCtrl+R', click: onRefresh },
        // macOS: Settings and Quit live in the app menu
        ...(isMac
          ? []
          : [{ type: 'separator' }, settings, { type: 'separator' }, { role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => openExternal('https://github.com/hpmartini/Orkumo'),
        },
        {
          label: 'Report Issue',
          click: () => openExternal('https://github.com/hpmartini/Orkumo/issues'),
        },
        ...(isMac ? [] : [{ type: 'separator' }, checkForUpdates]),
      ],
    },
  ];
}
