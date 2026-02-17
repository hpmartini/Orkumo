/**
 * Centralized default configuration values (CommonJS version for server)
 *
 * This is the SINGLE SOURCE OF TRUTH for all configuration defaults.
 * Import from here instead of hardcoding values elsewhere.
 *
 * NOTE: This is a JavaScript version for Node.js server compatibility.
 * The TypeScript version (defaults.ts) is used by the frontend.
 */

/**
 * Port configuration
 */
export const PORTS = {
  /** Port for DevHub frontend (Vite dev server) */
  devhub: 3000,

  /** Port for backend API server */
  server: 3001,

  /** Default starting port for application port assignment */
  appStart: 3001,

  /** Minimum unprivileged port (prevents DoS via privileged port binding) */
  minUnprivileged: 1024,

  /** Maximum valid port number */
  max: 65535,
};

/**
 * Default ports by framework type
 */
export const FRAMEWORK_PORTS = {
  next: 3000,
  nextjs: 3000,
  react: 3000,
  cra: 3000,
  vue: 8080,
  vite: 5173,
  nuxt: 3000,
  node: 3000,
  express: 3000,
  default: 3000,
};

/**
 * Timeout and interval configuration (in milliseconds)
 */
export const TIMEOUTS = {
  /** SSE heartbeat interval */
  sseHeartbeat: 30000,

  /** Maximum SSE reconnection delay */
  maxReconnectDelay: 30000,

  /** Base delay for reconnection backoff */
  baseReconnectDelay: 1000,

  /** Maximum reconnection attempts */
  maxReconnectAttempts: 10,

  /** IDE minimum restart interval */
  ideRestartInterval: 30000,

  /** IDE startup warmup delay */
  ideWarmupDelay: 3000,
};

/**
 * Terminal configuration
 */
export const TERMINAL = {
  /** Default terminal columns */
  defaultCols: 80,

  /** Default terminal rows */
  defaultRows: 24,

  /** Whitelist of allowed custom commands */
  allowedCommands: ['claude'],

  /** Maximum number of arguments to prevent DoS */
  maxArgsLength: 50,
};

/**
 * Rate limiting configuration
 */
export const RATE_LIMIT = {
  /** Time window in milliseconds */
  windowMs: 60 * 1000,

  /** Maximum requests per window */
  maxRequests: 500,
};

/**
 * Default configuration for user config file (data/config.json)
 */
export const DEFAULT_USER_CONFIG = {
  /** Directories to scan - empty by default, user must configure */
  directories: [],

  /** How deep to scan subdirectories */
  scanDepth: 2,

  /** Patterns to exclude from scanning */
  excludePatterns: ['node_modules', '.git', 'dist', 'build', '.next'],
};
