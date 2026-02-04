import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { AppConfig, AppStatus } from '../types';
import { API_BASE_URL } from '../utils/apiConfig';
import {
  fetchApps,
  startApp,
  stopApp,
  restartApp,
  fetchAppPackage,
  fetchSettings,
  fetchLogs,
  importSettings,
  updateFavorite,
  updateFavoritesOrder,
  updateFavoritesSortMode,
  updateArchive,
  updatePort,
  updateName,
  configureAllPorts,
  AppSettings,
  FavoritesSortMode,
} from '../services/api';
// Use singleton SSE manager to avoid connection explosion with multi-tab rendering
import {
  subscribeToEventsShared,
  subscribeToStatsShared,
  StatsUpdate,
} from '../services/sseManager';
import { DEFAULT_APP_START_PORT } from '../constants';

// Constants
const LOG_RETENTION_COUNT = 100;
const LOCALSTORAGE_MIGRATED_KEY = 'devOrbitMigratedToBackend';

/**
 * Migrate localStorage settings to backend (one-time migration)
 */
async function migrateLocalStorageToBackend(): Promise<void> {
  // Check if already migrated
  if (localStorage.getItem(LOCALSTORAGE_MIGRATED_KEY)) {
    return;
  }

  // Collect existing localStorage data
  const favorites = JSON.parse(localStorage.getItem('devOrbitFavorites') || '[]');
  const archived = JSON.parse(localStorage.getItem('devOrbitArchived') || '[]');
  const customPorts = JSON.parse(localStorage.getItem('devOrbitPorts') || '{}');
  const customNames = JSON.parse(localStorage.getItem('devOrbitNames') || '{}');

  // Only migrate if there's data to migrate
  if (favorites.length > 0 || archived.length > 0 ||
      Object.keys(customPorts).length > 0 || Object.keys(customNames).length > 0) {
    try {
      await importSettings({ favorites, archived, customPorts, customNames });
      console.log('Successfully migrated settings from localStorage to backend');
    } catch (err) {
      console.error('Failed to migrate settings to backend:', err);
      // Don't mark as migrated if it failed, so we can retry
      return;
    }
  }

  // Mark as migrated and clean up old localStorage keys
  localStorage.setItem(LOCALSTORAGE_MIGRATED_KEY, 'true');
  localStorage.removeItem('devOrbitFavorites');
  localStorage.removeItem('devOrbitArchived');
  localStorage.removeItem('devOrbitPorts');
  localStorage.removeItem('devOrbitNames');
}

interface UseAppsReturn {
  apps: AppConfig[];
  loading: boolean;
  error: string | null;
  selectedAppId: string | null;
  selectedApp: AppConfig | undefined;
  settings: AppSettings | null;
  setSelectedAppId: (id: string | null) => void;
  handleStartApp: (id: string) => Promise<void>;
  handleStopApp: (id: string) => Promise<void>;
  handleRestartApp: (id: string) => Promise<void>;
  handleAnalyzeApp: (id: string) => Promise<void>;
  handleOpenInBrowser: (id: string) => Promise<void>;
  handleOpenInFinder: (id: string) => void;
  handleOpenInTerminal: (id: string) => void;
  handleToggleFavorite: (id: string) => Promise<void>;
  handleToggleArchive: (id: string) => Promise<void>;
  handleInstallDeps: (id: string) => Promise<void>;
  handleSetPort: (id: string, port: number) => Promise<void>;
  handleRename: (id: string, newName: string) => Promise<void>;
  handleReorderFavorites: (newOrder: string[]) => Promise<void>;
  handleSetFavoritesSortMode: (mode: FavoritesSortMode) => Promise<void>;
  handleConfigureAllPorts: () => Promise<void>;
  refreshApps: () => Promise<void>;
  runningCount: number;
  totalCpu: number;
}

