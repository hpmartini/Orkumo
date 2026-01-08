/**
 * Type definitions for Electron API exposed via preload script
 */

export interface PlatformInfo {
  platform: string;
  arch: string;
  version: string;
}

export interface ElectronAPI {
  // Platform information
  getPlatform: () => Promise<PlatformInfo>;
  getAppVersion: () => Promise<string>;

  // External links
  openExternal: (url: string) => Promise<{ success: boolean }>;

  // Native dialogs
  showMessageBox: (options: Electron.MessageBoxOptions) => Promise<Electron.MessageBoxReturnValue>;
  showOpenDialog: (options: Electron.OpenDialogOptions) => Promise<Electron.OpenDialogReturnValue>;

  // Environment
  isElectron: boolean;
  isDev: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
