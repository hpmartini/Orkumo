import { AppConfig, AppStatus, KeyboardShortcuts } from '../types';
import { DEFAULT_APP_START_PORT } from '../constants';
import { API_BASE_URL } from '../utils/apiConfig';

const API_BASE = API_BASE_URL;

// Track active SSE connections for cleanup
const activeSSEConnections = new Set<EventSource>();

// Clean up SSE connections when page is unloaded
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    activeSSEConnections.forEach((eventSource) => {
      try {
        eventSource.close();
      } catch (err) {
        // Connection already closed, ignore
      }
    });
    activeSSEConnections.clear();
  });
}

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
  onConnectionChange?: (connected: boolean) => void
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
 * Stats update from SSE stream
 */
export interface StatsUpdate {
  appId: string;
  cpu: number;
  memory: number;
}

/**
 * Subscribe to real-time stats updates via Server-Sent Events (SSE)
 * This replaces the polling approach with a more efficient pub-sub pattern
 */
export function subscribeToStats(
  onStats: (data: StatsUpdate) => void,
  onConnectionChange?: (connected: boolean) => void
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

    eventSource = new EventSource(`${API_BASE}/apps/stats/stream`);
    activeSSEConnections.add(eventSource);

    eventSource.addEventListener('connected', () => {
      reconnectAttempts = 0;
      onConnectionChange?.(true);
    });

    eventSource.addEventListener('heartbeat', () => {
      // Heartbeat received, connection is healthy
    });

    eventSource.addEventListener('stats', (event) => {
      try {
        const data = JSON.parse(event.data) as StatsUpdate;
        onStats(data);
      } catch (err) {
        console.error('Failed to parse stats event:', err);
      }
    });

    eventSource.onerror = () => {
      onConnectionChange?.(false);
      if (eventSource) {
        activeSSEConnections.delete(eventSource);
        eventSource.close();
      }
      eventSource = null;

      // Clear existing timeout before setting new one to prevent memory leaks
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }

      if (!isClosing && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = getReconnectDelay();
        console.warn(`Stats SSE connection error, reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
        reconnectTimeout = setTimeout(() => {
          reconnectAttempts++;
          connect();
        }, delay);
      } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error('Stats SSE max reconnection attempts reached');
      }
    };
  }

  connect();

  return () => {
    isClosing = true;
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }
    if (eventSource) {
      activeSSEConnections.delete(eventSource);
      eventSource.close();
    }
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

/**
 * Configure ports for all apps consistently, starting from a base port
 * @param startPort - Starting port number
 * @param onProgress - Optional progress callback (current, total, percentage)
 */
export async function configureAllPorts(
  startPort = DEFAULT_APP_START_PORT,
  onProgress?: (current: number, total: number, percentage: number) => void
): Promise<{ configured: Record<string, number> }> {
  // Generate a secure session ID using crypto API
  const sessionId = onProgress ? crypto.randomUUID() : undefined;

  // Connect to SSE endpoint for progress updates if onProgress is provided
  let eventSource: EventSource | null = null;
  if (sessionId && onProgress) {
    // Wait for SSE connection to be established before making POST request
    await new Promise<void>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let isResolved = false;

      eventSource = new EventSource(`${API_BASE}/settings/configure-ports/progress/${sessionId}`);

      // Track connection for cleanup on page unload
      activeSSEConnections.add(eventSource);

      const resolveOnce = () => {
        if (!isResolved) {
          isResolved = true;
          if (timeoutId) clearTimeout(timeoutId);
          resolve();
        }
      };

      // Set onmessage handler BEFORE checking readyState to avoid race condition
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'connected') {
            // Connection established, proceed with POST request
            resolveOnce();
          } else if (data.type === 'progress') {
            onProgress(data.current, data.total, data.percentage);
          }
        } catch (err) {
          console.error('Failed to parse SSE progress data:', err);
        }
      };

      eventSource.onerror = () => {
        if (timeoutId) clearTimeout(timeoutId);
        eventSource?.close();
        reject(new Error('Failed to establish SSE connection'));
      };

      // Set onopen handler as an additional safety measure
      eventSource.onopen = () => {
        // If we're already open, resolve immediately
        // This handles the case where 'connected' message might be delayed
        resolveOnce();
      };

      // Check if already connected after setting up handler
      if (eventSource.readyState === EventSource.OPEN) {
        resolveOnce();
        return;
      }

      // Timeout if connection takes too long
      timeoutId = setTimeout(() => {
        reject(new Error('SSE connection timeout'));
      }, 5000);
    });
  }

  try {
    const response = await fetch(`${API_BASE}/settings/configure-ports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startPort, sessionId }),
    });

    if (!response.ok) {
      // Try to parse backend error message, fallback to response text
      let errorMessage = 'Failed to configure ports';
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch {
        // JSON parsing failed, use default message
      }
      throw new Error(errorMessage);
    }

    return await response.json();
  } finally {
    // Clean up SSE connection
    if (eventSource) {
      eventSource.close();
      activeSSEConnections.delete(eventSource);
    }
  }
}

