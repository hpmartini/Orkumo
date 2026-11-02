import { useState, useEffect, useCallback } from 'react';
import { AppConfig } from '../types';
import { fetchApps, fetchSettings, importSettings, AppSettings } from '../services/api';

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
  if (
    favorites.length > 0 ||
    archived.length > 0 ||
    Object.keys(customPorts).length > 0 ||
    Object.keys(customNames).length > 0
  ) {
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
  settings: AppSettings | null;
  refreshApps: () => Promise<void>;
}

/** The project registry: scanned projects plus their stored settings (names, favorites, ports) */
export function useApps(): UseAppsReturn {
  const [apps, setApps] = useState<AppConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  // Fetch apps from backend
  const refreshApps = useCallback(async () => {
    // `loading` covers the first load only: App shows a skeleton while it is set, and a refresh
    // (context switch, refresh button) must not unmount the shell with its attached terminals
    setError(null);
    try {
      // First, migrate any existing localStorage settings to backend (one-time)
      await migrateLocalStorageToBackend();

      // Fetch apps and settings from backend in parallel
      const [data, fetchedSettings] = await Promise.all([fetchApps(), fetchSettings()]);

      // Store settings in state
      setSettings(fetchedSettings);

      // Enrich app data with backend settings
      setApps(
        data.map((app) => ({
          ...app,
          name: fetchedSettings.customNames[app.id] ?? app.name,
          isFavorite: fetchedSettings.favorites.includes(app.id),
          isArchived: fetchedSettings.archived.includes(app.id),
          port: fetchedSettings.customPorts[app.id] ?? app.port,
          addresses: fetchedSettings.customPorts[app.id]
            ? [`http://localhost:${fetchedSettings.customPorts[app.id]}`]
            : app.addresses,
        }))
      );
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

  return { apps, loading, error, settings, refreshApps };
}
