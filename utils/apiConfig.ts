/**
 * API configuration utility for handling different environments
 * (Vite dev server with proxy vs Electron production with direct API calls)
 */

import { PORTS } from '../config/defaults';
import { readPairing, type Pairing } from './remoteClient';

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
  (typeof window !== 'undefined' && window.electronAPI?.serverPort) || PORTS.server;

/** A bundle loaded from a non-web origin (e.g. capacitor://) has no server of its own. */
export const isBundledOrigin = (protocol: string): boolean => !/^(https?|file):$/.test(protocol);

// Bundled client such as the iOS app from DevHub-pro: talks to the paired Mac (remoteClient).
export const isNativeApp =
  typeof window !== 'undefined' && isBundledOrigin(window.location.protocol);
export const pairing = isNativeApp ? readPairing() : null;

/** Server origin when the API is not same-origin (Electron, iOS app); '' otherwise. */
export const serverOrigin = (native: boolean, paired: Pairing | null, electron: boolean): string =>
  native ? (paired?.url ?? '') : electron ? `http://localhost:${SERVER_PORT}` : '';

const SERVER_ORIGIN = serverOrigin(isNativeApp, pairing, isElectron);

// Base URL for API requests
export const API_BASE_URL = `${SERVER_ORIGIN}/api`;

// WebSocket URL for PTY terminal connections
export const getWsUrl = (path: string = '/api/pty'): string => {
  if (SERVER_ORIGIN) {
    return `${SERVER_ORIGIN.replace(/^http/, 'ws')}${path}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
};

// SSE URL for Server-Sent Events
export const getSSEUrl = (path: string): string => {
  return `${API_BASE_URL}${path.startsWith('/') ? path.slice(4) : path}`;
};
