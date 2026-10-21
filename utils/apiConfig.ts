/**
 * API configuration utility for handling different environments
 * (Vite dev server with proxy vs Electron production with direct API calls)
 */

import { PORTS } from '../config/defaults';

// Detect if running in Electron
// In production: file:// protocol
// In dev mode: check for electronAPI which is exposed by preload.js
export const isElectron =
  typeof window !== 'undefined' &&
  (window.location.protocol === 'file:' || typeof window.electronAPI !== 'undefined');

// Server port: in Electron the main process owns the backend and reports the port
// it actually bound (SERVER_PORT / .env.local). Falling back to the compiled-in
// default silently breaks every request whenever the port is customised.
const SERVER_PORT =
  (typeof window !== 'undefined' &&
    // @ts-expect-error the global Window.electronAPI type is shadowed by the
    // narrower declaration in components/CodingView/ElectronBrowserView.tsx;
    // the full contract lives in electron/electron.d.ts
    window.electronAPI?.serverPort) ||
  PORTS.server;

// Base URL for API requests
export const API_BASE_URL = isElectron ? `http://localhost:${SERVER_PORT}/api` : '/api';

// WebSocket URL for PTY terminal connections
export const getWsUrl = (path: string = '/api/pty'): string => {
  if (isElectron) {
    return `ws://localhost:${SERVER_PORT}${path}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
};

// SSE URL for Server-Sent Events
export const getSSEUrl = (path: string): string => {
  return `${API_BASE_URL}${path.startsWith('/') ? path.slice(4) : path}`;
};
