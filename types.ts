export enum AppStatus {
  STOPPED = 'STOPPED',
  RUNNING = 'RUNNING',
  ERROR = 'ERROR',
  STARTING = 'STARTING',
  ANALYZING = 'ANALYZING'
}

export interface AppConfig {
  id: string;
  name: string;
  path: string;
  type: 'vite' | 'next' | 'node' | 'static' | 'unknown';
  port?: number;
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
