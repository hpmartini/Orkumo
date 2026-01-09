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

  // Environment
  isElectron: true,
  isDev: process.defaultApp || process.env.NODE_ENV === 'development',
});

// Log successful preload
console.log('[Preload] Electron API exposed to renderer process');
