import { AppConfig, AppStatus } from '../types';

// Mock data to simulate initial directory scan
const MOCK_APPS: Partial<AppConfig>[] = [
  {
    id: 'app-1',
    name: 'dashboard-frontend',
    path: '/projects/dashboard-frontend',
    type: 'vite',
    port: 5173,
    startCommand: 'npm run dev',
    detectedFramework: 'React + Vite',
  },
  {
    id: 'app-2',
    name: 'api-gateway',
    path: '/projects/api-gateway',
    type: 'node',
    port: 8080,
    startCommand: 'npm start',
    detectedFramework: 'Express',
  },
  {
    id: 'app-3',
    name: 'landing-page',
    path: '/projects/landing-page',
    type: 'next',
    port: 3000,
    startCommand: 'npm run dev',
    detectedFramework: 'Next.js',
  },
  {
    id: 'app-4',
    name: 'docs-site',
    path: '/projects/docs',
    type: 'static',
    port: 4000,
    startCommand: 'http-server .',
    detectedFramework: 'HTML/CSS',
  }
];

export const scanDirectory = async (): Promise<AppConfig[]> => {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 800));

  return MOCK_APPS.map(app => ({
    ...app,
    status: AppStatus.STOPPED,
    uptime: 0,
    logs: [],
    stats: {
      cpu: Array(20).fill(0),
      memory: Array(20).fill(0),
    },
    aiAnalysis: undefined,
  })) as AppConfig[];
};

export const generateMockLog = (_appName: string, type: string): string => {
  const timestamp = new Date().toLocaleTimeString();
  const logs = [
    `[${type}] HMR update: /src/App.tsx`,
    `[${type}] API Request: GET /user/123 - 200 OK`,
    `[${type}] Database connection active`,
    `[${type}] Compiling... Done in 200ms`,
    `[${type}] Incoming request from 127.0.0.1`,
    `[${type}] Memory usage stable at 150MB`,
    `[${type}] Worker thread started`,
  ];
  return `[${timestamp}] ${logs[Math.floor(Math.random() * logs.length)]}`;
};
