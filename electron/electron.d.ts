/**
 * Type definitions for Electron API exposed via preload script
 */

import type { MessageBoxOptions, OpenDialogOptions } from 'electron';

export interface PlatformInfo {
  platform: string;
  arch: string;
  version: string;
}

export interface UpdateCheckResult {
  success: boolean;
  updateAvailable?: boolean;
  version?: string;
  message?: string;
  error?: string;
}

export interface DownloadProgress {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
}

export interface IpcResult<T = any> {
  success: boolean;
  error?: string;
}

export interface MessageBoxResult extends IpcResult {
  response?: number;
  checkboxChecked?: boolean;
}

export interface OpenDialogResult extends IpcResult {
  canceled?: boolean;
  filePaths?: string[];
}

export interface ExternalUrlResult extends IpcResult {}

export interface InstallUpdateResult extends IpcResult {}

export interface ElectronAPI {
  // Platform information
  getPlatform: () => Promise<PlatformInfo>;
  getAppVersion: () => Promise<string>;

  // External links
  openExternal: (url: string) => Promise<ExternalUrlResult>;

  // Native dialogs
  showMessageBox: (options: MessageBoxOptions) => Promise<MessageBoxResult>;
  showOpenDialog: (options: OpenDialogOptions) => Promise<OpenDialogResult>;

  // Auto-updates
  checkForUpdates: () => Promise<UpdateCheckResult>;
  installUpdate: () => Promise<InstallUpdateResult>;
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void;

  // Environment
  isElectron: boolean;
  isDev: boolean;

  /** Port the backend server actually listens on; null if not reported */
  serverPort: number | null;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
