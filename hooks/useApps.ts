import { useState, useEffect, useCallback, useRef } from 'react';
import { AppConfig, AppStatus } from '../types';
import { scanDirectory, generateMockLog } from '../services/mockOs';
import { analyzeAppConfig } from '../services/geminiService';

// Constants for simulation
const SIMULATION_INTERVAL_MS = 1000;
const LOG_RETENTION_COUNT = 50;
const LOG_GENERATION_CHANCE = 0.2;

interface UseAppsReturn {
  apps: AppConfig[];
  loading: boolean;
  selectedAppId: string | null;
  selectedApp: AppConfig | undefined;
  setSelectedAppId: (id: string | null) => void;
  handleStartApp: (id: string) => void;
  handleStopApp: (id: string) => void;
  handleRestartApp: (id: string) => void;
  handleAnalyzeApp: (id: string) => Promise<void>;
  handleOpenInBrowser: (id: string) => void;
  refreshApps: () => Promise<void>;
  runningCount: number;
  totalCpu: number;
}

export function useApps(): UseAppsReturn {
  const [apps, setApps] = useState<AppConfig[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initial scan
  const refreshApps = useCallback(async () => {
    setLoading(true);
    try {
      const data = await scanDirectory();
      setApps(data);
    } catch (error) {
      console.error('Failed to scan directory:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshApps();
  }, [refreshApps]);

  // Process simulation
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setApps((currentApps) =>
        currentApps.map((app) => {
          if (app.status !== AppStatus.RUNNING) return app;

          // Update uptime
          const newUptime = app.uptime + 1;

          // Generate logs randomly
          let newLogs = app.logs;
          if (Math.random() < LOG_GENERATION_CHANCE) {
            const log = generateMockLog(app.name, app.type);
            newLogs = [...newLogs, log].slice(-LOG_RETENTION_COUNT);
          }

          // Smooth CPU transition
          const lastCpu = app.stats.cpu[app.stats.cpu.length - 1] || 0;
          const targetCpu = Math.random() * 40 + 10;
          const nextCpu = lastCpu + (targetCpu - lastCpu) * 0.2;

          // Memory with jitter
          const lastMem = app.stats.memory[app.stats.memory.length - 1] || 100;
          const jitter = (Math.random() - 0.5) * 10;
          const nextMem = Math.max(50, Math.min(1024, lastMem + jitter));

          return {
            ...app,
            uptime: newUptime,
            logs: newLogs,
            stats: {
              cpu: [...app.stats.cpu.slice(1), nextCpu],
              memory: [...app.stats.memory.slice(1), nextMem],
            },
          };
        })
      );
    }, SIMULATION_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const handleStartApp = useCallback((id: string) => {
    setApps((currentApps) =>
      currentApps.map((app) =>
        app.id === id ? { ...app, status: AppStatus.STARTING } : app
      )
    );

    setTimeout(() => {
      setApps((currentApps) =>
        currentApps.map((app) =>
          app.id === id
            ? {
                ...app,
                status: AppStatus.RUNNING,
                logs: [...app.logs, `[SYSTEM] Started process: ${app.startCommand}`],
              }
            : app
        )
      );
    }, 1500);
  }, []);

  const handleStopApp = useCallback((id: string) => {
    setApps((currentApps) =>
      currentApps.map((app) =>
        app.id === id
          ? {
              ...app,
              status: AppStatus.STOPPED,
              logs: [...app.logs, `[SYSTEM] Process terminated`],
            }
          : app
      )
    );
  }, []);

  const handleRestartApp = useCallback((id: string) => {
    setApps((currentApps) =>
      currentApps.map((app) =>
        app.id === id
          ? {
              ...app,
              status: AppStatus.RESTARTING,
              logs: [...app.logs, `[SYSTEM] Restarting process...`],
            }
          : app
      )
    );

    setTimeout(() => {
      setApps((currentApps) =>
        currentApps.map((app) =>
          app.id === id
            ? {
                ...app,
                status: AppStatus.RUNNING,
                uptime: 0,
                logs: [...app.logs, `[SYSTEM] Process restarted: ${app.startCommand}`],
              }
            : app
        )
      );
    }, 2000);
  }, []);

  const handleAnalyzeApp = useCallback(async (id: string) => {
    let appName = '';
    setApps((currentApps) => {
      const app = currentApps.find((a) => a.id === id);
      if (app) appName = app.name;
      return currentApps.map((app) =>
        app.id === id ? { ...app, status: AppStatus.ANALYZING } : app
      );
    });

    if (!appName) return;

    const mockPackageJson = JSON.stringify(
      {
        name: appName,
        scripts: {
          dev: 'vite',
          build: 'tsc && vite build',
        },
        dependencies: {
          react: '^18.2.0',
        },
      },
      null,
      2
    );

    const result = await analyzeAppConfig('package.json', mockPackageJson);

    setApps((currentApps) =>
      currentApps.map((a) =>
        a.id === id
          ? {
              ...a,
              status: AppStatus.STOPPED,
              aiAnalysis: result.summary,
              startCommand: result.command,
              port: result.port,
              detectedFramework: result.type,
            }
          : a
      )
    );
  }, []);

  const handleOpenInBrowser = useCallback(
    (id: string) => {
      const app = apps.find((a) => a.id === id);
      if (app?.port && app.status === AppStatus.RUNNING) {
        window.open(`http://localhost:${app.port}`, '_blank');
      }
    },
    [apps]
  );

  const selectedApp = apps.find((a) => a.id === selectedAppId);
  const runningCount = apps.filter((a) => a.status === AppStatus.RUNNING).length;
  const totalCpu = apps.reduce(
    (acc, app) => acc + (app.stats.cpu[app.stats.cpu.length - 1] || 0),
    0
  );

  return {
    apps,
    loading,
    selectedAppId,
    selectedApp,
    setSelectedAppId,
    handleStartApp,
    handleStopApp,
    handleRestartApp,
    handleAnalyzeApp,
    handleOpenInBrowser,
    refreshApps,
    runningCount,
    totalCpu,
  };
}
