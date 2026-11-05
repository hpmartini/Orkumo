/**
 * Application configuration constants
 * Shared between Electron and the main application
 */

/** Application name used throughout the app */
export const APP_NAME = 'Orkumo';

/**
 * userData folder name from before the rename to Orkumo (issue #196). Electron derives userData from the
 * package.json name (electron-builder does not copy productName into app.asar), so packaged and dev
 * runs both used "devorbit-dashboard". Without pinning, existing installs would start with empty data.
 */
export const LEGACY_USER_DATA_DIR = 'devorbit-dashboard';