/**
 * Update keyboard shortcuts configuration
 */
export async function updateKeyboardShortcuts(shortcuts: KeyboardShortcuts): Promise<{ keyboardShortcuts: KeyboardShortcuts }> {
  const response = await fetch(`${API_BASE}/settings/keyboard-shortcuts`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shortcuts }),
  });
  if (!response.ok) {
    throw new Error('Failed to update keyboard shortcuts');
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

// ============================================
// API Keys Management
// ============================================

export interface ApiKeyInfo {
  configured: boolean;
  maskedKey: string;
}

/**
 * Fetch configured API keys (masked)
 */
export async function fetchApiKeys(): Promise<Record<string, ApiKeyInfo>> {
  const response = await fetch(`${API_BASE}/settings/api-keys`);
  if (!response.ok) {
    return {};
  }
  return response.json();
}

/**
 * Set an API key for a provider
 */
export async function updateApiKey(provider: string, key: string): Promise<{ provider: string; maskedKey: string; configured: boolean }> {
  const response = await fetch(`${API_BASE}/settings/api-keys/${provider}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update API key');
  }
  return response.json();
}

/**
 * Remove an API key for a provider
 */
export async function removeApiKey(provider: string): Promise<{ provider: string; configured: boolean }> {
  const response = await fetch(`${API_BASE}/settings/api-keys/${provider}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to remove API key');
  }
  return response.json();
}

/**
 * Validate an API key for a provider
 */
export async function validateApiKey(provider: string, key: string): Promise<{ valid: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/settings/api-keys/${provider}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to validate API key');
  }
  return response.json();
}

// ============================================
// Docker Compose API
// ============================================

export interface DockerContainerStatus {
  id?: string;
  name: string;
  service?: string;
  status: 'running' | 'exited' | 'paused' | 'created' | 'unknown';
  ports?: string;
  image?: string;
}

export interface DockerStatusResponse {
  containers: DockerContainerStatus[];
  error?: string;
}

export interface DockerServiceInfo {
  name: string;
  image?: string | null;
  ports?: string[];
  status: string;
}

export interface DockerServicesResponse {
  services: DockerServiceInfo[];
  error?: string;
}

export interface DockerActionResponse {
  success: boolean;
  message?: string;
  output?: string;
  error?: string;
}

export interface DockerLogsResponse {
  success: boolean;
  logs?: string;
  error?: string;
}

/**
 * Check if Docker is available on the system
 */
export async function isDockerAvailable(): Promise<boolean> {
  const response = await fetch(`${API_BASE}/docker/available`);
  if (!response.ok) {
    return false;
  }
  const data = await response.json();
  return data.available === true;
}

/**
 * Get Docker container status for an app
 */
export async function fetchDockerStatus(appId: string): Promise<DockerStatusResponse> {
  const response = await fetch(`${API_BASE}/apps/${appId}/docker/status`);
  if (!response.ok) {
    return { containers: [], error: 'Failed to fetch Docker status' };
  }
  return response.json();
}

/**
 * Get Docker services defined in compose file
 */
export async function fetchDockerServices(appId: string): Promise<DockerServicesResponse> {
  const response = await fetch(`${API_BASE}/apps/${appId}/docker/services`);
  if (!response.ok) {
    return { services: [], error: 'Failed to fetch Docker services' };
  }
  return response.json();
}

/**
 * Start Docker containers for an app
 */
export async function startDockerContainers(appId: string, serviceName?: string): Promise<DockerActionResponse> {
  const response = await fetch(`${API_BASE}/apps/${appId}/docker/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service: serviceName }),
  });
  if (!response.ok) {
    const error = await response.json();
    return { success: false, error: error.error || 'Failed to start containers' };
  }
  return response.json();
}

/**
 * Stop Docker containers for an app
 */
export async function stopDockerContainers(appId: string, serviceName?: string): Promise<DockerActionResponse> {
  const response = await fetch(`${API_BASE}/apps/${appId}/docker/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service: serviceName }),
  });
  if (!response.ok) {
    const error = await response.json();
    return { success: false, error: error.error || 'Failed to stop containers' };
  }
  return response.json();
}

