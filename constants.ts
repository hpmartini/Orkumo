/**
 * Application configuration constants
 */

/** Application name used throughout the app */
export { APP_NAME } from './electron/constants.js';

/**
 * Port configuration constants
 */

/** Port reserved for DevHub itself */
export const DEVHUB_RESERVED_PORT = 3000;

/** Default starting port for configuring application ports */
export const DEFAULT_APP_START_PORT = 3001;

/** Minimum port number for unprivileged ports (to prevent DoS) */
export const MIN_UNPRIVILEGED_PORT = 1024;

/** Maximum valid port number */
export const MAX_PORT = 65535;
