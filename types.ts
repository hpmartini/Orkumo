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
}

export interface SystemStats {
  totalApps: number;
  runningApps: number;
  totalCpuUsage: number;
  totalMemoryUsage: number;
}
