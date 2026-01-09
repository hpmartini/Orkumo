/**
 * Type definitions for Electron API exposed via preload script
 */

export interface PlatformInfo {
  platform: string;
  arch: string;
  version: string;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  version?: string;
  message?: string;
}

export interface DownloadProgress {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
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

  // Auto-updates
  checkForUpdates: () => Promise<UpdateCheckResult>;
  installUpdate: () => Promise<void>;
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => void;

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
