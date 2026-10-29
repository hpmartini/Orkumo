import { AppConfig, AppStatus, KeyboardShortcuts } from '../types';
import { API_BASE_URL } from '../utils/apiConfig';

const API_BASE = API_BASE_URL;

/**
 * Fetch with exponential backoff retry logic
 * Retries on network errors or 5xx server errors
 */
async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  maxRetries = 3,
  baseDelay = 1000
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // Don't retry on client errors (4xx), only on server errors (5xx)
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response;
      }

      // Server error - will retry
      lastError = new Error(`Server error: ${response.status} ${response.statusText}`);
    } catch (err) {
      // Network error - will retry
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    // Don't delay after the last attempt
    if (attempt < maxRetries) {
      const delay = baseDelay * Math.pow(2, attempt); // 1s, 2s, 4s
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('Request failed after retries');
}

// Track active SSE connections for cleanup
const activeSSEConnections = new Set<EventSource>();

// Clean up SSE connections when page is unloaded
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    activeSSEConnections.forEach((eventSource) => {
      try {
        eventSource.close();
      } catch {
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
  const response = await fetchWithRetry(`${API_BASE}/apps`);
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
    status: (app.status as string as AppStatus) || AppStatus.STOPPED,
    uptime: (app.uptime as number) || 0,
    logs: (app.logs as string[]) || [],
    stats: {
      cpu: Array(20).fill(0),
      memory: Array(20).fill(0),
    },
  }));
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
  const response = await fetchWithRetry(`${API_BASE}/config`);
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

export type FavoritesSortMode = 'manual' | 'alpha-asc' | 'alpha-desc';

export interface AppSettings {
  favorites: string[];
  archived: string[];
  customPorts: Record<string, number>;
  customNames: Record<string, string>;
  preferredIDEs?: Record<string, string>;
  favoritesSortMode: FavoritesSortMode;
  keyboardShortcuts?: KeyboardShortcuts;
  version: number;
}

/**
 * Fetch all user settings from backend
 */
export async function fetchSettings(): Promise<AppSettings> {
  const response = await fetchWithRetry(`${API_BASE}/settings`);
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
 * Update keyboard shortcuts configuration
 */
export async function updateKeyboardShortcuts(
  shortcuts: KeyboardShortcuts
): Promise<{ keyboardShortcuts: KeyboardShortcuts }> {
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

export interface TopProcess {
  pid: number;
  name: string;
  /** full command line, truncated to 120 chars */
  command: string;
  cpuPercent: number;
  rssBytes: number;
}

export interface TopApp {
  name: string;
  processCount: number;
  cpuPercent: number;
  rssBytes: number;
}

export interface TopProcesses {
  byCpu: TopProcess[];
  byMemory: TopProcess[];
  byApp: TopApp[];
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
  topProcesses: TopProcesses;
  timestamp: number;
}

/**
 * Get full system health report
 */
export async function fetchSystemHealth(): Promise<SystemHealthReport> {
  const response = await fetchWithRetry(`${API_BASE}/system/health`);
  if (!response.ok) {
    throw new Error('Failed to fetch system health');
  }
  return response.json();
}

/**
 * Token usage and plan limits per AI provider
 */
export async function fetchUsage(
  days: import('../components/UsageView/types').UsageDays
): Promise<import('../components/UsageView/types').UsageResponse> {
  const response = await fetchWithRetry(`${API_BASE}/usage?days=${days}`);
  if (!response.ok) {
    throw new Error('Failed to fetch usage');
  }
  return response.json();
}
