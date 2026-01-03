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
export async function startApp(id: string, appPath: string, command: string): Promise<{ pid: number; status: string }> {
  const response = await fetch(`${API_BASE}/apps/${id}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: appPath, command }),
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
 * Server-Sent Events for real-time updates
 */
export function subscribeToEvents(
  onStatusChange: (data: { appId: string; status: string }) => void,
  onLog: (data: { appId: string; type: string; message: string }) => void
): () => void {
  const eventSource = new EventSource(`${API_BASE}/events`);

  eventSource.addEventListener('process-status', (event) => {
    const data = JSON.parse(event.data);
    onStatusChange(data);
  });

  eventSource.addEventListener('process-log', (event) => {
    const data = JSON.parse(event.data);
    onLog(data);
  });

  eventSource.onerror = () => {
    console.warn('SSE connection error, will retry...');
  };

  return () => {
    eventSource.close();
  };
}
