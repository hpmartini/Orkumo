import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script for secure IPC communication between renderer and main process
 * This script runs in a privileged context and exposes safe APIs to the renderer
 */

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
// The backend port is resolved by the main process (from SERVER_PORT / .env.local)
// and handed over as a launch argument. It must be readable synchronously because
// the renderer builds its API base URL at module-evaluation time.
const serverPortArg = process.argv.find((arg) => arg.startsWith('--devorbit-server-port='));
const serverPort = serverPortArg ? parseInt(serverPortArg.split('=')[1], 10) : null;

contextBridge.exposeInMainWorld('electronAPI', {
  // Port the backend server actually listens on
  serverPort: Number.isInteger(serverPort) ? serverPort : null,

  // Platform information
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // External links
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  // window.open from the app or the Web-IDE, routed back for the link setting (#140)
  onOpenLink: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('Callback must be a function');
    }
    const handler = (event, url) => callback(url);
    ipcRenderer.on('open-link', handler);
    return () => ipcRenderer.removeListener('open-link', handler);
  },

  // Native dialogs
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),

  // BrowserView API for embedded browser preview with real Chrome DevTools
  browserView: {
    create: (viewId, bounds) => ipcRenderer.invoke('browser-view-create', { viewId, bounds }),
    navigate: (viewId, url) => ipcRenderer.invoke('browser-view-navigate', { viewId, url }),
    resize: (viewId, bounds) => ipcRenderer.invoke('browser-view-resize', { viewId, bounds }),
    destroy: (viewId) => ipcRenderer.invoke('browser-view-destroy', { viewId }),
    openDevTools: (viewId) => ipcRenderer.invoke('browser-view-open-devtools', { viewId }),
    closeDevTools: (viewId) => ipcRenderer.invoke('browser-view-close-devtools', { viewId }),
    refresh: (viewId) => ipcRenderer.invoke('browser-view-refresh', { viewId }),
  },

  // Environment
  isElectron: true,
  isDev: process.defaultApp || process.env.NODE_ENV === 'development',

  // Window state
  onFullscreenChange: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('Callback must be a function');
    }
    const handler = (event, isFullscreen) => callback(isFullscreen);
    ipcRenderer.on('fullscreen-change', handler);
    // Return cleanup function to remove the listener
    return () => ipcRenderer.removeListener('fullscreen-change', handler);
  },
  getFullscreenState: () => ipcRenderer.invoke('get-fullscreen-state'),
});

// Log successful preload
console.log('[Preload] Electron API exposed to renderer process');
