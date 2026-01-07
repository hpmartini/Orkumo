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