export function useApps(): UseAppsReturn {
  const [apps, setApps] = useState<AppConfig[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  // Track last stats update time for uptime calculation
  const lastStatsUpdateRef = useRef<number>(Date.now());

  // Fetch apps from backend
  const refreshApps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // First, migrate any existing localStorage settings to backend (one-time)
      await migrateLocalStorageToBackend();

      // Fetch apps and settings from backend in parallel
      const [data, fetchedSettings] = await Promise.all([
        fetchApps(),
        fetchSettings(),
      ]);

      // Store settings in state
      setSettings(fetchedSettings);

      // Enrich app data with backend settings
      const enrichedData = data.map((app) => ({
        ...app,
        // Apply custom name if available
        name: fetchedSettings.customNames[app.id] ?? app.name,
        isFavorite: fetchedSettings.favorites.includes(app.id),
        isArchived: fetchedSettings.archived.includes(app.id),
        // Apply custom port if available
        port: fetchedSettings.customPorts[app.id] ?? app.port,
        addresses: fetchedSettings.customPorts[app.id]
          ? [`http://localhost:${fetchedSettings.customPorts[app.id]}`]
          : app.addresses,
      }));
      setApps(enrichedData);

      // Fetch logs for running apps (to restore logs after page refresh)
      const runningApps = enrichedData.filter(app => app.status === AppStatus.RUNNING);
      for (const app of runningApps) {
        try {
          const logsData = await fetchLogs(app.id, LOG_RETENTION_COUNT);
          if (logsData.length > 0) {
            // Transform backend log format to frontend string format (preserving ANSI codes)
            const formattedLogs = logsData.map(log => {
              const time = new Date(log.timestamp).toLocaleTimeString();
              return `[${time}] ${log.message}`;
            });
            setApps((currentApps) =>
              currentApps.map((a) =>
                a.id === app.id ? { ...a, logs: formattedLogs } : a
              )
            );
          }
        } catch {
          // Ignore log fetch errors - app data is still valid
        }
      }
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

  // Subscribe to real-time events using singleton SSE manager
  // This ensures only one SSE connection is used regardless of how many tabs are mounted
  useEffect(() => {
    const unsubscribe = subscribeToEventsShared(
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
      // On log - preserve ANSI codes for colored output
      ({ appId, message }) => {
        setApps((currentApps) =>
          currentApps.map((app) => {
            if (app.id !== appId) return app;
            const timestamp = new Date().toLocaleTimeString();
            // Split by newlines but preserve ANSI codes for colored rendering
            const lines = message.split(/\r?\n/).filter((line: string) => line.trim());
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

  // Subscribe to real-time stats via singleton SSE manager (replaces polling)
  // This ensures only one stats SSE connection is used regardless of how many tabs are mounted
  useEffect(() => {
    const unsubscribe = subscribeToStatsShared(
      // On stats update
      (statsUpdate: StatsUpdate) => {
        const now = Date.now();
        const timeDelta = (now - lastStatsUpdateRef.current) / 1000;
        lastStatsUpdateRef.current = now;

        setApps((currentApps) =>
          currentApps.map((app) => {
            if (app.id !== statsUpdate.appId) return app;
            // Only update stats for running apps
            if (app.status !== AppStatus.RUNNING) return app;
            return {
              ...app,
              uptime: app.uptime + timeDelta,
              stats: {
                cpu: [...app.stats.cpu.slice(1), statsUpdate.cpu],
                memory: [...app.stats.memory.slice(1), statsUpdate.memory],
              },
            };
          })
        );
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

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
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('Failed to analyze app:', errorMessage);
      setApps((currentApps) =>
        currentApps.map((a) =>
          a.id === id
            ? { ...a, status: AppStatus.STOPPED }
            : a
        )
      );
      toast.error(`Analysis failed: ${errorMessage}`);
    }
  }, [apps]);

  const handleOpenInBrowser = useCallback(
    async (id: string) => {
      const app = apps.find((a) => a.id === id);
      if (!app?.port || app.status !== AppStatus.RUNNING) {
        return;
      }

      const url = `http://localhost:${app.port}`;

      // Use Electron's shell.openExternal when running in Electron
      if (window.electronAPI?.openExternal) {
        try {
          console.log(`[useApps] Opening URL in external browser via Electron: ${url}`);
          const result = await window.electronAPI.openExternal(url);
          if (!result.success) {
            console.error('[useApps] Failed to open URL:', result.error);
            toast.error(`Failed to open browser: ${result.error}`);
          }
        } catch (err) {
          console.error('[useApps] Error opening URL via Electron:', err);
          toast.error('Failed to open browser');
        }
      } else {
        // Fallback for browser environment
        console.log(`[useApps] Opening URL in new tab: ${url}`);
        window.open(url, '_blank');
      }
    },
    [apps]
  );

  const handleToggleFavorite = useCallback(async (id: string) => {
    // Optimistically update UI
    const currentApp = apps.find((a) => a.id === id);
    const newFavoriteState = !currentApp?.isFavorite;

    setApps((currentApps) =>
      currentApps.map((app) =>
        app.id === id ? { ...app, isFavorite: newFavoriteState } : app
      )
    );

    // Persist to backend
    try {
      await updateFavorite(id, newFavoriteState);
    } catch (err) {
      console.error('Failed to update favorite:', err);
      // Revert on failure
      setApps((currentApps) =>
        currentApps.map((app) =>
          app.id === id ? { ...app, isFavorite: !newFavoriteState } : app
        )
      );
      toast.error('Failed to update favorite');
    }
  }, [apps]);

  const handleToggleArchive = useCallback(async (id: string) => {
    // Optimistically update UI
    const currentApp = apps.find((a) => a.id === id);
    const newArchiveState = !currentApp?.isArchived;

    setApps((currentApps) =>
      currentApps.map((app) =>
        app.id === id
          ? {
              ...app,
              isArchived: newArchiveState,
              // Remove from favorites when archiving (backend does this too)
              isFavorite: newArchiveState ? false : app.isFavorite,
            }
          : app
      )
    );

    // Persist to backend
    try {
      await updateArchive(id, newArchiveState);
    } catch (err) {
      console.error('Failed to update archive:', err);
      // Revert on failure
      setApps((currentApps) =>
        currentApps.map((app) =>
          app.id === id
            ? {
                ...app,
                isArchived: !newArchiveState,
                isFavorite: currentApp?.isFavorite ?? false,
              }
            : app
        )
      );
      toast.error('Failed to update archive');
    }
  }, [apps]);

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

  const handleSetPort = useCallback(async (id: string, port: number) => {
    const currentApp = apps.find((a) => a.id === id);
    const oldPort = currentApp?.port;

    // Optimistically update UI
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

    // Persist to backend
    try {
      await updatePort(id, port);
      toast.success(`Port updated to ${port}`);
    } catch (err) {
      console.error('Failed to update port:', err);
      // Revert on failure
      setApps((currentApps) =>
        currentApps.map((app) =>
          app.id === id
            ? {
                ...app,
                port: oldPort ?? 3000,
                addresses: oldPort ? [`http://localhost:${oldPort}`] : app.addresses,
              }
            : app
        )
      );
      toast.error('Failed to update port');
    }
  }, [apps]);

  const handleRename = useCallback(async (id: string, newName: string) => {
    const currentApp = apps.find((a) => a.id === id);
    const oldName = currentApp?.name;

    // Optimistically update UI
    setApps((currentApps) =>
      currentApps.map((app) =>
        app.id === id ? { ...app, name: newName } : app
      )
    );

    // Persist to backend
    try {
      await updateName(id, newName);
      toast.success(`Renamed "${oldName}" to "${newName}"`);
    } catch (err) {
      console.error('Failed to rename app:', err);
      // Revert on failure
      setApps((currentApps) =>
        currentApps.map((app) =>
          app.id === id ? { ...app, name: oldName ?? app.name } : app
        )
      );
      toast.error('Failed to rename app');
    }
  }, [apps]);

  const handleOpenInFinder = useCallback((id: string) => {
    const app = apps.find((a) => a.id === id);
    if (!app) return;
    // Use the API to open in Finder (macOS)
    fetch(`${API_BASE_URL}/apps/${id}/open-finder`, { method: 'POST' })
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
    fetch(`${API_BASE_URL}/apps/${id}/open-terminal`, { method: 'POST' })
      .catch(() => {
        // Fallback: copy path to clipboard
        navigator.clipboard.writeText(`cd "${app.path}"`);
        toast.success('Terminal command copied to clipboard');
      });
  }, [apps]);

  const handleReorderFavorites = useCallback(async (newOrder: string[]) => {
    // Store old order for rollback
    const oldOrder = settings?.favorites || [];

    // Optimistically update settings
    setSettings((prev) => prev ? { ...prev, favorites: newOrder } : null);

    // Persist to backend
    try {
      await updateFavoritesOrder(newOrder);
    } catch (err) {
      console.error('Failed to reorder favorites:', err);
      // Revert on failure
      setSettings((prev) => prev ? { ...prev, favorites: oldOrder } : null);
      toast.error('Failed to reorder favorites');
    }
  }, [settings]);

  const handleSetFavoritesSortMode = useCallback(async (mode: FavoritesSortMode) => {
    // Store old mode for rollback
    const oldMode = settings?.favoritesSortMode || 'manual';

    // Optimistically update settings
    setSettings((prev) => prev ? { ...prev, favoritesSortMode: mode } : null);

    // Persist to backend
    try {
      await updateFavoritesSortMode(mode);
    } catch (err) {
      console.error('Failed to update sort mode:', err);
      // Revert on failure
      setSettings((prev) => prev ? { ...prev, favoritesSortMode: oldMode } : null);
      toast.error('Failed to update sort mode');
    }
  }, [settings]);

  const handleConfigureAllPorts = useCallback(async (
    onProgress?: (current: number, total: number, percentage: number) => void
  ) => {
    // Check if there are any apps to configure
    if (apps.length === 0) {
      toast.error('No apps to configure. Please add some projects first.');
      return;
    }

    try {
      // Call the backend to configure all ports starting from DEFAULT_APP_START_PORT with progress tracking
      const result = await configureAllPorts(DEFAULT_APP_START_PORT, onProgress);

      // Check if any apps were actually configured
      const configuredCount = Object.keys(result.configured).length;
      if (configuredCount === 0) {
        toast.info('No apps were configured. All apps may already have assigned ports.');
        return;
      }

      // Update the UI with the new port assignments
      setApps((currentApps) =>
        currentApps.map((app) => {
          const newPort = result.configured[app.id];
          if (newPort) {
            return {
              ...app,
              port: newPort,
              addresses: [`http://localhost:${newPort}`],
            };
          }
          return app;
        })
      );

      // Update settings state - always update, even if settings haven't loaded yet
      setSettings((prev) => {
        // If prev is null, create a minimal settings object
        // This should only happen during initial load, settings will be refreshed on next fetch
        if (!prev) {
          return {
            favorites: [],
            archived: [],
            customPorts: result.configured,
            customNames: {},
            favoritesSortMode: 'manual',
            version: 1,
          };
        }
        // Otherwise merge the new port configuration
        return { ...prev, customPorts: { ...prev.customPorts, ...result.configured } };
      });

      toast.success(`Configured ports for ${configuredCount} apps starting from port ${DEFAULT_APP_START_PORT}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to configure ports';
      console.error('Failed to configure ports:', err);
      toast.error(errorMessage);
    }
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
    settings,
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
    handleReorderFavorites,
    handleSetFavoritesSortMode,
    handleConfigureAllPorts,
    refreshApps,
    runningCount,
    totalCpu,
  };
}
