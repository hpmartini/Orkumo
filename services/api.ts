import { AppConfig, AppStatus } from '../types';

const API_BASE = '/api';

/**
 * Fetch all discovered apps from configured directories
 */
export async function fetchApps(): Promise<AppConfig[]> {
  const response = await fetch(`${API_BASE}/apps`);
  if (!response.ok) {
    throw new Error(`Failed to fetch apps: ${response.statusText}`);
  }
  const data = await response.json();

  // Transform backend format to frontend format
  return data.map((app: Record<string, unknown>) => ({
    id: app.id as string,
    name: app.name as string,
    path: app.path as string,
    type: app.type as AppConfig['type'],
    port: app.port as number,
    addresses: app.addresses as string[],
    startCommand: app.startCommand as string,
    detectedFramework: app.detectedFramework as string,
    status: (app.status as string) as AppStatus || AppStatus.STOPPED,
    uptime: (app.uptime as number) || 0,
    logs: (app.logs as string[]) || [],
    stats: {
      cpu: Array(20).fill(0),
      memory: Array(20).fill(0),
    },
  }));
}

/**
 * Start an app process
 */
export async function startApp(id: string, appPath: string, command: string, port?: number): Promise<{ pid: number; status: string }> {
  const response = await fetch(`${API_BASE}/apps/${id}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: appPath, command, port }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to start app');
  }

  return response.json();
}

/**
 * Stop an app process
 */
export async function stopApp(id: string): Promise<{ status: string }> {
  const response = await fetch(`${API_BASE}/apps/${id}/stop`, {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to stop app');
  }

  return response.json();
}

/**
 * Restart an app process
 */
export async function restartApp(id: string): Promise<{ pid: number; status: string }> {
  const response = await fetch(`${API_BASE}/apps/${id}/restart`, {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to restart app');
  }

  return response.json();
}

/**
 * Get logs for an app
 */
export async function fetchLogs(id: string, limit = 50): Promise<Array<{ type: string; message: string; timestamp: string }>> {
  const response = await fetch(`${API_BASE}/apps/${id}/logs?limit=${limit}`);
  if (!response.ok) {
    return [];
  }
  return response.json();
}

/**
 * Get app status
 */
export async function fetchAppStatus(id: string): Promise<{ status: string; pid?: number; uptime: number }> {
  const response = await fetch(`${API_BASE}/apps/${id}/status`);
  if (!response.ok) {
    return { status: 'STOPPED', uptime: 0 };
  }
  return response.json();
}

/**
 * Configuration API
 */
export interface Config {
  directories: string[];
  scanDepth: number;
  excludePatterns: string[];
}

export async function fetchConfig(): Promise<Config> {
  const response = await fetch(`${API_BASE}/config`);
  if (!response.ok) {
    throw new Error('Failed to fetch config');
  }
  return response.json();
}

export async function updateConfig(config: Partial<Config>): Promise<Config> {
  const response = await fetch(`${API_BASE}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    throw new Error('Failed to update config');
  }
  return response.json();
}

export async function addDirectory(path: string): Promise<Config> {
  const response = await fetch(`${API_BASE}/config/directories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to add directory');
  }
  return response.json();
}

export async function removeDirectory(path: string): Promise<Config> {
  const response = await fetch(`${API_BASE}/config/directories`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!response.ok) {
    throw new Error('Failed to remove directory');
  }
  return response.json();
}

/**
 * Server-Sent Events for real-time updates with automatic reconnection
 */
export function subscribeToEvents(
  onStatusChange: (data: { appId: string; status: string }) => void,
  onLog: (data: { appId: string; type: string; message: string }) => void,
  onConnectionChange?: (connected: boolean) => void,
  onStats?: (data: { appId: string; cpu: number; memory: number; uptime?: number }) => void
): () => void {
  let eventSource: EventSource | null = null;
  let reconnectAttempts = 0;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let isClosing = false;

  const MAX_RECONNECT_ATTEMPTS = 10;
  const BASE_RECONNECT_DELAY = 1000;
  const MAX_RECONNECT_DELAY = 30000;

  function getReconnectDelay(): number {
    // Exponential backoff with jitter
    const delay = Math.min(
      BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts),
      MAX_RECONNECT_DELAY
    );
    return delay + Math.random() * 1000;
  }

  function connect() {
    if (isClosing) return;

    eventSource = new EventSource(`${API_BASE}/events`);

    eventSource.addEventListener('connected', () => {
      reconnectAttempts = 0;
      onConnectionChange?.(true);
    });

    eventSource.addEventListener('heartbeat', () => {
      // Heartbeat received, connection is healthy
    });

    eventSource.addEventListener('process-status', (event) => {
      try {
        const data = JSON.parse(event.data);
        onStatusChange(data);
      } catch (err) {
        console.error('Failed to parse process-status event:', err);
      }
    });

    eventSource.addEventListener('process-log', (event) => {
      try {
        const data = JSON.parse(event.data);
        onLog(data);
      } catch (err) {
        console.error('Failed to parse process-log event:', err);
      }
    });

    eventSource.addEventListener('process-stats', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (onStats) {
          onStats(data);
        }
      } catch (err) {
        console.error('Failed to parse process-stats event:', err);
      }
    });

    eventSource.onerror = () => {
      onConnectionChange?.(false);
      eventSource?.close();
      eventSource = null;

      // Clear existing timeout before setting new one to prevent memory leaks
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }

      if (!isClosing && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = getReconnectDelay();
        console.warn(`SSE connection error, reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
        reconnectTimeout = setTimeout(() => {
          reconnectAttempts++;
          connect();
        }, delay);
      } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error('SSE max reconnection attempts reached');
      }
    };
  }

  connect();

  return () => {
    isClosing = true;
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }
    eventSource?.close();
  };
}

