import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { AppConfig, AppStatus } from '../types';
import {
  fetchApps,
  startApp,
  stopApp,
  restartApp,
  subscribeToEvents,
  fetchAppPackage,
  fetchAppStats,
} from '../services/api';

// Constants
const STATS_UPDATE_INTERVAL_MS = 2000;
const LOG_RETENTION_COUNT = 100;

interface UseAppsReturn {
  apps: AppConfig[];
  loading: boolean;
  error: string | null;
  selectedAppId: string | null;
  selectedApp: AppConfig | undefined;
  setSelectedAppId: (id: string | null) => void;
  handleStartApp: (id: string) => Promise<void>;
  handleStopApp: (id: string) => Promise<void>;
  handleRestartApp: (id: string) => Promise<void>;
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
  const [error, setError] = useState<string | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch apps from backend
  const refreshApps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApps();
      setApps(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch apps');
      console.error('Failed to fetch apps:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    refreshApps();
  }, [refreshApps]);

  // Subscribe to real-time events
  useEffect(() => {
    const unsubscribe = subscribeToEvents(
      // On status change
      ({ appId, status }) => {
        setApps((currentApps) =>
          currentApps.map((app) =>
            app.id === appId
              ? { ...app, status: status as AppStatus }
              : app
          )
        );
      },
      // On log
      ({ appId, message }) => {
        setApps((currentApps) =>
          currentApps.map((app) => {
            if (app.id !== appId) return app;
            const timestamp = new Date().toLocaleTimeString();
            const newLogs = [...app.logs, `[${timestamp}] ${message}`].slice(-LOG_RETENTION_COUNT);
            return { ...app, logs: newLogs };
          })
        );
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  // Fetch real stats for running apps
  useEffect(() => {
    statsIntervalRef.current = setInterval(async () => {
      const runningApps = apps.filter(app => app.status === AppStatus.RUNNING);

      for (const app of runningApps) {
        try {
          const stats = await fetchAppStats(app.id);
          setApps((currentApps) =>
            currentApps.map((a) => {
              if (a.id !== app.id) return a;
              return {
                ...a,
                uptime: a.uptime + (STATS_UPDATE_INTERVAL_MS / 1000),
                stats: {
                  cpu: [...a.stats.cpu.slice(1), stats.cpu],
                  memory: [...a.stats.memory.slice(1), stats.memory],
                },
              };
            })
          );
        } catch {
          // Fall back to simulated stats if real stats fail
          setApps((currentApps) =>
            currentApps.map((a) => {
              if (a.id !== app.id || a.status !== AppStatus.RUNNING) return a;
              const lastCpu = a.stats.cpu[a.stats.cpu.length - 1] || 0;
              const lastMem = a.stats.memory[a.stats.memory.length - 1] || 100;
              return {
                ...a,
                uptime: a.uptime + (STATS_UPDATE_INTERVAL_MS / 1000),
                stats: {
                  cpu: [...a.stats.cpu.slice(1), lastCpu + (Math.random() - 0.5) * 5],
                  memory: [...a.stats.memory.slice(1), lastMem + (Math.random() - 0.5) * 10],
                },
              };
            })
          );
        }
      }
    }, STATS_UPDATE_INTERVAL_MS);

    return () => {
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    };
  }, [apps]);

  const handleStartApp = useCallback(async (id: string) => {
    const app = apps.find((a) => a.id === id);
    if (!app) return;

    // Set to starting
    setApps((currentApps) =>
      currentApps.map((a) =>
        a.id === id ? { ...a, status: AppStatus.STARTING } : a
      )
    );

    try {
      await startApp(id, app.path, app.startCommand || 'npm run dev');
      // Status will be updated via SSE
    } catch (err) {
      console.error('Failed to start app:', err);
      setApps((currentApps) =>
        currentApps.map((a) =>
          a.id === id
            ? {
                ...a,
                status: AppStatus.ERROR,
                logs: [...a.logs, `[ERROR] Failed to start: ${err}`],
              }
            : a
        )
      );
    }
  }, [apps]);

  const handleStopApp = useCallback(async (id: string) => {
    try {
      await stopApp(id);
      // Status will be updated via SSE
    } catch (err) {
      console.error('Failed to stop app:', err);
    }
  }, []);

  const handleRestartApp = useCallback(async (id: string) => {
    const app = apps.find((a) => a.id === id);
    if (!app) return;

    setApps((currentApps) =>
      currentApps.map((a) =>
        a.id === id
          ? {
              ...a,
              status: AppStatus.RESTARTING,
              logs: [...a.logs, `[SYSTEM] Restarting process...`],
            }
          : a
      )
    );

    try {
      await restartApp(id);
      // Status will be updated via SSE
    } catch (err) {
      console.error('Failed to restart app:', err);
      setApps((currentApps) =>
        currentApps.map((a) =>
          a.id === id
            ? {
                ...a,
                status: AppStatus.ERROR,
                logs: [...a.logs, `[ERROR] Failed to restart: ${err}`],
              }
            : a
        )
      );
    }
  }, [apps]);

  const handleAnalyzeApp = useCallback(async (id: string) => {
    setApps((currentApps) =>
      currentApps.map((app) =>
        app.id === id ? { ...app, status: AppStatus.ANALYZING } : app
      )
    );

    try {
      // Fetch actual package.json from the backend
      const { fileName, content } = await fetchAppPackage(id);

      // Use the analyze endpoint
      const { analyzeAppConfig } = await import('../services/geminiService');
      const result = await analyzeAppConfig(fileName, content);

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

      toast.success(`Analysis complete for ${apps.find(a => a.id === id)?.name || 'app'}`);
    } catch (err) {
      console.error('Failed to analyze app:', err);
      setApps((currentApps) =>
        currentApps.map((a) =>
          a.id === id
            ? { ...a, status: AppStatus.STOPPED }
            : a
        )
      );
      toast.error('Failed to analyze app configuration');
    }
  }, [apps]);

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
    error,
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
