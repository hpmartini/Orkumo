export enum AppStatus {
  STOPPED = 'STOPPED',
  RUNNING = 'RUNNING',
  ERROR = 'ERROR',
  STARTING = 'STARTING',
  ANALYZING = 'ANALYZING',
  CANCELLED = 'CANCELLED',
  WAITING = 'WAITING',
  RESTARTING = 'RESTARTING'
}

export type AppType = 'vite' | 'next' | 'node' | 'static' | 'unknown';

export interface AppConfig {
  id: string;
  name: string;
  path: string;
  type: AppType;
  port?: number;
  addresses?: string[];
  startCommand?: string;
  detectedFramework?: string;
  status: AppStatus;
  uptime: number; // seconds
  logs: string[];
  stats: {
    cpu: number[]; // history
    memory: number[]; // history (MB)
  };
  aiAnalysis?: string;
  isFavorite?: boolean;
  isArchived?: boolean;
}

export interface SystemStats {
  totalApps: number;
  runningApps: number;
  totalCpuUsage: number;
  totalMemoryUsage: number;
}

export interface IDE {
  id: string;
  name: string;
  path: string;
}

export interface ConsoleLog {
  id: string;
  method: 'log' | 'warn' | 'error' | 'info' | 'debug';
  args: string[];
  timestamp: number;
  url: string;
  uncaught?: boolean;
}

export interface NetworkLog {
  id: string;
  method: string;
  url: string;
  status?: number;
  error?: string;
  duration?: number;
  timestamp: number;
}

export interface ClaudeTerminalOptions {
  continueSession: boolean;
  skipPermissions: boolean;
}

export interface ClaudeCLIInfo {
  installed: boolean;
  path?: string;
  version?: string;
  error?: string;
}

export type TerminalType = 'shell' | 'claude';

// Keyboard shortcuts configuration
export interface KeyboardShortcut {
  key: string;          // The key to press (e.g., 'b', 'h', '1')
  modifiers?: {         // Optional modifier keys
    ctrl?: boolean;
    meta?: boolean;     // Cmd on Mac
    alt?: boolean;
    shift?: boolean;
  };
  description: string;  // Human-readable description
}

export interface KeyboardShortcuts {
  toggleSidebar: KeyboardShortcut;
  goToDashboard: KeyboardShortcut;
  openSettings: KeyboardShortcut;
  toggleDetailsCoding: KeyboardShortcut;
  goToTab1: KeyboardShortcut;
  goToTab2: KeyboardShortcut;
  goToTab3: KeyboardShortcut;
  goToTab4: KeyboardShortcut;
  goToTab5: KeyboardShortcut;
  goToTab6: KeyboardShortcut;
  goToTab7: KeyboardShortcut;
  goToTab8: KeyboardShortcut;
  goToTab9: KeyboardShortcut;
}

export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcuts = {
  toggleSidebar: { key: 'b', description: 'Toggle sidebar' },
  goToDashboard: { key: 'h', description: 'Go to dashboard' },
  openSettings: { key: 's', description: 'Open settings' },
  toggleDetailsCoding: { key: 'c', description: 'Toggle Details/Coding view' },
  goToTab1: { key: '1', modifiers: { meta: true }, description: 'Go to tab 1' },
  goToTab2: { key: '2', modifiers: { meta: true }, description: 'Go to tab 2' },
  goToTab3: { key: '3', modifiers: { meta: true }, description: 'Go to tab 3' },
  goToTab4: { key: '4', modifiers: { meta: true }, description: 'Go to tab 4' },
  goToTab5: { key: '5', modifiers: { meta: true }, description: 'Go to tab 5' },
  goToTab6: { key: '6', modifiers: { meta: true }, description: 'Go to tab 6' },
  goToTab7: { key: '7', modifiers: { meta: true }, description: 'Go to tab 7' },
  goToTab8: { key: '8', modifiers: { meta: true }, description: 'Go to tab 8' },
  goToTab9: { key: '9', modifiers: { meta: true }, description: 'Go to tab 9' },
};
