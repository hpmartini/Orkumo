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
  handleOpenInFinder: (id: string) => void;
  handleOpenInTerminal: (id: string) => void;
  handleToggleFavorite: (id: string) => void;
  handleToggleArchive: (id: string) => void;
  handleInstallDeps: (id: string) => Promise<void>;
  handleSetPort: (id: string, port: number) => void;
  handleRename: (id: string, newName: string) => void;
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
      // Restore favorites/archived/ports/names from localStorage
      const favorites = JSON.parse(localStorage.getItem('devOrbitFavorites') || '[]');
      const archived = JSON.parse(localStorage.getItem('devOrbitArchived') || '[]');
      const ports: Record<string, number> = JSON.parse(localStorage.getItem('devOrbitPorts') || '{}');
      const names: Record<string, string> = JSON.parse(localStorage.getItem('devOrbitNames') || '{}');
      const enrichedData = data.map((app) => ({
        ...app,
        // Restore saved name if available
        name: names[app.id] ?? app.name,
        isFavorite: favorites.includes(app.id),
        isArchived: archived.includes(app.id),
        // Restore saved port if available
        port: ports[app.id] ?? app.port,
        addresses: ports[app.id] ? [`http://localhost:${ports[app.id]}`] : app.addresses,
      }));
      setApps(enrichedData);
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
            // Strip ANSI escape codes and split by newlines
            // eslint-disable-next-line no-control-regex
            const stripped = message.replace(/\x1b\[[0-9;]*m/g, '');
            const lines = stripped.split(/\r?\n/).filter((line: string) => line.trim());
            const newLogEntries = lines.map((line: string) => `[${timestamp}] ${line}`);
            const newLogs = [...app.logs, ...newLogEntries].slice(-LOG_RETENTION_COUNT);
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
      // Pass the configured port to the backend
      await startApp(id, app.path, app.startCommand || 'npm run dev', app.port);
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

  const handleToggleFavorite = useCallback((id: string) => {
    setApps((currentApps) =>
      currentApps.map((app) =>
        app.id === id ? { ...app, isFavorite: !app.isFavorite } : app
      )
    );
    // Persist to localStorage
    const favorites = JSON.parse(localStorage.getItem('devOrbitFavorites') || '[]');
    const idx = favorites.indexOf(id);
    if (idx === -1) {
      favorites.push(id);
    } else {
      favorites.splice(idx, 1);
    }
    localStorage.setItem('devOrbitFavorites', JSON.stringify(favorites));
  }, []);

  const handleToggleArchive = useCallback((id: string) => {
    setApps((currentApps) =>
      currentApps.map((app) =>
        app.id === id ? { ...app, isArchived: !app.isArchived } : app
      )
    );
    // Persist to localStorage
    const archived = JSON.parse(localStorage.getItem('devOrbitArchived') || '[]');
    const idx = archived.indexOf(id);
    if (idx === -1) {
      archived.push(id);
    } else {
      archived.splice(idx, 1);
    }
    localStorage.setItem('devOrbitArchived', JSON.stringify(archived));
  }, []);

  const handleInstallDeps = useCallback(async (id: string) => {
    const app = apps.find((a) => a.id === id);
    if (!app) return;

    // Use startApp with 'npm install' command
    setApps((currentApps) =>
      currentApps.map((a) =>
        a.id === id
          ? {
              ...a,
              status: AppStatus.STARTING,
              logs: [...a.logs, `[SYSTEM] Installing dependencies...`],
            }
          : a
      )
    );

    try {
      await startApp(id, app.path, 'npm install');
      toast.success(`Installing dependencies for ${app.name}`);
    } catch (err) {
      console.error('Failed to install deps:', err);
      setApps((currentApps) =>
        currentApps.map((a) =>
          a.id === id
            ? {
                ...a,
                status: AppStatus.ERROR,
                logs: [...a.logs, `[ERROR] Failed to install: ${err}`],
              }
            : a
        )
      );
      toast.error('Failed to install dependencies');
    }
  }, [apps]);

  const handleSetPort = useCallback((id: string, port: number) => {
    setApps((currentApps) =>
      currentApps.map((app) =>
        app.id === id
          ? {
              ...app,
              port,
              addresses: [`http://localhost:${port}`],
            }
          : app
      )
    );
    // Persist to localStorage
    const ports: Record<string, number> = JSON.parse(localStorage.getItem('devOrbitPorts') || '{}');
    ports[id] = port;
    localStorage.setItem('devOrbitPorts', JSON.stringify(ports));
    toast.success(`Port updated to ${port}`);
  }, []);

  const handleRename = useCallback((id: string, newName: string) => {
    const oldName = apps.find(a => a.id === id)?.name;
    setApps((currentApps) =>
      currentApps.map((app) =>
        app.id === id ? { ...app, name: newName } : app
      )
    );
    // Persist to localStorage
    const names: Record<string, string> = JSON.parse(localStorage.getItem('devOrbitNames') || '{}');
    names[id] = newName;
    localStorage.setItem('devOrbitNames', JSON.stringify(names));
    toast.success(`Renamed "${oldName}" to "${newName}"`);
  }, [apps]);

  const handleOpenInFinder = useCallback((id: string) => {
    const app = apps.find((a) => a.id === id);
    if (!app) return;
    // Use the API to open in Finder (macOS)
    fetch(`/api/apps/${id}/open-finder`, { method: 'POST' })
      .catch(() => {
        // Fallback: copy path to clipboard
        navigator.clipboard.writeText(app.path);
        toast.success('Path copied to clipboard');
      });
  }, [apps]);

  const handleOpenInTerminal = useCallback((id: string) => {
    const app = apps.find((a) => a.id === id);
    if (!app) return;
    // Use the API to open in Terminal
    fetch(`/api/apps/${id}/open-terminal`, { method: 'POST' })
      .catch(() => {
        // Fallback: copy path to clipboard
        navigator.clipboard.writeText(`cd "${app.path}"`);
        toast.success('Terminal command copied to clipboard');
      });
  }, [apps]);

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
    handleOpenInFinder,
    handleOpenInTerminal,
    handleToggleFavorite,
    handleToggleArchive,
    handleInstallDeps,
    handleSetPort,
    handleRename,
    refreshApps,
    runningCount,
    totalCpu,
  };
}
