/**
 * API configuration utility for handling different environments
 * (Vite dev server with proxy vs Electron production with direct API calls)
 */

// Detect if running in Electron
// In production: file:// protocol
// In dev mode: check for electronAPI which is exposed by preload.js
export const isElectron =
  typeof window !== 'undefined' &&
  (window.location.protocol === 'file:' ||
    // @ts-expect-error electronAPI is added by Electron preload script
    typeof window.electronAPI !== 'undefined');

// Base URL for API requests
export const API_BASE_URL = isElectron ? 'http://localhost:3001/api' : '/api';

// WebSocket URL for PTY terminal connections
export const getWsUrl = (path: string = '/api/pty'): string => {
  if (isElectron) {
    return `ws://localhost:3001${path}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
};

// SSE URL for Server-Sent Events
export const getSSEUrl = (path: string): string => {
  return `${API_BASE_URL}${path.startsWith('/') ? path.slice(4) : path}`;
};