/**
 * Restart Docker containers for an app
 */
export async function restartDockerContainers(appId: string, serviceName?: string): Promise<DockerActionResponse> {
  const response = await fetch(`${API_BASE}/apps/${appId}/docker/restart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service: serviceName }),
  });
  if (!response.ok) {
    const error = await response.json();
    return { success: false, error: error.error || 'Failed to restart containers' };
  }
  return response.json();
}

/**
 * Get Docker logs for an app
 */
export async function fetchDockerLogs(appId: string, serviceName?: string, tail = 100): Promise<DockerLogsResponse> {
  const params = new URLSearchParams({ tail: String(tail) });
  if (serviceName) {
    params.append('service', serviceName);
  }
  const response = await fetch(`${API_BASE}/apps/${appId}/docker/logs?${params}`);
  if (!response.ok) {
    return { success: false, error: 'Failed to fetch Docker logs' };
  }
  return response.json();
}

/**
 * Pull latest Docker images for an app
 */
export async function pullDockerImages(appId: string): Promise<DockerActionResponse> {
  const response = await fetch(`${API_BASE}/apps/${appId}/docker/pull`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json();
    return { success: false, error: error.error || 'Failed to pull images' };
  }
  return response.json();
}

/**
 * Build Docker images for an app
 */
export async function buildDockerImages(appId: string, serviceName?: string): Promise<DockerActionResponse> {
  const response = await fetch(`${API_BASE}/apps/${appId}/docker/build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service: serviceName }),
  });
  if (!response.ok) {
    const error = await response.json();
    return { success: false, error: error.error || 'Failed to build images' };
  }
  return response.json();
}

/**
 * Remove Docker containers for an app (docker compose down)
 */
export async function removeDockerContainers(appId: string, removeVolumes = false): Promise<DockerActionResponse> {
  const response = await fetch(`${API_BASE}/apps/${appId}/docker/down`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volumes: removeVolumes }),
  });
  if (!response.ok) {
    const error = await response.json();
    return { success: false, error: error.error || 'Failed to remove containers' };
  }
  return response.json();
}

// ============================================
// System Health API
// ============================================

export interface SystemVersionInfo {
  installed: boolean;
  version: string | null;
  running?: boolean;
}

export interface SystemVersions {
  node: SystemVersionInfo;
  npm: SystemVersionInfo;
  git: SystemVersionInfo;
  docker: SystemVersionInfo & { running: boolean };
  versionManager: {
    manager: 'nvm' | 'volta' | 'fnm' | 'asdf' | 'system';
    path: string | null;
  };
  timestamp: number;
}

export interface MemoryInfo {
  total: number;
  free: number;
  used: number;
  usedPercent: number;
}

export interface CpuInfo {
  cores: number;
  model: string;
  loadAverage: {
    '1min': number;
    '5min': number;
    '15min': number;
  };
}

export interface DiskInfo {
  total: number;
  used: number;
  available: number;
  usedPercent: number;
}

export interface SystemRecommendation {
  type: 'update' | 'service' | 'disk' | 'memory' | 'project';
  severity: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  action?: string;
}

export interface SystemHealthReport {
  system: {
    versions: SystemVersions;
    memory: MemoryInfo;
    cpu: CpuInfo;
    disk: DiskInfo | null;
    platform: string;
    arch: string;
    hostname: string;
    uptime: number;
  };
  recommendations: SystemRecommendation[];
  timestamp: number;
}

export interface ProjectHealthCheck {
  name: string;
  status: 'ok' | 'missing' | 'stale';
  severity: 'ok' | 'info' | 'warning' | 'error';
  message: string;
  action?: string | null;
}

export interface ProjectHealth {
  path: string;
  checks: ProjectHealthCheck[];
}

/**
 * Get full system health report
 */
export async function fetchSystemHealth(): Promise<SystemHealthReport> {
  const response = await fetch(`${API_BASE}/system/health`);
  if (!response.ok) {
    throw new Error('Failed to fetch system health');
  }
  return response.json();
}

/**
 * Get system tool versions
 */
export async function fetchSystemVersions(): Promise<SystemVersions> {
  const response = await fetch(`${API_BASE}/system/versions`);
  if (!response.ok) {
    throw new Error('Failed to fetch system versions');
  }
  return response.json();
}

/**
 * Get project health check
 */
export async function fetchProjectHealth(appId: string): Promise<ProjectHealth> {
  const response = await fetch(`${API_BASE}/apps/${appId}/health`);
  if (!response.ok) {
    throw new Error('Failed to fetch project health');
  }
  return response.json();
}