/**
 * Fetch package.json content for an app
 */
export async function fetchAppPackage(id: string): Promise<{ fileName: string; content: string }> {
  const response = await fetch(`${API_BASE}/apps/${id}/package`);
  if (!response.ok) {
    throw new Error('Failed to fetch package.json');
  }
  return response.json();
}

/**
 * Fetch real CPU/memory stats for an app
 */
export async function fetchAppStats(id: string): Promise<{ cpu: number; memory: number }> {
  const response = await fetch(`${API_BASE}/apps/${id}/stats`);
  if (!response.ok) {
    return { cpu: 0, memory: 0 };
  }
  return response.json();
}

// ============================================
// Settings API - Backend persistence
// ============================================

export type FavoritesSortMode = 'manual' | 'alpha-asc' | 'alpha-desc';

export interface AppSettings {
  favorites: string[];
  archived: string[];
  customPorts: Record<string, number>;
  customNames: Record<string, string>;
  preferredIDEs?: Record<string, string>;
  favoritesSortMode: FavoritesSortMode;
  version: number;
}

/**
 * Fetch all user settings from backend
 */
export async function fetchSettings(): Promise<AppSettings> {
  const response = await fetch(`${API_BASE}/settings`);
  if (!response.ok) {
    // Return default settings if fetch fails
    return {
      favorites: [],
      archived: [],
      customPorts: {},
      customNames: {},
      favoritesSortMode: 'manual',
      version: 1,
    };
  }
  return response.json();
}

/**
 * Import settings from localStorage (migration)
 */
export async function importSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  const response = await fetch(`${API_BASE}/settings/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    throw new Error('Failed to import settings');
  }
  return response.json();
}

/**
 * Toggle or set favorite status for an app
 */
export async function updateFavorite(id: string, value?: boolean): Promise<{ id: string; isFavorite: boolean }> {
  const response = await fetch(`${API_BASE}/settings/favorite/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value !== undefined ? { value } : {}),
  });
  if (!response.ok) {
    throw new Error('Failed to update favorite');
  }
  return response.json();
}

/**
 * Reorder favorites array
 */
export async function updateFavoritesOrder(order: string[]): Promise<{ favorites: string[] }> {
  const response = await fetch(`${API_BASE}/settings/favorites/order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  });
  if (!response.ok) {
    throw new Error('Failed to update favorites order');
  }
  return response.json();
}

/**
 * Set favorites sort mode
 */
export async function updateFavoritesSortMode(mode: FavoritesSortMode): Promise<{ favoritesSortMode: FavoritesSortMode }> {
  const response = await fetch(`${API_BASE}/settings/favorites/sort-mode`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!response.ok) {
    throw new Error('Failed to update favorites sort mode');
  }
  return response.json();
}

/**
 * Toggle or set archive status for an app
 */
export async function updateArchive(id: string, value?: boolean): Promise<{ id: string; isArchived: boolean }> {
  const response = await fetch(`${API_BASE}/settings/archive/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value !== undefined ? { value } : {}),
  });
  if (!response.ok) {
    throw new Error('Failed to update archive');
  }
  return response.json();
}

/**
 * Set custom port for an app
 */
export async function updatePort(id: string, port: number | null): Promise<{ id: string; port: number | null }> {
  const response = await fetch(`${API_BASE}/settings/port/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ port }),
  });
  if (!response.ok) {
    throw new Error('Failed to update port');
  }
  return response.json();
}

/**
 * Set custom name for an app
 */
export async function updateName(id: string, name: string | null): Promise<{ id: string; name: string | null }> {
  const response = await fetch(`${API_BASE}/settings/name/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new Error('Failed to update name');
  }
  return response.json();
}

// ============================================
// IDE Integration API
// ============================================

export interface IDE {
  id: string;
  name: string;
  path: string;
  custom?: boolean;
}

/**
 * Get list of installed IDEs on the system
 */
export async function fetchInstalledIDEs(): Promise<IDE[]> {
  const response = await fetch(`${API_BASE}/ides/installed`);
  if (!response.ok) {
    return [];
  }
  const data = await response.json();
  return data.ides || [];
}

/**
 * Open app in specified IDE
 */
export async function openInIDE(appId: string, ideId: string): Promise<{ success: boolean; ide: string; message?: string }> {
  const response = await fetch(`${API_BASE}/apps/${appId}/open-ide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ide: ideId }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to open IDE');
  }
  return response.json();
}

/**
 * Set preferred IDE for an app
 */
export async function updatePreferredIDE(appId: string, ideId: string | null): Promise<{ id: string; ide: string | null }> {
  const response = await fetch(`${API_BASE}/settings/preferred-ide/${appId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ide: ideId }),
  });
  if (!response.ok) {
    throw new Error('Failed to update preferred IDE');
  }
  return response.json();
}

/**
 * Get all custom IDEs
 */
export async function fetchCustomIDEs(): Promise<IDE[]> {
  const response = await fetch(`${API_BASE}/ides/custom`);
  if (!response.ok) {
    return [];
  }
  const data = await response.json();
  return data.ides || [];
}

/**
 * Add a custom IDE
 */
export async function addCustomIDE(id: string, name: string, path: string): Promise<IDE> {
  const response = await fetch(`${API_BASE}/ides/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name, path }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to add custom IDE');
  }
  const data = await response.json();
  return data.ide;
}

/**
 * Remove a custom IDE
 */
export async function removeCustomIDE(id: string): Promise<boolean> {
  const response = await fetch(`${API_BASE}/ides/custom/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to remove custom IDE');
  }
  return true;
}
