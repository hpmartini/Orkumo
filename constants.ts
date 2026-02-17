/**
 * Application configuration constants
 *
 * Re-exports centralized configuration from config/defaults.ts
 */

import { PORTS } from './config/defaults';

/** Application name used throughout the app */
export { APP_NAME } from './electron/constants.js';

/**
 * Port configuration constants
 */

/** Port reserved for DevHub itself */
export const DEVHUB_RESERVED_PORT = PORTS.devhub;

/** Default starting port for configuring application ports */
export const DEFAULT_APP_START_PORT = PORTS.appStart;

/** Minimum port number for unprivileged ports (to prevent DoS) */
export const MIN_UNPRIVILEGED_PORT = PORTS.minUnprivileged;

/** Maximum valid port number */
export const MAX_PORT = PORTS.max;

/** Server port for API */
export const SERVER_PORT = PORTS.server;
