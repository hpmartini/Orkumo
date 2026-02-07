import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script for secure IPC communication between renderer and main process
 * This script runs in a privileged context and exposes safe APIs to the renderer
 */

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Platform information
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // External links
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Native dialogs
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),

  // Auto-updates
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onDownloadProgress: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('Callback must be a function');
    }
    const handler = (event, progress) => callback(progress);
    ipcRenderer.on('download-progress', handler);
    // Return cleanup function to remove the listener
    return () => ipcRenderer.removeListener('download-progress', handler);
  },

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
