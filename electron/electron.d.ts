/**
 * Type definitions for Electron API exposed via preload script
 */

import type { MessageBoxOptions, OpenDialogOptions } from 'electron';

export interface PlatformInfo {
  platform: string;
  arch: string;
  version: string;
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

export interface BrowserViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserViewResult {
  success: boolean;
  error?: string;
}

export interface BrowserViewNavState {
  viewId: string;
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

/** One provider's sync run (Chats mode, #280; electron/chatSync.js) */
export interface ChatSyncStatus {
  status: 'syncing' | 'ok' | 'needs-login' | 'error' | 'unavailable';
  /** Conversations new / replaced in the local history so far */
  added: number;
  updated: number;
  /** Conversations still to fetch (while syncing) */
  pending?: number;
  /** What went wrong and how to recover (needs-login, error, unavailable) */
  reason?: string;
  /** ms; set when a run completed */
  syncedAt?: number;
}

export type ChatSyncResult = Record<'claude' | 'chatgpt', ChatSyncStatus>;

/** Update state pushed by electron/updater.js */
export interface UpdateStatus {
  state: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';
  /** null until the first check resolved it; off: dev build or ORKUMO_DISABLE_UPDATES */
  mode: 'off' | 'notify' | 'install' | 'swap' | null;
  currentVersion: string;
  /** 'stable', 'rc' or 'dev' (local build) */
  channel?: string;
  /** Version found / downloading / ready */
  version?: string;
  percent?: number;
  /** First line of the failure (state 'error') */
  error?: string;
  /** ms of the last finished check */
  lastCheck: number | null;
  /** The current check was started by the user (menu, Settings), not the timer */
  manual: boolean;
  /** notify mode: where to download the new version by hand */
  releaseUrl?: string;
}

export interface ElectronAPI {
  // Platform information
  getPlatform: () => Promise<PlatformInfo>;
  getAppVersion: () => Promise<string>;
  updates: {
    getStatus: () => Promise<UpdateStatus>;
    check: () => Promise<UpdateStatus>;
    /** Restart to update; quits the app on success */
    install: () => Promise<{ success: boolean; error?: string }>;
    onStatus: (callback: (status: UpdateStatus) => void) => () => void;
  };
  /** Menu "Settings…" (Cmd+,) */
  onOpenSettings: (callback: () => void) => () => void;

  // External links
  openExternal: (url: string) => Promise<ExternalUrlResult>;
  /** window.open from the app or the Web-IDE, routed back for the link setting (#140) */
  onOpenLink: (callback: (url: string) => void) => () => void;
  /** Quick window (#251): send its prompt to the main window / hide it / receive a prompt */
  quickSubmit: (text: string) => void;
  quickHide: () => void;
  onQuickPrompt: (callback: (text: string) => void) => () => void;
  /** Quick window chat (#251): grow to show the answer / shrink back; hand its chat to the main window */
  quickExpand: (expanded: boolean) => void;
  quickOpenChat: (paneId: string) => void;
  onQuickHidden: (callback: () => void) => () => void;
  onQuickChat: (callback: (paneId: string) => void) => () => void;

  // Window state
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => () => void;
  getFullscreenState: () => Promise<boolean>;

  // Embedded browser preview (BrowserView)
  browserView: {
    create: (viewId: string, bounds: BrowserViewBounds) => Promise<BrowserViewResult>;
    navigate: (viewId: string, url: string) => Promise<BrowserViewResult>;
    resize: (viewId: string, bounds: BrowserViewBounds) => Promise<BrowserViewResult>;
    destroy: (viewId: string) => Promise<BrowserViewResult>;
    openDevTools: (viewId: string) => Promise<BrowserViewResult>;
    closeDevTools: (viewId: string) => Promise<BrowserViewResult>;
    refresh: (viewId: string) => Promise<BrowserViewResult>;
    go: (viewId: string, direction: 'back' | 'forward') => Promise<BrowserViewResult>;
    /** Every main-frame navigation of any view; filter by viewId. Returns cleanup */
    onNavigate: (callback: (state: BrowserViewNavState) => void) => () => void;
  };

  // Native dialogs
  showMessageBox: (options: MessageBoxOptions) => Promise<MessageBoxResult>;
  showOpenDialog: (options: OpenDialogOptions) => Promise<OpenDialogResult>;

  /** Chats mode (#280): sync claude.ai / ChatGPT through the built-in browser's login */
  chatSync?: {
    /** One run of both providers; a call during a run shares it */
    run: () => Promise<ChatSyncResult>;
    /** Progress of a run per provider. Returns cleanup */
    onProgress: (
      callback: (progress: ChatSyncStatus & { provider: 'claude' | 'chatgpt' }) => void
    ) => () => void;
  };

  // Environment
  isElectron: boolean;
  isDev: boolean;

  /** Port the backend server actually listens on; null if not reported */
  serverPort: number | null;
  /** Pairing link when the app is a client of another machine's server (ORKUMO_REMOTE) */
  remoteLink: string | null;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
