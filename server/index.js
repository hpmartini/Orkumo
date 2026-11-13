import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { agentViewSettingsSchema, optionalShortString } from './schemas/agentViewSettings.js';
import http, { createServer } from 'http';
import { timingSafeEqual } from 'crypto';
import { WebSocketServer } from 'ws';
import path from 'path';
import os from 'os';
// NOTE: This is an API-only server. Static files are served by Nginx in the frontend container.
import {
  getConfig,
  updateConfig,
  addDirectory,
  removeDirectory,
} from './services/configService.js';
import {
  scanAllDirectories,
  scanDirectory,
  applyProjectOverrides,
  projectCatalog,
  validateProjectRoot,
} from './services/scannerService.js';
import { migrateDirectorySpelling } from './services/directoryMigration.js';
import {
  createPtySession,
  openAgentPty,
  restoreHeldPtys,
  writeToPty,
  resizePty,
  killPtySession,
  killPanePtys,
  typeIntoPanePty,
  ptyEvents,
  detectClaudeCLI,
} from './services/ptyService.js';
import { startQuickAgent } from './services/quickAgent.js';
import { listOmpSessions } from './services/ompSessions.js';
import * as orchestrator from './services/orchestratorService.js';
import { exec } from 'child_process';
import fs from 'fs';
import WebSocket from 'ws';
import { initializeDatabase, isDatabaseConnected, getDb } from './db/index.js';
import { terminalSessionManager } from './services/TerminalSessionManager.js';
import { settingsService } from './services/settingsService.js';
import { ideService } from './services/ideService.js';
import { getToolVersions } from './services/toolVersionsService.js';
import * as agentService from './services/agentService.js';
import * as chatService from './services/chatService.js';
import * as chatStatus from './services/chatStatus.js';
import { ompSkillsArgs } from './services/ompSkills.js';
import { getSelfDnsName } from './services/tailscale.js';
import * as remoteAccess from './services/remoteAccess.js';
import ghosttyRoutes from './services/ghosttyRoutes.js';
import fileOpenRoutes from './services/fileOpenRoutes.js';
import { usageRouter, getUsage } from './services/usageService.js';
import {
  getAgentContexts,
  cachedProjectSessionCounts,
  getKnownServerPids,
  getOrphanServers,
  stopOrphanServer,
} from './services/agentContextService.js';
import * as boardService from './services/boardService.js';
import * as issueListService from './services/issueListService.js';
import { createChatHistory } from './services/chatHistoryService.js';
import * as imageUpload from './services/imageUpload.js';
import * as workflowProvider from './services/workflowProvider.js';
import { ISSUE_URL_RE } from '../utils/issueUrl.js';
import * as codeService from './services/codeService.js';
import { createModuleHost, getModulesDir } from './services/moduleLoader.js';
import {
  getProcessStats as getServerProcessStats,
  parsePids,
} from './services/processStatsService.js';
import { PORTS, TERMINAL, RATE_LIMIT, TIMEOUTS } from '../config/defaults.js';
import {
  HARNESS_COMMANDS,
  isHarnessCommand,
  harnessArgsError,
  resolveHarnessBinary,
  MAX_HARNESS_PROMPT,
} from '../config/harnesses.js';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

const app = express();
const PORT = process.env.SERVER_PORT || PORTS.server;

// Constants from centralized config
const DEFAULT_TERMINAL_COLS = TERMINAL.defaultCols;
const DEFAULT_TERMINAL_ROWS = TERMINAL.defaultRows;
const ALLOWED_COMMANDS = TERMINAL.allowedCommands;
const MAX_ARGS_LENGTH = TERMINAL.maxArgsLength;

// Detect if running inside Docker container
const isRunningInDocker = (() => {
  // Check for /.dockerenv file (most reliable)
  if (fs.existsSync('/.dockerenv')) {
    return true;
  }
  // Check for explicit env var
  if (process.env.RUNNING_IN_DOCKER === 'true') {
    return true;
  }
  // Check cgroup (Linux containers)
  try {
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
    if (cgroup.includes('docker') || cgroup.includes('kubepods')) {
      return true;
    }
  } catch {
    // Not Linux or no cgroup access
  }
  return false;
})();

// Host PTY service URL (for Docker mode)
const PTY_HOST_URL = process.env.PTY_HOST_URL || 'ws://host.docker.internal:3096';

console.log(`[Server] Running in Docker: ${isRunningInDocker}`);
if (isRunningInDocker) {
  console.log(`[Server] PTY will proxy to host service at: ${PTY_HOST_URL}`);
}

// Rate limiting - prevent DoS attacks
// NOTE: Rate limit increased from 100 to 500 to support multi-tab rendering
// where each tab may make requests. SSE endpoints are exempted below.
const limiter = rateLimit({
  windowMs: RATE_LIMIT.windowMs,
  max: RATE_LIMIT.maxRequests,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for SSE endpoints (they're long-lived connections, not repeated requests)
  skip: (req) => {
    const sseEndpoints = ['/api/agents/stream'];
    return sseEndpoints.some((endpoint) => req.path === endpoint);
  },
});

// Browser origins allowed to call the API: loopback on any port (dashboard, Vite, Electron dev) and
// extra origins via CORS_ORIGINS (comma-separated). Requests without an Origin header (curl,
// server-to-server) are not browser-driven and pass. Opaque origins: isOpaqueRequest below.
const extraCorsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (extraCorsOrigins.includes(origin)) return true;
  if (origin === remoteAccess.CAPACITOR_ORIGIN) return remoteAccess.isRemoteEnabled();
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
};
// The packaged renderer runs on file://: Origin "null" on fetch, "file://" on the WebSocket
// upgrade, and no Origin but `Sec-Fetch-Site: cross-site` on some requests. Any sandboxed iframe or
// local file sends the same, so that shape passes only with the per-launch secret Electron main
// adds to its own windows' requests (electron/rendererSecret.js), or with the pairing token.
// Read once and dropped from the env, so PTYs and agents do not inherit it.
const RENDERER_SECRET = Buffer.from(process.env.DEVORBIT_RENDERER_SECRET ?? '');
delete process.env.DEVORBIT_RENDERER_SECRET;
const hasRendererSecret = (req) => {
  const sent = Buffer.from(String(req.headers['x-orkumo-renderer'] ?? ''));
  return (
    RENDERER_SECRET.length >= 32 &&
    sent.length === RENDERER_SECRET.length &&
    timingSafeEqual(sent, RENDERER_SECRET)
  );
};
const isOpaqueRequest = (req) => {
  const origin = req.headers.origin;
  if (origin) return remoteAccess.isOpaqueOrigin(origin);
  // A link from another site to the dashboard carries no Origin either; that page cannot read it
  return (
    req.headers['sec-fetch-site'] === 'cross-site' && req.headers['sec-fetch-mode'] !== 'navigate'
  );
};
// A packaged Electron app paired with this server from another machine (DevHub-pro#8) sends the
// renderer's opaque shape too; it passes with the pairing token.
const isPairedElectron = (req) =>
  (!req.headers.origin || remoteAccess.isOpaqueOrigin(req.headers.origin)) &&
  remoteAccess.hasValidToken(req);
const isTrustedOpaque = (req) => hasRendererSecret(req) || isPairedElectron(req);
// First of all: requests relayed by `tailscale serve` carry a path secret (remoteAccess.getServeSecret)
app.use((req, res, next) => {
  remoteAccess.takeServePrefix(req);
  next();
});
// A preflight carries no header values, so the Electron renderer's passes on its origin alone; the
// real request that follows gets the CORS header only with the secret (or token).
app.use(
  cors((req, cb) => {
    const opaque = isOpaqueRequest(req);
    const preflight = req.method === 'OPTIONS';
    let allowed = isAllowedOrigin(req.headers.origin);
    if (opaque && preflight) allowed = process.env.ELECTRON_MODE === 'true';
    else if (opaque) allowed = isTrustedOpaque(req);
    cb(null, { origin: allowed });
  })
);
// After cors so preflights are answered; before every route so no opaque request reaches one.
app.use((req, res, next) =>
  isOpaqueRequest(req) && !isTrustedOpaque(req)
    ? res.status(403).json({ error: 'Cross-origin request refused' })
    : next()
);
// Before every route so nothing is reachable without the token.
app.use(remoteAccess.requireRemoteToken);
app.use(express.json({ limit: '1mb' })); // Limit body size
app.use(limiter);
app.use('/api/terminal/ghostty', ghosttyRoutes);
app.use('/api/files', fileOpenRoutes);
app.use('/api/usage', usageRouter);

// Optional modules (docs/MODULES.md). Mounted now, filled by load() in startServer(),
// so it sits before the 404 handler at the end of this file.
// Function declarations below are hoisted; the getter defers agentLimiter (defined later) until
// modules use it, which is only after load().
const moduleHost = createModuleHost({
  services: {
    agentService,
    boardService,
    db: { getDb, isDatabaseConnected },
    getBoardSettings: () => settingsService.getBoardSettings(),
    findRepoInKnownDirs,
    getAgentContexts,
    // docs/WORKFLOW_PROVIDER.md: modules see the provider only through the contract
    workflow: {
      provider: () => workflowProvider.providerInfo(),
      context: workflowContext,
      start: (url) => workflowProvider.startIssue(url),
      applyGo: (ctx, go) =>
        workflowProvider.applyGo(ctx, go, { updateIssue: boardService.updateIssue }),
    },
    get agentLimiter() {
      return agentLimiter;
    },
    validate,
    z,
    sendError: sendAgentError,
  },
});
app.use('/api/modules', moduleHost.router);

// ============================================
// Input Validation Schemas (Zod)
// ============================================

const pathSchema = z.string().min(1).max(500);
const idSchema = z.string().min(1).max(50);

const directorySchema = z.object({
  path: pathSchema,
});

// IDE ID can be built-in or custom (alphanumeric with dashes)
const ideIdSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9-]+$/);

const addCustomIdeSchema = z.object({
  id: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  path: z.string().min(1).max(500),
});

/**
 * Validate request body with zod schema
 */
function validate(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.issues.map((e) => ({ path: e.path.join('.'), message: e.message })),
        });
      }
      next(error);
    }
  };
}

/**
 * Validate URL params
 */
function validateParams(schema) {
  return (req, res, next) => {
    try {
      for (const value of Object.values(req.params)) {
        schema.parse(value);
      }
      next();
    } catch (error) {
      return res.status(400).json({ error: 'Invalid parameter format' });
    }
  };
}

// SSE heartbeat interval from centralized config
const SSE_HEARTBEAT_INTERVAL = TIMEOUTS.sseHeartbeat;
// ============================================
// Configuration Endpoints
// ============================================

/**
 * GET /api/config
 * Get current configuration
 */
app.get('/api/config', (req, res) => {
  try {
    const config = getConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/config
 * Update configuration
 */
app.put('/api/config', (req, res) => {
  try {
    const updated = updateConfig(req.body);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/config/directories
 * Add a directory to scan
 */
app.post('/api/config/directories', validate(directorySchema), (req, res) => {
  try {
    const { path } = req.body;
    const config = addDirectory(path);
    res.json(config);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * DELETE /api/config/directories
 * Remove a directory from scan list
 */
app.delete('/api/config/directories', validate(directorySchema), (req, res) => {
  try {
    const { path } = req.body;
    const config = removeDirectory(path);
    res.json(config);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// Settings Persistence Endpoints
// ============================================

/**
 * GET /api/settings
 * Get all user settings (favorites, archived, custom ports, names)
 */
app.get('/api/settings', (req, res) => {
  try {
    const settings = settingsService.getSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/settings/import
 * Import settings (for migration from localStorage)
 */
app.post('/api/settings/import', (req, res) => {
  try {
    const { favorites, archived, customPorts, customNames } = req.body;
    const settings = settingsService.importSettings({
      favorites,
      archived,
      customPorts,
      customNames,
    });
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/settings/favorite/:id
 * Toggle or set favorite status for an app
 */
app.put('/api/settings/favorite/:id', validateParams(idSchema), (req, res) => {
  try {
    const { id } = req.params;
    const { value } = req.body;

    let isFavorite;
    if (value === undefined) {
      // Toggle
      isFavorite = settingsService.toggleFavorite(id);
    } else {
      // Set explicitly
      isFavorite = settingsService.setFavorite(id, !!value);
    }

    res.json({ id, isFavorite });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/settings/favorites/order
 * Reorder favorites array
 */
app.put('/api/settings/favorites/order', (req, res) => {
  try {
    const { order } = req.body;

    if (!Array.isArray(order)) {
      return res.status(400).json({ error: 'order must be an array' });
    }

    const newOrder = settingsService.reorderFavorites(order);
    res.json({ favorites: newOrder });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * PUT /api/settings/favorites/sort-mode
 * Set favorites sort mode
 */
app.put('/api/settings/favorites/sort-mode', (req, res) => {
  try {
    const { mode } = req.body;

    if (!mode || !['manual', 'alpha-asc', 'alpha-desc'].includes(mode)) {
      return res
        .status(400)
        .json({ error: 'Invalid sort mode. Must be one of: manual, alpha-asc, alpha-desc' });
    }

    const newMode = settingsService.setFavoritesSortMode(mode);
    res.json({ favoritesSortMode: newMode });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/settings/keyboard-shortcuts
 * Get keyboard shortcuts configuration
 */
app.get('/api/settings/keyboard-shortcuts', (req, res) => {
  try {
    const shortcuts = settingsService.getKeyboardShortcuts();
    res.json({ keyboardShortcuts: shortcuts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/settings/keyboard-shortcuts
 * Update keyboard shortcuts configuration
 */
app.put('/api/settings/keyboard-shortcuts', (req, res) => {
  try {
    const { shortcuts } = req.body;
    if (!shortcuts || typeof shortcuts !== 'object') {
      return res.status(400).json({ error: 'Invalid shortcuts format' });
    }
    const settings = settingsService.updateKeyboardShortcuts(shortcuts);
    res.json({ keyboardShortcuts: settings.keyboardShortcuts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/settings/link-target
 * Where clicked links open (#140): built-in browser or system browser
 */
app.put(
  '/api/settings/link-target',
  validate(z.object({ linkTarget: z.enum(['builtin', 'system']) }).strict()),
  (req, res) => {
    try {
      res.json({ linkTarget: settingsService.setLinkTarget(req.body.linkTarget) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * PUT /api/settings/auto-update
 * Desktop app: check and download updates automatically (electron/updater.js)
 */
app.put(
  '/api/settings/auto-update',
  validate(z.object({ autoUpdate: z.boolean() }).strict()),
  (req, res) => {
    try {
      res.json({ autoUpdate: settingsService.setAutoUpdate(req.body.autoUpdate) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * PUT /api/settings/archive/:id
 * Toggle or set archive status for an app
 */
app.put('/api/settings/archive/:id', validateParams(idSchema), (req, res) => {
  try {
    const { id } = req.params;
    const { value } = req.body;

    let isArchived;
    if (value === undefined) {
      // Toggle
      isArchived = settingsService.toggleArchive(id);
    } else {
      // Set explicitly
      isArchived = settingsService.setArchive(id, !!value);
    }

    res.json({ id, isArchived });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/settings/name/:id
 * Set custom name for an app
 */
app.put('/api/settings/name/:id', validateParams(idSchema), (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (name && typeof name === 'string' && name.trim().length > 0) {
      settingsService.setName(id, name.trim());
      res.json({ id, name: name.trim() });
    } else {
      // Clear custom name
      settingsService.setName(id, null);
      res.json({ id, name: null });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// IDE Integration Endpoints
// ============================================

/**
 * GET /api/ides/installed
 * Detect and return all installed IDEs on the system
 * Query params:
 *   - refresh=true: Force cache invalidation and re-detect IDEs
 */
app.get('/api/ides/installed', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const ides = await ideService.detectInstalledIDEs(forceRefresh);
    res.json({ ides });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ides/custom
 * Get all custom IDEs
 */
app.get('/api/ides/custom', (req, res) => {
  try {
    const customIDEs = ideService.getCustomIDEs();
    res.json({ ides: customIDEs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/ides/custom
 * Add a custom IDE
 */
app.post('/api/ides/custom', validate(addCustomIdeSchema), (req, res) => {
  try {
    const { id, name, path } = req.body;
    const ide = ideService.addCustomIDE(id, name, path);
    res.json({ success: true, ide });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * DELETE /api/ides/custom/:id
 * Remove a custom IDE
 */
app.delete('/api/ides/custom/:id', validateParams(ideIdSchema), (req, res) => {
  try {
    const { id } = req.params;
    const success = ideService.removeCustomIDE(id);
    if (success) {
      res.json({ success: true, message: `Custom IDE '${id}' removed` });
    } else {
      res.status(404).json({ error: 'Custom IDE not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// API Keys Management Endpoints
// ============================================

// ============================================
// DevTools Logger Injection Endpoints
// ============================================

// ============================================
// Scanning Endpoints
// ============================================

/** Projects the app works with: the scan under the user's overrides (disabled, merged, renamed, custom) */
const activeProjects = () =>
  applyProjectOverrides(scanAllDirectories(), settingsService.getSettings());

/**
 * GET /api/apps
 * Active projects: git main checkouts of the scan directories (worktrees folded in) plus custom
 * ones; disabled projects left out, merged ones folded into their target (`paths`, `mergedIds`).
 * `missingWorktrees`: listed worktrees whose folder is gone (git keeps them until pruned)
 */
app.get('/api/apps', (req, res) => {
  try {
    res.json(
      activeProjects().map((p) => ({
        ...p,
        missingWorktrees: (p.worktrees || []).filter((w) => !fs.existsSync(w)),
      }))
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Project configuration (settings: archived, customNames, projectMerges, customProjects) ----

/** Every project with its state for the settings list; sessionCount from the last agent contexts */
const projectList = () => projectCatalog(scanAllDirectories(), settingsService.getSettings());

/**
 * Canonical git roots for a custom project; 400 when one is no git root, 409 when a project
 * already holds it (the message names where to undo that)
 */
function customProjectPaths(paths, exceptId) {
  const catalog = projectList();
  const roots = [];
  for (const input of paths) {
    let dir;
    try {
      dir = validateProjectRoot(input);
    } catch (error) {
      throw Object.assign(error, { status: 400 });
    }
    if (roots.some((r) => r.toLowerCase() === dir.toLowerCase())) continue;
    const holder = catalog.find(
      (p) => p.id !== exceptId && p.paths.some((x) => x.toLowerCase() === dir.toLowerCase())
    );
    if (holder) {
      const target = catalog.find((p) => p.id === holder.mergedInto);
      const hint =
        holder.state === 'disabled'
          ? ' Enable it under "Disabled" instead.'
          : holder.state === 'merged'
            ? ` It is merged into "${target?.name}"; undo that under "Merged" instead.`
            : ' Rename or merge that project instead.';
      throw Object.assign(new Error(`${dir} already is the project "${holder.name}".${hint}`), {
        status: 409,
      });
    }
    roots.push(dir);
  }
  return roots;
}

const sendProjectError = (res, error) =>
  res.status(error.status || 500).json({ error: error.message });

/**
 * GET /api/projects
 * Every detected and custom project with state ('active' | 'disabled' | 'merged'), mergedInto,
 * source ('detected' | 'custom'), worktrees and sessionCount (null before agent contexts exist)
 */
app.get('/api/projects', (req, res) => {
  try {
    const counts = cachedProjectSessionCounts();
    res.json({
      projects: projectList().map((p) => ({
        ...p,
        sessionCount: counts ? counts[p.id] || 0 : null,
      })),
    });
  } catch (error) {
    sendProjectError(res, error);
  }
});

/**
 * PUT /api/settings/project-merge/:id { into: id | null }
 * Fold a project into another active project, or undo it
 */
app.put(
  '/api/settings/project-merge/:id',
  validateParams(idSchema),
  validate(z.object({ into: idSchema.nullable() }).strict()),
  (req, res) => {
    try {
      const { id } = req.params;
      const { into } = req.body;
      const catalog = projectList();
      const source = catalog.find((p) => p.id === id);
      if (!source) return res.status(404).json({ error: 'Unknown project' });
      if (into) {
        const target = catalog.find((p) => p.id === into);
        if (!target || target.id === id || target.state !== 'active') {
          return res.status(400).json({ error: 'Merge into an active project other than itself' });
        }
      }
      res.json({ projectMerges: settingsService.setProjectMerge(id, into) });
    } catch (error) {
      sendProjectError(res, error);
    }
  }
);

const customProjectSchema = z
  .object({
    name: z.string().trim().max(100).optional(),
    paths: z.array(pathSchema).min(1).max(20),
  })
  .strict();

/**
 * POST /api/settings/projects/custom { name?, paths }
 * Add an own project: each path must be a git root no other project holds
 */
app.post('/api/settings/projects/custom', validate(customProjectSchema), (req, res) => {
  try {
    const paths = customProjectPaths(req.body.paths);
    const name = req.body.name || path.basename(paths[0]);
    res.json({ project: settingsService.addCustomProject({ name, paths }) });
  } catch (error) {
    sendProjectError(res, error);
  }
});

/**
 * PUT /api/settings/projects/custom/:id { name?, paths? }
 */
app.put(
  '/api/settings/projects/custom/:id',
  validateParams(idSchema),
  validate(customProjectSchema.partial()),
  (req, res) => {
    try {
      const { id } = req.params;
      const paths = req.body.paths && customProjectPaths(req.body.paths, id);
      const project = settingsService.updateCustomProject(id, { name: req.body.name, paths });
      if (!project) return res.status(404).json({ error: 'Unknown custom project' });
      res.json({ project });
    } catch (error) {
      sendProjectError(res, error);
    }
  }
);

/**
 * DELETE /api/settings/projects/custom/:id
 * Projects merged into it come back as they were
 */
app.delete('/api/settings/projects/custom/:id', validateParams(idSchema), (req, res) => {
  try {
    if (!settingsService.deleteCustomProject(req.params.id)) {
      return res.status(404).json({ error: 'Unknown custom project' });
    }
    res.json({ success: true });
  } catch (error) {
    sendProjectError(res, error);
  }
});

/**
 * Context members that name no project (a worktree or non-git folder the old scan listed, a repo on
 * an unmounted volume) are only logged, once at startup: every reader ignores unknown ids, and the
 * stored member comes back into its context when the repo reappears
 */
function logUnknownContextApps() {
  const settings = settingsService.getSettings();
  const known = new Set(projectCatalog(scanAllDirectories(), settings).map((p) => p.id));
  for (const c of settingsService.getContexts().contexts) {
    const unknown = (c.appIds || []).filter((id) => !known.has(id));
    if (unknown.length)
      console.log(`[Projects] Context "${c.name}": no project for ${unknown.join(', ')} (ignored)`);
  }
}

/**
 * POST /api/scan
 * Scan a specific directory
 */
app.post('/api/scan', (req, res) => {
  try {
    const { path } = req.body;
    if (!path) {
      return res.status(400).json({ error: 'Path is required' });
    }
    const apps = scanDirectory(path);
    res.json(apps);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// Process Management Endpoints
// ============================================

// ============================================
// AI Analysis Endpoint
// ============================================

// ============================================
// Health Check
// ============================================

// Track server start time for uptime calculation
const serverStartTime = Date.now();

/**
 * GET /api/health
 * Health check endpoint with memory and uptime info
 */
app.get('/api/health', (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({
    status: 'ok',
    databaseConnected: isDatabaseConnected(),
    terminalSessions: terminalSessionManager.getStats(),
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - serverStartTime) / 1000),
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      rss: Math.round(memUsage.rss / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024),
    },
    codeServer: {
      running: codeServerProcess !== null,
      port: codeServerPort,
    },
  });
});

/**
 * GET /api/claude-cli/status
 * Check if Claude Code CLI is installed
 */
app.get('/api/claude-cli/status', async (req, res) => {
  try {
    const cliInfo = await detectClaudeCLI();
    res.json(cliInfo);
  } catch (error) {
    res.status(500).json({
      installed: false,
      error: error.message,
    });
  }
});

// ============================================
// Tool Versions (#184)
// ============================================

/**
 * GET /api/system/versions
 * Global tool versions plus the Node version each scanned project pins
 */
app.get('/api/system/versions', async (req, res) => {
  try {
    res.json(await getToolVersions(activeProjects()));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Code-Server (VS Code Web) Endpoints
// ============================================

// Track code-server process
let codeServerProcess = null;
let codeServerPort = 8080;

/**
 * GET /api/code-server/status
 * Check if code-server is available and running
 */
app.get('/api/code-server/status', async (req, res) => {
  try {
    // First check if code-server is installed
    const codeServerPath = await new Promise((resolve) => {
      exec('which code-server', (error, stdout) => {
        if (error) {
          resolve(null);
        } else {
          resolve(stdout.trim());
        }
      });
    });

    if (!codeServerPath) {
      return res.json({
        installed: false,
        running: false,
        url: null,
        message:
          'code-server is not installed. Install it with: brew install code-server (macOS) or npm install -g code-server',
      });
    }

    // Check if code-server is running by trying to connect
    const isRunning = await new Promise((resolve) => {
      const checkUrl = `http://127.0.0.1:${codeServerPort}`;
      http
        .get(checkUrl, (response) => {
          resolve(response.statusCode < 500);
        })
        .on('error', () => {
          resolve(false);
        });
    });

    res.json({
      installed: true,
      path: codeServerPath,
      running: isRunning,
      url: isRunning ? `http://127.0.0.1:${codeServerPort}` : null,
      port: codeServerPort,
      managedByUs: codeServerProcess !== null,
    });
  } catch (error) {
    res.status(500).json({
      installed: false,
      running: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/code-server/start
 * Start code-server if not already running
 */
app.post('/api/code-server/start', async (req, res) => {
  try {
    // Check if already running
    const isRunning = await new Promise((resolve) => {
      http
        .get(`http://127.0.0.1:${codeServerPort}`, (response) => {
          resolve(response.statusCode < 500);
        })
        .on('error', () => {
          resolve(false);
        });
    });

    if (isRunning) {
      return res.json({
        success: true,
        url: `http://127.0.0.1:${codeServerPort}`,
        message: 'code-server is already running',
      });
    }

    // Check if code-server is installed
    const codeServerPath = await new Promise((resolve) => {
      exec('which code-server', (error, stdout) => {
        resolve(error ? null : stdout.trim());
      });
    });

    if (!codeServerPath) {
      return res.status(400).json({
        success: false,
        error: 'code-server is not installed',
      });
    }

    // Start code-server with proper process management
    // Note: We intentionally DO NOT use detached: true or unref() to:
    // 1. Properly track the child process
    // 2. Capture stdout/stderr for debugging
    // 3. Clean up on parent exit
    const { spawn } = await import('child_process');
    codeServerProcess = spawn(
      codeServerPath,
      ['--bind-addr', `127.0.0.1:${codeServerPort}`, '--auth', 'none', '--disable-telemetry'],
      {
        stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout and stderr
      }
    );

    // Log code-server output for debugging
    codeServerProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log('[code-server]', output);
      }
    });

    codeServerProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        // Filter out common non-error messages that code-server outputs to stderr
        if (!output.includes('info') && !output.includes('HTTP')) {
          console.error('[code-server]', output);
        } else {
          console.log('[code-server]', output);
        }
      }
    });

    // Handle code-server exit to detect crashes
    codeServerProcess.on('exit', (code, signal) => {
      console.log(`[code-server] Process exited with code=${code}, signal=${signal}`);
      codeServerProcess = null;
    });

    codeServerProcess.on('error', (err) => {
      console.error('[code-server] Process error:', err.message);
      codeServerProcess = null;
    });

    // Wait for it to be ready
    let attempts = 0;
    const maxAttempts = 30;
    while (attempts < maxAttempts) {
      const ready = await new Promise((resolve) => {
        http
          .get(`http://127.0.0.1:${codeServerPort}`, (response) => {
            resolve(response.statusCode < 500);
          })
          .on('error', () => {
            resolve(false);
          });
      });

      if (ready) {
        return res.json({
          success: true,
          url: `http://127.0.0.1:${codeServerPort}`,
          message: 'code-server started successfully',
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
      attempts++;
    }

    res.status(500).json({
      success: false,
      error: 'code-server failed to start within timeout',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/code-server/stop
 * Stop code-server if we started it
 */
app.post('/api/code-server/stop', (req, res) => {
  try {
    if (codeServerProcess) {
      codeServerProcess.kill();
      codeServerProcess = null;
      res.json({ success: true, message: 'code-server stopped' });
    } else {
      // Try to kill any running code-server
      exec(`lsof -ti:${codeServerPort} | xargs kill -9`, (error) => {
        if (error) {
          res.json({ success: true, message: 'No code-server process to stop' });
        } else {
          res.json({ success: true, message: 'code-server stopped' });
        }
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================
// Docker Compose Endpoints
// ============================================

// ============================================
// Database Application Endpoints
// ============================================

// ============================================
// Terminal Session Endpoints
// ============================================

/**
 * GET /api/terminal/sessions
 * Get all active terminal sessions
 */
app.get('/api/terminal/sessions', (req, res) => {
  try {
    const sessions = terminalSessionManager.getActiveSessions();
    res.json(
      sessions.map((s) => ({
        id: s.id,
        appId: s.appId,
        cwd: s.cwd,
        createdAt: s.createdAt,
        lastActivity: s.lastActivity,
        bufferSize: s.outputBuffer?.length || 0,
      }))
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/terminal/sessions/recent
 * Get recent terminal sessions (for recovery UI)
 */
app.get('/api/terminal/sessions/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const sessions = await terminalSessionManager.getRecentSessions(limit);
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/terminal/sessions/:id/buffer
 * Get output buffer for a session
 */
app.get('/api/terminal/sessions/:id/buffer', (req, res) => {
  try {
    const { id } = req.params;
    const lastN = parseInt(req.query.lines) || 100;
    const buffer = terminalSessionManager.getOutputBuffer(id, lastN);
    res.json({ lines: buffer });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/terminal/sessions/:id
 * Close a terminal session
 */
app.delete('/api/terminal/sessions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const success = await terminalSessionManager.closeSession(id);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/terminal/stats
 * Get terminal session statistics
 */
app.get('/api/terminal/stats', (req, res) => {
  try {
    const stats = terminalSessionManager.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Port Management Endpoints
// ============================================

// ============================================
// Finder/Terminal Integration Endpoints
// ============================================

// ============================================
// Preview Proxy Endpoint (for Browser DevTools)
// ============================================

/**
 * Proxy handler for preview requests
 */
function handlePreviewProxy(req, res, port, pathSuffix) {
  const targetPath = '/' + (pathSuffix || '');
  const queryString = req.url.includes('?') ? req.url.split('?')[1] : '';
  const fullPath = queryString ? `${targetPath}?${queryString}` : targetPath;

  if (isNaN(port) || port < 1 || port > 65535) {
    return res.status(400).json({ error: 'Invalid port number' });
  }

  const options = {
    hostname: 'localhost',
    port: port,
    path: fullPath,
    method: 'GET',
    headers: {
      ...req.headers,
      host: `localhost:${port}`,
    },
    timeout: 10000,
  };

  // Remove headers that could cause issues
  delete options.headers['accept-encoding']; // We need uncompressed HTML to inject script

  const proxyReq = http.request(options, (proxyRes) => {
    const contentType = proxyRes.headers['content-type'] || '';
    const isHtml = contentType.includes('text/html');

    // Forward status and most headers
    res.status(proxyRes.statusCode);
    Object.entries(proxyRes.headers).forEach(([key, value]) => {
      // Skip certain headers
      if (
        !['transfer-encoding', 'content-length', 'content-encoding'].includes(key.toLowerCase())
      ) {
        res.setHeader(key, value);
      }
    });

    if (isHtml) {
      // Collect HTML to inject logger script
      let body = '';
      proxyRes.on('data', (chunk) => {
        body += chunk.toString();
      });
      proxyRes.on('end', () => {
        // Inject logger script into <head>
        const loggerScript = `<script src="/iframe-logger.js"></script>`;
        const injectedBody = body.replace(/<head([^>]*)>/i, `<head$1>${loggerScript}`);
        res.setHeader('content-length', Buffer.byteLength(injectedBody));
        res.send(injectedBody);
      });
    } else {
      // Pass through non-HTML content
      proxyRes.pipe(res);
    }
  });

  proxyReq.on('error', (err) => {
    console.error(`[Preview Proxy] Error proxying to port ${port}:`, err.message);
    res.status(502).json({
      error: 'Failed to connect to preview server',
      message: `Could not reach localhost:${port}`,
    });
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.status(504).json({ error: 'Preview server timeout' });
  });

  proxyReq.end();
}

/**
 * GET /api/preview/:port{/*path} - Proxy requests to local dev servers
 * Express 5 uses {*param} for wildcard/splat routes
 */
app.get('/api/preview/:port{/*path}', (req, res) => {
  const port = parseInt(req.params.port, 10);
  // path param captures everything after the port (or undefined for root)
  const pathSuffix = req.params.path || '';
  handlePreviewProxy(req, res, port, pathSuffix);
});

// ============================================
// Claude Code Agent View API (browser counterpart of `claude agents`)
// ============================================

const agentIdSchema = z.string().regex(agentService.SHORT_ID_RE);
const agentDispatchSchema = z.object({
  prompt: z.string().max(20000).optional(),
  exec: z.string().max(4000).optional(),
  resume: z.string().max(120).optional(),
  cwd: pathSchema,
  name: optionalShortString,
  agent: optionalShortString,
  model: optionalShortString,
  fallbackModel: optionalShortString,
  effort: optionalShortString,
  permissionMode: z
    .string()
    .regex(/^[a-zA-Z]+$/)
    .max(40)
    .optional()
    .nullable(),
  skipPermissions: z.boolean().optional(),
  allowSkipPermissions: z.boolean().optional(),
  restricted: z.boolean().optional(),
  settings: z.string().max(10000).optional().nullable(),
  addDirs: z.array(z.string().max(500)).max(20).optional(),
  pluginDirs: z.array(z.string().max(500)).max(20).optional(),
  mcpConfigs: z.array(z.string().max(10000)).max(20).optional(),
  strictMcpConfig: z.boolean().optional(),
  idle: z.boolean().optional(),
});
const agentReplySchema = z.object({
  text: z.string().min(1).max(20000),
  mode: z.enum(['auto', 'attach', 'resume']).optional(),
});
const agentRemoveSchema = z.object({
  discardUnpushed: z.string().max(200).optional().nullable(),
  forceRemoveWorktree: z.string().max(200).optional().nullable(),
});

const agentLimiter = rateLimit({
  windowMs: RATE_LIMIT.windowMs,
  max: 60,
  message: { error: 'Too many agent operations, please slow down' },
});

function sendAgentError(res, error) {
  const status = error?.status || 500;
  res.status(status).json({ ...error?.details, error: error?.message || 'Agent operation failed' });
}

/**
 * Scope directory for listing/discovery. An explicit ?cwd= must lie inside the configured
 * project directories (throws a 403 otherwise); the stored scope is validated on save.
 */
function agentScopeCwd(req) {
  const query =
    typeof req.query.cwd === 'string' && req.query.cwd.trim() ? req.query.cwd.trim() : null;
  if (query) {
    return agentService.assertAllowedPath(query, agentService.getAllowedDirectories(), 'cwd');
  }
  const scope = settingsService.getAgentViewSettings().scopeCwd;
  return scope || undefined;
}

function agentCapabilities() {
  return {
    unsafeFlagsAllowed: agentService.isUnsafeFlagsAllowed(),
    allowedDirs: agentService.getAllowedDirectories(),
  };
}

/**
 * GET /api/agents - sessions (background + interactive) enriched with state.json data
 */
app.get('/api/agents', async (req, res) => {
  try {
    const cwd = agentScopeCwd(req);
    const all = req.query.all !== 'false';
    const cliPath = agentService.resolveClaudeBinary();
    if (!cliPath) {
      return res.json({
        sessions: [],
        daemon: null,
        userSettings: null,
        cli: { installed: false, path: null },
        capabilities: agentCapabilities(),
      });
    }
    const [sessions, daemon, userSettings] = await Promise.all([
      // unscoped: the watcher's list while a client is subscribed, no extra `claude agents`
      cwd || !all ? agentService.listSessions({ cwd, all }) : agentService.currentSessions(),
      agentService.daemonStatus().catch(() => null),
      agentService.readClaudeUserSettings(),
    ]);
    res.json({
      sessions,
      daemon,
      userSettings,
      cli: { installed: true, path: cliPath },
      capabilities: agentCapabilities(),
    });
  } catch (error) {
    sendAgentError(res, error);
  }
});

/**
 * GET /api/agents/json - raw `claude agents --json` output
 */
app.get('/api/agents/json', async (req, res) => {
  try {
    const cwd = agentScopeCwd(req);
    const raw = await agentService.rawSessionsJson({ cwd, all: req.query.all === 'true' });
    res.type('application/json').send(raw);
  } catch (error) {
    sendAgentError(res, error);
  }
});

/**
 * GET /api/agents/stream - SSE with session snapshots and notifications
 */
app.get('/api/agents/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.write(
    `event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`
  );

  const send = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // client gone
    }
  };
  const onSessions = (sessions) => send('sessions', sessions);
  const onNotify = (notification) => send('notify', notification);
  const onError = (error) => send('agent-error', error);
  agentService.agentEvents.on('sessions', onSessions);
  agentService.agentEvents.on('notify', onNotify);
  agentService.agentEvents.on('error', onError);
  const unsubscribe = agentService.subscribe();
  const heartbeat = setInterval(
    () => send('heartbeat', { timestamp: new Date().toISOString() }),
    SSE_HEARTBEAT_INTERVAL
  );

  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe();
    agentService.agentEvents.off('sessions', onSessions);
    agentService.agentEvents.off('notify', onNotify);
    agentService.agentEvents.off('error', onError);
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
});

/**
 * POST /api/agents/dispatch - start a background session (`claude --bg`)
 */
app.post('/api/agents/dispatch', agentLimiter, validate(agentDispatchSchema), async (req, res) => {
  try {
    const result = await agentService.dispatch(req.body);
    res.status(201).json(result);
  } catch (error) {
    sendAgentError(res, error);
  }
});

// Raw image bytes (not JSON: base64 would hit the 1 MB JSON limit); type is sniffed server-side
const imageBody = express.raw({ type: 'image/*', limit: imageUpload.MAX_IMAGE_BYTES });

/**
 * POST /api/agents/images - store an image for a task/agent prompt, returns its local path
 */
app.post('/api/agents/images', agentLimiter, imageBody, async (req, res) => {
  try {
    res.status(201).json({ path: await imageUpload.saveAgentImage(req.body) });
  } catch (error) {
    sendAgentError(res, error);
  }
});

/** GET /api/agents/images/:name - preview of an image stored for a prompt (server-chosen names only) */
app.get('/api/agents/images/:name', (req, res) => {
  const file = imageUpload.agentImagePath(req.params.name);
  if (!file) return res.status(400).json({ error: 'Invalid image name' });
  res.sendFile(file, { headers: { 'Cache-Control': 'private, max-age=86400' } }, (error) => {
    if (error && !res.headersSent) res.status(404).json({ error: 'Image not found' });
  });
});

// ---------------------------------------------------------------------------
// Chat views (#189): UI view of an agent pane, a tail of its transcript (chatService.js)
// ---------------------------------------------------------------------------
const chatIdSchema = z.string().uuid();

/** UI view of an agent session; never starts or stops the agent (it runs in its terminal pane) */
app.post(
  '/api/agents/chat/view',
  agentLimiter,
  validate(
    z.object({
      harness: z.enum(chatService.VIEW_HARNESSES),
      sessionId: z.string().max(80),
      cwd: pathSchema,
      name: z.string().max(80).optional().nullable(),
    })
  ),
  (req, res) => {
    try {
      res.status(201).json(chatService.viewSession(req.body));
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

/** SSE: replays the session's events, then streams live ones */
app.get('/api/agents/chat/:chatId/stream', validateParams(chatIdSchema), (req, res) => {
  let unsubscribe;
  try {
    chatService.chatSummary(req.params.chatId);
  } catch (error) {
    return sendAgentError(res, error);
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = (data) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      // client gone
    }
  };
  unsubscribe = chatService.watchChat(req.params.chatId, send);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), SSE_HEARTBEAT_INTERVAL);
  const cleanup = () => {
    clearInterval(heartbeat);
    unsubscribe?.();
    unsubscribe = null;
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
});

/** Status line of a chat: git (branch, untracked, changed), prompt cache, context fill, plan limits */
app.get('/api/agents/chat/:chatId/status', validateParams(chatIdSchema), async (req, res) => {
  try {
    const { chatId } = req.params;
    res.json(await chatStatus.chatStatus(chatService.chatSummary(chatId)));
  } catch (error) {
    sendAgentError(res, error);
  }
});

/** `@` completion: files of the chat's repo (git ls-files) matching ?q= */
app.get('/api/agents/chat/:chatId/files', validateParams(chatIdSchema), async (req, res) => {
  try {
    const { cwd } = chatService.chatSummary(req.params.chatId);
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
    res.json({ files: await chatStatus.chatFiles(cwd, q) });
  } catch (error) {
    sendAgentError(res, error);
  }
});

/** Output tail of a background shell the chat's own CLI reported */
app.get(
  '/api/agents/chat/:chatId/shells/:shellId',
  // Each param must be a chat uuid or a shell id; shellOutputFile checks the shell id again
  validateParams(z.union([chatIdSchema, z.string().regex(/^\w{1,40}$/)])),
  async (req, res) => {
    try {
      const file = chatService.shellOutputFile(req.params.chatId, req.params.shellId);
      const tail = file && (await chatStatus.shellTail(file));
      if (!tail) return res.status(404).json({ error: 'Shell output not found' });
      res.json(tail);
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

/** Artifacts of a chat: files its tools created / edited and omp's `local://` documents */
app.get('/api/agents/chat/:chatId/artifacts', validateParams(chatIdSchema), (req, res) => {
  try {
    res.json({ artifacts: chatService.chatArtifacts(req.params.chatId) });
  } catch (error) {
    sendAgentError(res, error);
  }
});

/** Text of one listed artifact (?path=), project dirs or the session's documents, <= 1 MB */
app.get('/api/agents/chat/:chatId/artifacts/content', validateParams(chatIdSchema), (req, res) => {
  try {
    const file = typeof req.query.path === 'string' ? req.query.path : '';
    res.json(chatService.chatArtifactContent(req.params.chatId, file));
  } catch (error) {
    sendAgentError(res, error);
  }
});

/**
 * POST /api/agents/cloud-session - validated CLI args for a cloud/remote session PTY
 * (`claude --cloud <id|url>` or `claude --teleport`). The client opens the PTY via /api/pty.
 */
app.post(
  '/api/agents/cloud-session',
  agentLimiter,
  validate(z.object({ target: z.string().max(500).optional().nullable() })),
  (req, res) => {
    try {
      res.json({ args: agentService.buildCloudArgs(req.body.target) });
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

// Pairing data for the iOS app; only shown on this machine, never to a remote client.
app.get('/api/remote/pairing', async (req, res) => {
  if (!remoteAccess.isLocalRequest(req)) return res.status(403).json({ error: 'Local only' });
  if (!remoteAccess.isRemoteEnabled()) return res.json({ enabled: false });
  const dnsName = await getSelfDnsName();
  const url = process.env.DEVORBIT_REMOTE_URL || (dnsName ? `https://${dnsName}` : null);
  res.json({
    enabled: true,
    url,
    token: remoteAccess.getToken(),
    link: url ? remoteAccess.pairingLink(url) : null,
  });
});

app.post('/api/agents/respawn-all', agentLimiter, async (req, res) => {
  try {
    res.json(await agentService.respawnSession('--all'));
  } catch (error) {
    sendAgentError(res, error);
  }
});

app.put(
  '/api/agents/order',
  validate(z.object({ ids: z.array(agentIdSchema).max(500) })),
  async (req, res) => {
    try {
      res.json(await agentService.reorderSessions(req.body.ids));
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

/** Agent harnesses (#195) and whether their binary is installed; null = unknown (Docker, host-side) */
app.get('/api/agents/harnesses', (req, res) => {
  res.json(
    HARNESS_COMMANDS.map((id) => ({
      id,
      installed: isRunningInDocker ? null : Boolean(resolveHarnessBinary(id)),
    }))
  );
});

app.get('/api/agents/daemon', async (req, res) => {
  try {
    res.json(await agentService.daemonStatus());
  } catch (error) {
    sendAgentError(res, error);
  }
});

app.post(
  '/api/agents/daemon/stop',
  agentLimiter,
  validate(z.object({ any: z.boolean().optional(), keepWorkers: z.boolean().optional() })),
  async (req, res) => {
    try {
      res.json(await agentService.daemonStop(req.body));
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

// ?fresh=1 (the client asks after a session changed): wait for a recompute instead of the stale value
app.get('/api/agents/context', agentLimiter, async (req, res) => {
  try {
    res.json({ contexts: await getAgentContexts({ fresh: req.query.fresh === '1' }) });
  } catch (error) {
    sendAgentError(res, error);
  }
});

// Polled every 5s by the open servers panel; ?pids=1,2,3 (max 50), vanished pids are omitted.
app.get('/api/agents/servers/stats', agentLimiter, async (req, res) => {
  const pids = parsePids(req.query.pids);
  if (!pids) return res.status(400).json({ error: 'pids must be 1-50 positive integers' });
  try {
    // Only servers the dashboard lists: no probing of arbitrary pids
    const known = await getKnownServerPids();
    res.json({ stats: await getServerProcessStats(pids.filter((pid) => known.has(pid))) });
  } catch (error) {
    sendAgentError(res, error);
  }
});

// Listening servers left behind by finished worktree or job sessions (#243).
app.get('/api/agents/servers/orphans', agentLimiter, async (req, res) => {
  try {
    res.json({ servers: await getOrphanServers() });
  } catch (error) {
    sendAgentError(res, error);
  }
});

// A bodyless POST needs no CORS preflight: routes that end processes refuse cross-site pages.
// Browsers send Origin on a cross-origin POST; opaque ones (file://, sandboxed frames) only get
// this far as the Electron renderer or a paired app (the gate after cors).
const sameSiteOnly = (req, res, next) => {
  const origin = req.get('origin');
  if (origin && !isOpaqueRequest(req) && !isAllowedOrigin(origin))
    return res.status(403).json({ error: 'Cross-origin request refused' });
  next();
};

// Only pids currently listed as orphans may be stopped: no killing of arbitrary processes.
app.post('/api/agents/servers/:pid/stop', agentLimiter, sameSiteOnly, async (req, res) => {
  const pid = Number(req.params.pid);
  if (!/^\d{1,9}$/.test(req.params.pid) || pid <= 1) {
    return res.status(400).json({ error: 'pid must be a positive integer' });
  }
  try {
    if (!(await stopOrphanServer(pid))) {
      return res.status(404).json({ error: 'No orphan server with this pid' });
    }
    res.json({ stopped: pid });
  } catch (error) {
    sendAgentError(res, error);
  }
});

app.get('/api/agents/subagents', async (req, res) => {
  try {
    res.json({ agents: await agentService.listSubagents(agentScopeCwd(req) || process.env.HOME) });
  } catch (error) {
    sendAgentError(res, error);
  }
});

app.get('/api/agents/commands', async (req, res) => {
  try {
    res.json({
      commands: await agentService.listSlashCommands(agentScopeCwd(req) || process.env.HOME),
    });
  } catch (error) {
    sendAgentError(res, error);
  }
});

app.get('/api/agents/repos', async (req, res) => {
  try {
    const cwd = agentScopeCwd(req) || process.env.HOME;
    const sessions = await agentService.listSessions({ all: true }).catch(() => []);
    const repos = await agentService.listRepos(cwd, sessions);
    // Configured scan directories and discovered apps are valid dispatch targets too
    const config = getConfig();
    for (const dir of config.directories || []) {
      if (fs.existsSync(dir) && !repos.some((r) => r.path === dir)) {
        repos.push({ name: path.basename(dir), path: dir, source: 'configured' });
      }
    }
    res.json({ cwd, repos, home: os.homedir() });
  } catch (error) {
    sendAgentError(res, error);
  }
});

app.get('/api/agents/past', async (req, res) => {
  try {
    const cwd = typeof req.query.cwd === 'string' && req.query.cwd ? req.query.cwd : undefined;
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    res.json({ sessions: await agentService.listPastSessions({ cwd, query, limit: 100 }) });
  } catch (error) {
    sendAgentError(res, error);
  }
});

app.get('/api/agents/:id/logs', validateParams(agentIdSchema), async (req, res) => {
  try {
    const lines = Math.min(200, Math.max(5, parseInt(String(req.query.lines || '40'), 10) || 40));
    res.json(await agentService.getLogs(req.params.id, { lines }));
  } catch (error) {
    sendAgentError(res, error);
  }
});

app.post(
  '/api/agents/:id/reply',
  agentLimiter,
  validateParams(agentIdSchema),
  validate(agentReplySchema),
  async (req, res) => {
    try {
      res.json(
        await agentService.replySession(req.params.id, req.body.text, {
          mode: req.body.mode || 'auto',
        })
      );
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

// Also ends the omp process running an Oh My Pi session, e.g. in another terminal (#195)
app.post(
  '/api/agents/:id/stop',
  agentLimiter,
  sameSiteOnly,
  validateParams(agentIdSchema),
  async (req, res) => {
    try {
      res.json(await agentService.stopSession(req.params.id));
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

/** Ends the agent a pane runs, also while the pane is closed (closing only detaches it) */
app.post(
  '/api/agents/panes/:paneId/stop',
  agentLimiter,
  sameSiteOnly,
  validateParams(z.string().regex(/^[\w.:-]{1,200}$/)),
  (req, res) => {
    res.json({ stopped: killPanePtys(req.params.paneId) });
  }
);

// Text typed into an agent: no control characters besides tab / newline: an ESC would end the
// bracketed paste and send raw keys (Claude Code's `!` bash mode, Shift+Tab permission mode)
const typedTextSchema = (max) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .refine((t) => !/[\x00-\x08\x0b-\x1f\x7f]/.test(t), 'Text must not contain control characters');
// A start prompt is a CLI argument as well: no leading `-` (defense in depth next to `--`)
const startPromptSchema = (max) =>
  typedTextSchema(max).refine((t) => !t.startsWith('-'), 'Prompt must not start with "-"');

// Quick window (#251): the default harness as an agent pane of its own, shown through its transcript
app.post(
  '/api/agents/quick',
  agentLimiter,
  sameSiteOnly,
  validate(z.object({ prompt: startPromptSchema(MAX_HARNESS_PROMPT) })),
  async (req, res) => {
    if (isRunningInDocker) return res.status(501).json({ error: 'Not available in Docker' });
    const { harness, model, permissionMode } = settingsService.getAgentViewSettings().dispatch;
    try {
      res.status(201).json(
        await startQuickAgent(
          { prompt: req.body.prompt, harness, cwd: os.homedir(), model, permissionMode },
          {
            openAgentPty,
            killPanePtys,
            resolveBinary: resolveHarnessBinary,
            ompArgs: (bin) => ompSkillsArgs(bin, os.homedir()),
            findOmpSession: async (paneId) => {
              const rows = await listOmpSessions({ panes: agentService.agentPanes() });
              return rows.find((r) => r.paneId === paneId)?.sessionId ?? null;
            },
          }
        )
      );
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  }
);

/** Types a message into an agent pane's terminal and submits it (quick window follow-ups) */
app.post(
  '/api/agents/panes/:paneId/message',
  agentLimiter,
  sameSiteOnly,
  validateParams(z.string().regex(/^[\w.:-]{1,200}$/)),
  validate(z.object({ text: typedTextSchema(100000) })),
  (req, res) => {
    if (!typeIntoPanePty(req.params.paneId, req.body.text))
      return res.status(404).json({ error: 'No agent runs in this pane' });
    res.json({ delivered: true });
  }
);

// ---------------------------------------------------------------------------
// Orchestrators: sessions that hand out and watch work through the `orkumo` CLI
// (server/services/orchestratorService.js; workspace <data>/orchestrator, set up at start)
// ---------------------------------------------------------------------------
const ensureOrchestratorWorkspace = () =>
  orchestrator.ensureOrchestratorWorkspace({ apiUrl: `http://127.0.0.1:${PORT}/api` });
const orchestratorTranscriptDeps = {
  getTranscriptTail: agentService.getTranscriptTail,
  readTranscriptTail: agentService.readTranscriptTail,
  projectSlug: agentService.projectSlug,
  projectsDir: agentService.paths.PROJECTS_DIR,
};
const orchestratorPaneDeps = (cwd) => ({
  workspace: orchestrator.orchestratorDir(),
  openAgentPty,
  killPanePtys,
  resolveBinary: resolveHarnessBinary,
  ompArgs: (bin) => ompSkillsArgs(bin, cwd),
  findOmpSession: async (paneId) => {
    const rows = await listOmpSessions({ panes: agentService.agentPanes() });
    return rows.find((r) => r.paneId === paneId)?.sessionId ?? null;
  },
});
const orchestratorRefSchema = z.string().regex(/^[\w.:-]{1,200}$/);
// A prompt is the CLI's last positional argument: a leading "-" would be read as a flag
const panePromptSchema = z
  .string()
  .trim()
  .min(4)
  .max(20000)
  .refine((p) => !p.startsWith('-'), 'Prompt must not start with "-"');

/** Agents as orchestrators see them; ?all=1 also finished ones and terminals outside Orkumo, ?text=0 skips last answers */
app.get('/api/orchestrator/overview', async (req, res) => {
  try {
    const [sessions, contexts] = await Promise.all([
      agentService.currentSessions(),
      getAgentContexts().catch(() => ({})),
    ]);
    res.json(
      await orchestrator.buildOverview({
        sessions,
        contexts,
        orchestrators: settingsService.getAgentViewSettings().orchestrators,
        all: req.query.all === '1',
        withText: req.query.text !== '0',
        readTranscript: (session, last) =>
          orchestrator.readSessionTranscript(session, last, orchestratorTranscriptDeps),
      })
    );
  } catch (error) {
    sendAgentError(res, error);
  }
});

/** Last ?last=N (1-100) transcript turns of an agent (row id, transcript uuid or pane id) */
app.get(
  '/api/orchestrator/agents/:id/transcript',
  validateParams(orchestratorRefSchema),
  async (req, res) => {
    try {
      const last = Math.min(100, Math.max(1, parseInt(String(req.query.last || '10'), 10) || 10));
      const session = orchestrator.findSessionByRef(
        await agentService.currentSessions(),
        req.params.id
      );
      if (!session) return res.status(404).json({ error: 'No agent with this id' });
      res.json({
        agent: { id: session.id, name: session.name || null },
        entries: await orchestrator.readSessionTranscript(
          session,
          last,
          orchestratorTranscriptDeps
        ),
      });
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

app.get('/api/orchestrator/projects', async (req, res) => {
  try {
    const sessions = await agentService.currentSessions().catch(() => []);
    res.json({
      projects: orchestrator.projectList(scanAllDirectories(), sessions),
      defaultHarness: settingsService.getAgentViewSettings().dispatch.harness,
    });
  } catch (error) {
    sendAgentError(res, error);
  }
});

/** Workspace, CLI path and the briefing typed into a session that was just marked */
app.get('/api/orchestrator/workspace', (req, res) => {
  const dir = orchestrator.orchestratorDir();
  res.json({
    dir,
    cli: orchestrator.orchestratorCli(dir),
    briefing: orchestrator.orchestratorBriefing(dir),
  });
});

/** `orkumo start --harness omp`: an agent pane in a project, listed in the rail like any pane */
app.post(
  '/api/orchestrator/panes',
  agentLimiter,
  sameSiteOnly,
  validate(
    z.object({
      harness: z.enum(orchestrator.PANE_HARNESSES),
      cwd: pathSchema,
      prompt: panePromptSchema,
    })
  ),
  async (req, res) => {
    if (isRunningInDocker) return res.status(501).json({ error: 'Not available in Docker' });
    try {
      const cwd = agentService.assertAllowedPath(
        req.body.cwd,
        agentService.getAllowedDirectories(),
        'Working directory'
      );
      const { model, permissionMode } = settingsService.getAgentViewSettings().dispatch;
      res
        .status(201)
        .json(
          await orchestrator.startAgentPane(
            { harness: req.body.harness, cwd, prompt: req.body.prompt, model, permissionMode },
            orchestratorPaneDeps(cwd)
          )
        );
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  }
);

/** "New orchestrator": the default harness (Claude Code when it has no pane) in the workspace */
app.post('/api/orchestrator/start', agentLimiter, sameSiteOnly, async (req, res) => {
  if (isRunningInDocker) return res.status(501).json({ error: 'Not available in Docker' });
  const { harness, model, permissionMode } = settingsService.getAgentViewSettings().dispatch;
  try {
    const { dir } = ensureOrchestratorWorkspace();
    res.status(201).json(
      await orchestrator.startAgentPane(
        {
          harness: orchestrator.PANE_HARNESSES.includes(harness) ? harness : 'claude',
          cwd: dir,
          prompt: orchestrator.ORCHESTRATOR_START_PROMPT,
          model,
          permissionMode,
          orchestrator: true,
        },
        orchestratorPaneDeps(dir)
      )
    );
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post(
  '/api/agents/:id/respawn',
  agentLimiter,
  validateParams(agentIdSchema),
  async (req, res) => {
    try {
      res.json(await agentService.respawnSession(req.params.id));
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

app.delete(
  '/api/agents/:id',
  agentLimiter,
  validateParams(agentIdSchema),
  validate(agentRemoveSchema),
  async (req, res) => {
    try {
      const result = await agentService.removeSession(req.params.id, req.body);
      res.status(result.removed ? 200 : 409).json(result);
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

app.put(
  '/api/agents/:id/name',
  validateParams(agentIdSchema),
  validate(z.object({ name: z.string().min(1).max(200) })),
  async (req, res) => {
    try {
      res.json(await agentService.renameSession(req.params.id, req.body.name));
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

app.put(
  '/api/agents/:id/pin',
  validateParams(agentIdSchema),
  validate(z.object({ pinned: z.boolean() })),
  async (req, res) => {
    try {
      res.json(await agentService.setPinned(req.params.id, req.body.pinned));
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

// ============================================
// Agent Task Board API (GitHub ProjectV2 via gh)
// ============================================

const boardItemIdSchema = z.string().regex(/^PVTI_[A-Za-z0-9_-]+$/);
const boardSliceKeys = z.array(z.string().max(200)).max(500);
const boardSettingsSchema = z
  .object({
    source: z
      .object({
        owner: z.string().regex(/^[A-Za-z0-9-]{1,39}$/),
        number: z.number().int().positive(),
      })
      .strict()
      .optional(),
    favorites: boardSliceKeys.optional(),
    order: boardSliceKeys.optional(),
    hidden: boardSliceKeys.optional(),
  })
  .strict();

app.get('/api/board/items', agentLimiter, async (req, res) => {
  try {
    const { source } = settingsService.getBoardSettings();
    res.json(await boardService.getBoard(source, { refresh: req.query.refresh === '1' }));
  } catch (error) {
    sendAgentError(res, error);
  }
});

app.patch(
  '/api/board/items/:itemId/status',
  agentLimiter,
  validateParams(boardItemIdSchema),
  validate(z.object({ optionId: z.string().min(1).max(100) })),
  async (req, res) => {
    try {
      const { source } = settingsService.getBoardSettings();
      res.json(await boardService.setItemStatus(source, req.params.itemId, req.body.optionId));
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

// Directories Orkumo knows about: configured scan roots and projects (with their subfolders),
// plus repos, worktrees and agent cwds found elsewhere (only the folder itself)
async function knownDirs() {
  const sessions = await agentService.listSessions({ all: true }).catch(() => []);
  const repos = await agentService.listRepos(process.env.HOME, sessions).catch(() => []);
  return {
    roots: [...scanAllDirectories().map((a) => a.path), ...(getConfig().directories || [])],
    exact: [...repos.map((r) => r.path), ...sessions.map((s) => s.cwd)],
  };
}

// Code mode: the Web-IDE opens a folder only when Orkumo knows it
app.get('/api/code/folder', agentLimiter, async (req, res) => {
  try {
    const { roots, exact } = await knownDirs();
    // Agents jump to their worktree root, which is not their cwd when they run in a subfolder
    const contexts = await getAgentContexts().catch(() => ({}));
    const worktrees = Object.values(contexts).map((c) => c?.repo?.worktreePath);
    const folder = await codeService.resolveAllowedFolder(req.query.path, roots, [
      ...exact,
      ...worktrees,
    ]);
    if (!folder) return res.status(403).json({ error: 'Folder is not a known project directory' });
    res.json({ path: folder });
  } catch (error) {
    sendAgentError(res, error);
  }
});

// Local checkout of an issue's repo, preset as target directory for "Agent starten"
const boardRepoSlugSchema = z.string().regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/);

app.get('/api/board/repo-path', agentLimiter, async (req, res) => {
  const slug = boardRepoSlugSchema.safeParse(req.query.repo);
  if (!slug.success) return res.status(400).json({ error: 'Invalid repo' });
  try {
    const { roots, exact } = await knownDirs();
    res.json({ path: await boardService.findRepoPath(slug.data, [...roots, ...exact]) });
  } catch (error) {
    sendAgentError(res, error);
  }
});

// Issues mode: issues of the context's repos, also those that are not on the board
const issueListQuerySchema = z.object({
  context: z.string().min(1).max(100).optional(),
  state: z.enum(['open', 'closed']).default('open'),
  refresh: z.literal('1').optional(),
});

app.get('/api/issues', agentLimiter, async (req, res) => {
  const query = issueListQuerySchema.safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: 'Invalid issue list query' });
  try {
    const { contexts, activeContextId } = settingsService.getContexts();
    const context = contexts.find((c) => c.id === (query.data.context ?? activeContextId));
    if (!context) return res.status(404).json({ error: 'Unknown context' });
    const repos = await issueListService.contextRepos(context, scanAllDirectories());
    const { source } = settingsService.getBoardSettings();
    res.json(
      await issueListService.listIssues(repos, {
        state: query.data.state,
        source,
        refresh: query.data.refresh === '1',
      })
    );
  } catch (error) {
    sendAgentError(res, error);
  }
});

// ---------------------------------------------------------------------------
// Workflow provider (docs/WORKFLOW_PROVIDER.md); no provider: plain board
// ---------------------------------------------------------------------------

async function findRepoInKnownDirs(slug) {
  // Configured directories first: listing agent sessions in knownDirs() takes seconds
  const configured = [
    ...scanAllDirectories().map((a) => a.path),
    ...(getConfig().directories || []),
  ];
  const fast = await boardService.findRepoPath(slug, configured);
  if (fast) return fast;
  const { roots, exact } = await knownDirs();
  return boardService.findRepoPath(slug, [...roots, ...exact]);
}

/** Board item with its `workflow` (null without provider or outside the workflow) */
async function workflowContext(itemId, { refresh = false } = {}) {
  const { source } = settingsService.getBoardSettings();
  const board = await boardService.getBoard(source);
  const cached = board.items.find((i) => i.itemId === itemId);
  // GO decides on the item as GitHub has it now; reloading only it keeps the click fast
  const item = cached && refresh ? await boardService.refetchItem(source, itemId) : cached;
  if (!item?.repo || !item.number) {
    throw Object.assign(new Error('Issue not on the board'), { status: 404 });
  }
  return { source, item, state: item.workflow?.state ?? null };
}

app.get('/api/workflow', (_req, res) => {
  res.json({ provider: workflowProvider.providerInfo() });
});

// Start the issue now through the provider; the client sends only an issue URL (trust boundary)
app.post(
  '/api/workflow/start',
  agentLimiter,
  validate(z.object({ url: z.string().regex(ISSUE_URL_RE) }).strict()),
  async (req, res) => {
    try {
      res.json(await workflowProvider.startIssue(req.body.url));
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

// Apply a GO; refused unless the fresh state offers exactly this kind
app.post(
  '/api/workflow/go',
  agentLimiter,
  validate(
    z
      .object({
        itemId: boardItemIdSchema,
        go: z.object({ kind: z.string().regex(/^[a-z0-9_-]{1,40}$/) }).strict(),
      })
      .strict()
  ),
  async (req, res) => {
    try {
      const ctx = await workflowContext(req.body.itemId, { refresh: true });
      const { status, body } = await workflowProvider.applyGo(ctx, req.body.go, {
        updateIssue: boardService.updateIssue,
      });
      res.status(status).json(body);
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

// Create and edit issues (#72)
const issueRefSchema = z
  .object({ repo: boardRepoSlugSchema, number: z.number().int().positive() })
  .strict();
const issueNames = z.array(z.string().min(1).max(100)).max(50);
const boardIssueFields = {
  body: z.string().max(65536).optional(),
  labels: issueNames.optional(),
  assignees: issueNames.optional(),
  milestone: z.string().min(1).max(255).nullable().optional(),
};
const createIssueSchema = z
  .object({
    repo: boardRepoSlugSchema,
    title: z.string().trim().min(1).max(256),
    statusOptionId: z.string().min(1).max(100).optional(),
    // Resume: issue already created, only add it to the project (see createIssue)
    issueId: z
      .string()
      .regex(/^I_[A-Za-z0-9_-]+$/)
      .optional(),
    ...boardIssueFields,
  })
  .strict();
const updateIssueSchema = z
  .object({
    title: z.string().trim().min(1).max(256).optional(),
    ...boardIssueFields,
    state: z.enum(['OPEN', 'CLOSED']).optional(),
    stateReason: z.enum(['COMPLETED', 'NOT_PLANNED', 'DUPLICATE']).optional(),
    parent: issueRefSchema.nullable().optional(),
    addSubIssue: issueRefSchema.optional(),
    removeSubIssue: z
      .string()
      .regex(/^I_[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict();
const issueNodeIdSchema = z.string().regex(/^I_[A-Za-z0-9_-]+$/);

// Board writes reach only repos Orkumo knows (#88); the gh token can write many more, and the
// server is reachable remotely
async function assertWritableRepo(repo) {
  const { source } = settingsService.getBoardSettings();
  await boardService.assertRepoWritable(source, repo, findRepoInKnownDirs);
}
async function assertWritableIssue(issueId) {
  await assertWritableRepo((await boardService.getIssueSummary(issueId)).repo);
}

app.get('/api/board/repo-options', agentLimiter, async (req, res) => {
  const slug = boardRepoSlugSchema.safeParse(req.query.repo);
  if (!slug.success) return res.status(400).json({ error: 'Invalid repo' });
  try {
    res.json(await boardService.getRepoOptions(slug.data, { refresh: req.query.refresh === '1' }));
  } catch (error) {
    sendAgentError(res, error);
  }
});

app.get(
  '/api/board/issues/:issueId',
  agentLimiter,
  validateParams(issueNodeIdSchema),
  async (req, res) => {
    try {
      res.json(await boardService.getIssueDetails(req.params.issueId));
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

/**
 * POST /api/board/images?repo=owner/name - commit an issue image to the `issue-assets` branch
 */
app.post('/api/board/images', agentLimiter, imageBody, async (req, res) => {
  const slug = boardRepoSlugSchema.safeParse(req.query.repo);
  if (!slug.success) return res.status(400).json({ error: 'Invalid repo' });
  try {
    await assertWritableRepo(slug.data);
    res.status(201).json(await imageUpload.uploadIssueImage(slug.data, req.body));
  } catch (error) {
    sendAgentError(res, error);
  }
});

// Issue comments (#104)
const commentSchema = z.object({ body: z.string().trim().min(1).max(65536) }).strict();
app.get(
  '/api/board/issues/:issueId/comments',
  agentLimiter,
  validateParams(issueNodeIdSchema),
  async (req, res) => {
    try {
      res.json({ comments: await boardService.getIssueComments(req.params.issueId) });
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);
app.post(
  '/api/board/issues/:issueId/comments',
  agentLimiter,
  validateParams(issueNodeIdSchema),
  validate(commentSchema),
  async (req, res) => {
    try {
      await assertWritableIssue(req.params.issueId);
      res.json({
        comments: await boardService.addIssueComment(req.params.issueId, req.body.body),
      });
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);
// Issue that is not on the board (issue modal): summary by repo/number, label set by node id
app.get('/api/board/issue', agentLimiter, async (req, res) => {
  const ref = issueRefSchema.safeParse({ repo: req.query.repo, number: Number(req.query.number) });
  if (!ref.success) return res.status(400).json({ error: 'Invalid repo or number' });
  try {
    const id = await boardService.issueNodeId(ref.data.repo, ref.data.number);
    res.json(await boardService.getIssueSummary(id));
  } catch (error) {
    sendAgentError(res, error);
  }
});
app.put(
  '/api/board/issues/:issueId/labels',
  agentLimiter,
  validateParams(issueNodeIdSchema),
  validate(z.object({ labels: issueNames }).strict()),
  async (req, res) => {
    try {
      await assertWritableIssue(req.params.issueId);
      res.json(await boardService.setIssueLabels(req.params.issueId, req.body.labels));
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

app.post('/api/board/issues', agentLimiter, validate(createIssueSchema), async (req, res) => {
  try {
    const { source } = settingsService.getBoardSettings();
    // A resumed create (issueId) puts that issue on the board, so its own repo is checked too
    const allowed = Promise.all([
      assertWritableRepo(req.body.repo),
      req.body.issueId && assertWritableIssue(req.body.issueId),
    ]);
    res.status(201).json(await boardService.createIssue(source, req.body, { allowed }));
  } catch (error) {
    sendAgentError(res, error);
  }
});

app.patch(
  '/api/board/items/:itemId/issue',
  agentLimiter,
  validateParams(boardItemIdSchema),
  validate(updateIssueSchema),
  async (req, res) => {
    try {
      const { source } = settingsService.getBoardSettings();
      // The edited issue is on the board; a parent or sub-issue may live elsewhere
      for (const ref of [req.body.parent, req.body.addSubIssue]) {
        if (ref) await assertWritableRepo(ref.repo);
      }
      res.json(await boardService.updateIssue(source, req.params.itemId, req.body));
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

app.get('/api/board/settings', (req, res) => {
  try {
    res.json(settingsService.getBoardSettings());
  } catch (error) {
    sendAgentError(res, error);
  }
});

app.put('/api/board/settings', validate(boardSettingsSchema), (req, res) => {
  try {
    // Only a different source invalidates the cache (and its fresh-write protection)
    const { source } = settingsService.getBoardSettings();
    if (
      req.body.source &&
      (req.body.source.owner !== source.owner || req.body.source.number !== source.number)
    ) {
      // The board decides which repos the write routes accept, so only this machine may switch it
      if (!remoteAccess.isLocalRequest(req)) return res.status(403).json({ error: 'Local only' });
      boardService.clearCache();
    }
    res.json(settingsService.updateBoardSettings(req.body));
  } catch (error) {
    sendAgentError(res, error);
  }
});

// ============================================
// Chat history (#280): claude.ai / ChatGPT conversations, imported exports or synced by the
// desktop app (electron/chatSync.js), local only
// ============================================

const chatHistory = createChatHistory();
// Read the store now, in the background: the first search after a start should not wait for it
chatHistory.list({ limit: 1 }).catch(() => {});
const epochMs = z.coerce.number().int().nonnegative().optional();
const chatHistoryQuerySchema = z.object({
  q: z.string().max(200).optional(),
  provider: z.enum(['claude', 'chatgpt']).optional(),
  project: z.string().max(200).optional(),
  topic: z.string().max(200).optional(),
  from: epochMs,
  to: epochMs,
  limit: z.coerce.number().int().min(1).max(100_000).optional(),
});

// Security review M3: the history is private, and any page on any loopback port (every local dev
// app) passes CORS. Readers: the Electron renderer (secret); this machine without an Origin (curl,
// same-origin GETs, not a cross-site embed); pages from this server's or the Vite dev server's port.
const ownPagePorts = new Set([String(PORT), String(process.env.VITE_PORT || PORTS.devhub)]);
const isOwnPageOrigin = (origin) => {
  try {
    const url = new URL(origin);
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && ownPagePorts.has(url.port);
  } catch {
    return false;
  }
};
const chatHistoryReader = (req, res, next) => {
  const origin = req.headers.origin;
  const local =
    remoteAccess.isLocalRequest(req) &&
    (origin
      ? isOwnPageOrigin(origin)
      : ['same-origin', 'none', undefined].includes(req.headers['sec-fetch-site']));
  if (local || hasRendererSecret(req)) return next();
  res.status(403).json({ error: 'Local only' });
};

// Reads of the local store: search asks per keystroke, so only the general API limit applies
app.get('/api/chat-history', chatHistoryReader, async (req, res) => {
  const query = chatHistoryQuerySchema.safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: 'Invalid chat history query' });
  try {
    res.json(await chatHistory.list(query.data));
  } catch (error) {
    sendAgentError(res, error);
  }
});

app.get('/api/chat-history/conversation', chatHistoryReader, async (req, res) => {
  try {
    const conversation = await chatHistory.get(String(req.query.id ?? ''));
    if (!conversation) return res.status(404).json({ error: 'Unknown conversation' });
    res.json(conversation);
  } catch (error) {
    sendAgentError(res, error);
  }
});

// The path names a folder on this machine, so only this machine may send it. The service
// opens nothing but conversations*.json / projects.json below it and answers with counts.
app.post('/api/chat-history/import', agentLimiter, chatHistoryReader, async (req, res) => {
  const body = z.object({ path: z.string().min(1).max(2000) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid import path' });
  try {
    res.json(await chatHistory.importFrom(body.data.path));
  } catch (error) {
    sendAgentError(res, error);
  }
});

// The desktop app's sync (electron/chatSync.js, main process) posts the providers' conversations
// here; it reads sync-state first to fetch only what changed. Local only: a client elsewhere must
// not write into this machine's history. Own media type with its own size cap: one long
// conversation outgrows the 1 MB JSON limit, and only this route accepts the type.
const CHAT_INGEST_TYPE = 'application/vnd.orkumo.chats+json';
const chatIngestSchema = z.object({
  provider: z.enum(['claude', 'chatgpt']),
  conversations: z.array(z.object({}).passthrough()).max(50),
  projects: z
    .array(z.object({ id: z.string().min(1).max(200), name: z.string().max(500) }))
    .max(5000)
    .optional(),
  state: z
    .object({
      lastUpdatedAt: z.number().int().nonnegative().optional(),
      orgId: z.string().max(100).optional(),
    })
    .strict()
    .optional(),
});
const localChatSync = (req, res, next) =>
  remoteAccess.isLocalRequest(req) && remoteAccess.isLoopbackOrigin(req.headers.origin)
    ? next()
    : res.status(403).json({ error: 'Local only' });

app.get('/api/chat-history/sync-state', chatHistoryReader, async (req, res) => {
  try {
    res.json(await chatHistory.syncState());
  } catch (error) {
    sendAgentError(res, error);
  }
});

app.post(
  '/api/chat-history/ingest',
  localChatSync,
  express.json({ type: CHAT_INGEST_TYPE, limit: '32mb' }),
  async (req, res) => {
    if (!req.is(CHAT_INGEST_TYPE))
      return res.status(415).json({ error: `Send the batch as ${CHAT_INGEST_TYPE}` });
    const body = chatIngestSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: 'Invalid chat batch' });
    try {
      res.json(await chatHistory.ingest(body.data));
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

// ============================================
// Project contexts (#97): title bar tabs with their own favorites, board slices, agent tabs
// ============================================

const contextIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
const contextFieldsSchema = z.object({
  name: z.string().trim().min(1).max(60),
  // null = every project (the default "Alle" context)
  appIds: z.array(idSchema).max(1000).nullable(),
  boardFilter: boardSliceKeys,
});
// Client localStorage entries of the context being left (UI_KEYS in hooks/useProjectContexts.ts)
const contextUiValue = z.string().max(300_000).nullable().optional();
const contextUiSchema = z
  .object({
    'devOrbitAgentWorkspace.v2': contextUiValue,
    devOrbitAgentWorkspace: contextUiValue,
    'devOrbitAgentRail.v1': contextUiValue,
    devOrbitContextRoute: contextUiValue,
    devOrbitShellBrowser: contextUiValue,
  })
  .strict();

app.get('/api/contexts', (req, res) => {
  try {
    res.json(settingsService.getContexts());
  } catch (error) {
    sendAgentError(res, error);
  }
});

app.post(
  '/api/contexts',
  validate(contextFieldsSchema.partial({ appIds: true, boardFilter: true }).strict()),
  (req, res) => {
    try {
      res.status(201).json(settingsService.createContext(req.body));
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

app.put(
  '/api/contexts/order',
  validate(z.object({ ids: z.array(contextIdSchema).max(100) }).strict()),
  (req, res) => {
    try {
      res.json(settingsService.reorderContexts(req.body.ids));
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

app.patch(
  '/api/contexts/:id',
  validateParams(contextIdSchema),
  validate(contextFieldsSchema.partial().strict()),
  (req, res) => {
    try {
      res.json(settingsService.updateContext(req.params.id, req.body));
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

app.delete('/api/contexts/:id', validateParams(contextIdSchema), (req, res) => {
  try {
    res.json(settingsService.deleteContext(req.params.id));
  } catch (error) {
    sendAgentError(res, error);
  }
});

app.post(
  '/api/contexts/:id/activate',
  validateParams(contextIdSchema),
  validate(z.object({ ui: contextUiSchema.nullable(), from: contextIdSchema.optional() }).strict()),
  (req, res) => {
    try {
      res.json(settingsService.activateContext(req.params.id, req.body.ui, req.body.from));
    } catch (error) {
      sendAgentError(res, error);
    }
  }
);

/**
 * Agent view preferences (grouping, layout, dispatch defaults, scope)
 */
app.get('/api/settings/agent-view', (req, res) => {
  try {
    res.json(settingsService.getAgentViewSettings());
  } catch (error) {
    sendAgentError(res, error);
  }
});

app.put('/api/settings/agent-view', validate(agentViewSettingsSchema), (req, res) => {
  try {
    if (req.body.scopeCwd) {
      req.body.scopeCwd = agentService.assertAllowedPath(
        req.body.scopeCwd,
        agentService.getAllowedDirectories(),
        'Scope directory'
      );
    }
    res.json(settingsService.updateAgentViewSettings(req.body));
  } catch (error) {
    sendAgentError(res, error);
  }
});

// ============================================
// 404 Handler for API routes
// ============================================

app.use((req, res) => {
  // API-only server - return 404 for unknown routes
  res.status(404).json({ error: 'Not found' });
});

// ============================================
// Start Server with WebSocket Support
// ============================================

const server = createServer(app);

// WebSocket server for PTY communication
// noServer: ws attached to `server` answers every other upgrade path with 400, so one dispatcher
// routes /api/pty here and /api/modules/<id>/... to the module's ctx.onUpgrade (docs/MODULES.md).
const wss = new WebSocketServer({ noServer: true });

const refuseUpgrade = (socket, status) => {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
};

// Browsers do not apply CORS to WebSockets: a foreign page could open a PTY on localhost. Same-origin
// pages (the app served through `tailscale serve`) and the CORS origins pass; opaque origins (the
// file:// renderer) as for HTTP. Same host only in remote mode: without it a DNS-rebound name would
// pass, with it a non-loopback Host still needs the token or an authorizer (isAuthorized).
const isAllowedUpgradeOrigin = (req) => {
  const origin = req.headers.origin;
  if (isOpaqueRequest(req)) return isTrustedOpaque(req);
  if (!origin || isAllowedOrigin(origin)) return true;
  if (!remoteAccess.isRemoteEnabled()) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
};

server.on('upgrade', (req, socket, head) => {
  remoteAccess.takeServePrefix(req);
  if (!isAllowedUpgradeOrigin(req)) return refuseUpgrade(socket, '403 Forbidden');
  if (!remoteAccess.isAuthorized(req)) return refuseUpgrade(socket, '401 Unauthorized');
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname === '/api/pty') {
    return wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  }
  const moduleId = /^\/api\/modules\/([a-z0-9-]+)\//.exec(pathname)?.[1];
  const handler = moduleId && moduleHost.upgradeHandler(moduleId);
  if (!handler) return refuseUpgrade(socket, '404 Not Found');
  try {
    handler(req, socket, head);
  } catch (error) {
    console.error(`[Modules] upgrade handler of "${moduleId}" failed:`, error);
    refuseUpgrade(socket, '500 Internal Server Error');
  }
});

// Store WebSocket -> sessionId mapping (for local PTY mode)
const wsSessionMap = new Map();

// Store WebSocket -> host PTY WebSocket mapping (for Docker proxy mode)
const wsProxyMap = new Map();

/**
 * Handle PTY connection in Docker mode - proxy to host PTY service
 */
function handleDockerPtyConnection(clientWs, sessionId, cwd, cols, rows, options = {}) {
  // Build URL to host PTY service. Forward command/args (e.g. "claude attach <id>")
  // so the PTY-Host can spawn the right binary instead of a default shell.
  const params = new URLSearchParams({
    sessionId,
    cwd,
    cols: String(cols),
    rows: String(rows),
  });
  if (options.command) params.set('command', options.command);
  if (Array.isArray(options.args) && options.args.length > 0) {
    params.set('args', JSON.stringify(options.args));
  }
  const hostPtyUrl = `${PTY_HOST_URL}?${params.toString()}`;

  console.log(`[PTY-Proxy] Connecting to host PTY service: ${hostPtyUrl}`);

  const hostWs = new WebSocket(hostPtyUrl);

  hostWs.on('open', () => {
    console.log(`[PTY-Proxy] Connected to host PTY service for session ${sessionId}`);
    wsProxyMap.set(clientWs, hostWs);
  });

  // Forward messages from host PTY to client
  hostWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data.toString());
    }
  });

  // Handle host PTY connection close
  hostWs.on('close', () => {
    console.log(`[PTY-Proxy] Host PTY connection closed for session ${sessionId}`);
    wsProxyMap.delete(clientWs);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: 'exit', exitCode: 0, signal: null }));
      clientWs.close();
    }
  });

  // Handle host PTY errors
  hostWs.on('error', (err) => {
    console.error(`[PTY-Proxy] Host PTY error for session ${sessionId}:`, err.message);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(
        JSON.stringify({
          type: 'error',
          message: `Failed to connect to host PTY service: ${err.message}`,
        })
      );
      clientWs.close();
    }
    wsProxyMap.delete(clientWs);
  });

  // Forward messages from client to host PTY
  clientWs.on('message', (message) => {
    const hostWsConn = wsProxyMap.get(clientWs);
    if (hostWsConn && hostWsConn.readyState === WebSocket.OPEN) {
      hostWsConn.send(message.toString());
    }
  });

  // Handle client close
  clientWs.on('close', () => {
    console.log(`[PTY-Proxy] Client disconnected for session ${sessionId}`);
    const hostWsConn = wsProxyMap.get(clientWs);
    if (hostWsConn) {
      hostWsConn.close();
      wsProxyMap.delete(clientWs);
    }
  });

  // Handle client errors
  clientWs.on('error', (err) => {
    console.error(`[PTY-Proxy] Client WebSocket error for session ${sessionId}:`, err.message);
    const hostWsConn = wsProxyMap.get(clientWs);
    if (hostWsConn) {
      hostWsConn.close();
      wsProxyMap.delete(clientWs);
    }
  });
}

/**
 * Handle PTY connection in local mode. Shells and `claude attach` are PTYs of this process and end
 * with their socket; agent panes (`options.detachOnClose`) open their held agent (`openAgentPty`):
 * a closed socket only detaches, and a new one for the pane reattaches.
 */
async function handleLocalPtyConnection(ws, sessionId, cwd, cols, rows, options = {}) {
  const send = (msg) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const handle = (sid, message) => {
    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        case 'input':
          writeToPty(sid, data.data);
          break;

        case 'resize':
          if (data.cols && data.rows) {
            resizePty(sid, data.cols, data.rows);
          }
          break;

        case 'ping':
          send({ type: 'pong' });
          break;

        default:
          console.warn('[PTY] Unknown message type:', data.type);
      }
    } catch (err) {
      writeToPty(sid, message.toString());
    }
  };
  // Starting an agent takes a moment: the client's first resize and keys wait for its PTY
  const early = [];
  let closed = false;
  ws.on('message', (message) => {
    const sid = wsSessionMap.get(ws);
    if (sid) handle(sid, message);
    else if (!closed) early.push(message);
  });

  // This socket's PTY: on close it must not kill a newer PTY that reused the sessionId
  let ptyPid;
  const release = () => {
    closed = true;
    const sid = wsSessionMap.get(ws);
    if (!sid) return;
    wsSessionMap.delete(ws);
    if (options.detachOnClose) console.log(`[PTY] Session ${sid} detached`);
    else {
      console.log(`[PTY] Session ${sid} closed`);
      killPtySession(sid, ptyPid);
    }
  };
  ws.on('close', release);
  ws.on('error', (err) => {
    console.error(`[PTY] WebSocket error for session ${wsSessionMap.get(ws)}:`, err);
    release();
  });

  let result;
  try {
    result = options.detachOnClose
      ? await openAgentPty(sessionId, cwd, cols, rows, options)
      : createPtySession(sessionId, cwd, cols, rows, options);
  } catch (err) {
    result = { success: false, error: err.message };
  }
  if (!result.success) {
    console.error(`[PTY] Failed to create session ${sessionId}:`, result.error);
    send({ type: 'error', message: result.error });
    ws.close();
    return;
  }
  ptyPid = result.pid;
  const sid = result.sessionId;
  if (closed) {
    // the socket went away while the PTY started: an agent runs on detached, a shell ends
    if (!options.detachOnClose) killPtySession(sid, ptyPid);
    return;
  }
  wsSessionMap.set(ws, sid);
  send({
    type: 'connected',
    sessionId: sid,
    pid: result.pid,
    shell: result.shell,
    sessionType: result.type,
    // the directory actually used: a missing one falls back to $HOME (#207)
    cwd: result.cwd ?? cwd,
    reattached: result.reattached === true,
  });
  if (result.reattached) {
    if (result.backlog) send({ type: 'output', data: result.backlog });
    // A TUI redraws on SIGWINCH only when the size changes: nudge it, then the client's size
    resizePty(sid, cols, Math.max(rows - 1, 1));
    setTimeout(() => resizePty(sid, cols, rows), 50);
    console.log(`[PTY] Reattached ${sid} (pid ${result.pid})`);
  } else {
    console.log(
      `[PTY] Session ${sid} created successfully, pid=${result.pid}, type=${result.type}`
    );
  }
  for (const message of early.splice(0)) handle(sid, message);
}

wss.on('connection', (ws, req) => {
  // Parse query params for session config
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const sessionId = url.searchParams.get('sessionId') || `pty-${Date.now()}`;
  const cwdParam = url.searchParams.get('cwd') || process.env.HOME;
  const cols = parseInt(url.searchParams.get('cols') || String(DEFAULT_TERMINAL_COLS), 10);
  const rows = parseInt(url.searchParams.get('rows') || String(DEFAULT_TERMINAL_ROWS), 10);

  // Validate and sanitize cwd path to prevent directory traversal attacks
  let cwd;
  try {
    // Resolve to absolute path and normalize
    cwd = path.resolve(cwdParam);

    // Check for suspicious characters that could indicate path traversal attempts
    if (cwdParam.includes('\0') || cwdParam.includes('\n') || cwdParam.includes('\r')) {
      throw new Error('Invalid characters in path');
    }

    // Verify the path exists and is a directory
    if (!fs.existsSync(cwd)) {
      console.warn(`[PTY] Path does not exist, falling back to HOME: ${cwd}`);
      cwd = process.env.HOME;
    } else if (!fs.statSync(cwd).isDirectory()) {
      console.warn(`[PTY] Path is not a directory, falling back to HOME: ${cwd}`);
      cwd = process.env.HOME;
    }
  } catch (error) {
    console.error(`[PTY] Invalid cwd path: ${cwdParam}`, error.message);
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid working directory path' }));
    ws.close();
    return;
  }

  // Parse and validate optional custom command parameters
  const command = url.searchParams.get('command') || null;

  // Validate command against whitelist
  if (command && !ALLOWED_COMMANDS.includes(command)) {
    console.error(`[PTY] Rejected command not in whitelist: ${command}`);
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid command' }));
    ws.close();
    return;
  }

  // Harness agents (#195): fixed argument shapes, a project directory as cwd, installed binary
  let spawnCommand = command;
  let harnessArgs = null;
  if (isHarnessCommand(command)) {
    const reject = (message) => {
      console.error(`[PTY] Rejected harness ${command}: ${message}`);
      ws.send(JSON.stringify({ type: 'error', message }));
      ws.close();
    };
    try {
      harnessArgs = JSON.parse(url.searchParams.get('args') || '[]');
    } catch {
      return reject('Failed to parse args');
    }
    const argsError = harnessArgsError(command, harnessArgs);
    if (argsError) return reject(argsError);
    try {
      cwd = agentService.assertAllowedPath(
        cwdParam,
        agentService.getAllowedDirectories(),
        'Working directory'
      );
    } catch (error) {
      return reject(error.message);
    }
    // shortcut: in Docker the binary lives on the host, pty-host resolves it there
    if (!isRunningInDocker) {
      spawnCommand = resolveHarnessBinary(command);
      if (!spawnCommand) return reject(`${command} is not installed on this machine`);
    }
  }

  // omp panes see the user's Claude skills like an omp chat does (ompSkills.js); server-chosen
  // options go before the validated client args
  let args =
    command === 'omp' && harnessArgs && !isRunningInDocker
      ? [...ompSkillsArgs(spawnCommand, cwd), ...harnessArgs]
      : (harnessArgs ?? []);
  const argsParam = url.searchParams.get('args');
  // harness args are already parsed above; a second decodeURIComponent would mangle a `%` prompt
  if (argsParam && !harnessArgs) {
    try {
      const parsedArgs = JSON.parse(decodeURIComponent(argsParam));
      // Validate that args is an array of strings
      if (!Array.isArray(parsedArgs) || !parsedArgs.every((arg) => typeof arg === 'string')) {
        console.error('[PTY] Invalid args format: must be array of strings');
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid args format' }));
        ws.close();
        return;
      }
      // `--cloud` takes free text as a NEW session description: only validated ids/URLs may pass
      const cloudAt = parsedArgs.indexOf('--cloud');
      if (command === 'claude' && cloudAt !== -1) {
        try {
          agentService.buildCloudArgs(parsedArgs[cloudAt + 1]);
        } catch {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid cloud session target' }));
          ws.close();
          return;
        }
      }
      // Validate args length to prevent DoS
      if (parsedArgs.length > MAX_ARGS_LENGTH) {
        console.error(
          `[PTY] Args length exceeds maximum: ${parsedArgs.length} > ${MAX_ARGS_LENGTH}`
        );
        ws.send(
          JSON.stringify({ type: 'error', message: `Too many arguments (max: ${MAX_ARGS_LENGTH})` })
        );
        ws.close();
        return;
      }

      // Validate individual argument content to prevent injection attacks
      // Check for shell metacharacters and suspicious patterns
      const dangerousPatterns = /[;&|`$()<>\\"\n\r]/;
      const maxArgLength = 1000; // Prevent extremely long individual arguments

      for (const arg of parsedArgs) {
        if (arg.length > maxArgLength) {
          console.error(`[PTY] Argument exceeds maximum length: ${arg.length} > ${maxArgLength}`);
          ws.send(
            JSON.stringify({
              type: 'error',
              message: `Argument too long (max: ${maxArgLength} characters)`,
            })
          );
          ws.close();
          return;
        }

        // For Claude CLI, we only allow specific flags, reject anything with shell metacharacters
        if (command === 'claude' && dangerousPatterns.test(arg)) {
          console.error(`[PTY] Argument contains dangerous characters: ${arg}`);
          ws.send(
            JSON.stringify({
              type: 'error',
              message: 'Invalid argument: contains forbidden characters',
            })
          );
          ws.close();
          return;
        }
      }

      args = parsedArgs;
    } catch (error) {
      console.error('[PTY] Failed to parse args:', error);
      ws.send(JSON.stringify({ type: 'error', message: 'Failed to parse args' }));
      ws.close();
      return;
    }
  }

  const startPty = () => {
    // Agent panes (`agent-<pane>-<ts>`) outlive their socket, except `claude attach`: detaching
    // that one is ending it, the background job keeps running on its own
    const detachOnClose =
      Boolean(command) &&
      sessionId.startsWith('agent-') &&
      !(command === 'claude' && args[0] === 'attach');
    const options = command ? { command: spawnCommand, args, detachOnClose } : {};

    console.log(
      `[PTY] New connection request: sessionId=${sessionId}, cwd=${cwd}, command=${command || 'default shell'}, dockerMode=${isRunningInDocker}`
    );

    if (isRunningInDocker) {
      // In Docker: proxy to host PTY service (forward command/args so
      // `claude attach <id>` works instead of always spawning a shell)
      handleDockerPtyConnection(ws, sessionId, cwd, cols, rows, options);
    } else {
      // On host: spawn PTY directly
      handleLocalPtyConnection(ws, sessionId, cwd, cols, rows, options);
    }
  };

  startPty();
});

// Forward PTY data to corresponding WebSocket clients (local mode only)
ptyEvents.on('data', ({ sessionId, data }) => {
  for (const [ws, wsSessionId] of wsSessionMap) {
    if (wsSessionId === sessionId && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data }));
    }
  }
});

// Handle PTY exit events (local mode only)
ptyEvents.on('exit', ({ sessionId, exitCode, signal }) => {
  console.log(`[PTY] Session ${sessionId} exited with code=${exitCode}, signal=${signal}`);
  for (const [ws, wsSessionId] of wsSessionMap) {
    if (wsSessionId === sessionId && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', exitCode, signal }));
    }
  }
});

// Initialize database before starting server
async function startServer() {
  try {
    migrateDirectorySpelling();
  } catch (error) {
    console.error('[Config] Directory spelling migration failed:', error);
  }
  try {
    logUnknownContextApps();
  } catch (error) {
    console.error('[Projects] Checking context members failed:', error);
  }
  // Try to connect to database (non-blocking)
  const dbConnected = await initializeDatabase();
  const modules = await moduleHost.load(getModulesDir());
  // Agents that outlived the previous server: back before a pane can ask for them
  if (!isRunningInDocker) await restoreHeldPtys();
  // Orchestrator workspace (AGENTS.md, settings, skills, `orkumo` CLI): refreshed every start
  try {
    const { dir, changed } = ensureOrchestratorWorkspace();
    if (changed.length) console.log(`[Orchestrator] Workspace ${dir}: wrote ${changed.join(', ')}`);
  } catch (error) {
    console.error('[Orchestrator] Workspace setup failed:', error.message);
  }

  // A failure to bind is fatal and must be reported as such. Without this the
  // error reaches `uncaughtException` -> cleanup() -> exit code 0, which makes
  // a hard startup failure look like a clean shutdown to the Electron parent.
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `[Server] Port ${PORT} is already in use. Set SERVER_PORT in .env.local to a free port ` +
          `or stop the process using it (lsof -ti:${PORT} | xargs kill -9).`
      );
    } else {
      console.error('[Server] Failed to start:', error);
    }
    process.exit(1);
  });

  // Loopback only: the API starts agents and types into their terminals, so it must not be reachable
  // from the LAN. Remote access goes through `tailscale serve` → loopback. Docker needs every
  // interface (the published port); DEVORBIT_LISTEN_HOST is the explicit opt-in for anything else.
  const host = isRunningInDocker
    ? undefined
    : remoteAccess.isRemoteEnabled()
      ? '127.0.0.1'
      : process.env.DEVORBIT_LISTEN_HOST || '127.0.0.1';
  server.listen(PORT, host, () => {
    // Cold 30-day scan takes seconds; warm the file cache so the first page view is fast.
    getUsage({ days: 30 }).catch((err) => console.warn('Usage warm-up failed:', err.message));
    console.log(`🚀 Orkumo API Server running on http://localhost:${PORT}`);
    console.log(
      `   Database: ${dbConnected ? '✅ Connected' : '⚠️  Not connected (using file storage)'}`
    );
    console.log(`   Modules: ${modules.length ? modules.map((m) => m.id).join(', ') : 'none'}`);
    console.log(`   WebSocket PTY: ws://localhost:${PORT}/api/pty`);
    console.log(`   Endpoints:`);
    console.log(`   - GET  /api/apps            - List discovered apps`);
    console.log(`   - GET  /api/config          - Get configuration`);
    console.log(`   - GET  /api/terminal/sessions - List terminal sessions`);
    console.log(`   - GET  /api/usage           - Token usage and plan limits`);
    console.log(`   - GET  /api/modules         - List loaded modules`);
    console.log(`   - WS   /api/pty             - WebSocket for terminal`);
  });
}

// Cleanup function for graceful shutdown
function cleanup() {
  console.log('\n[Server] Shutting down gracefully...');

  // Kill code-server if we started it
  if (codeServerProcess) {
    console.log('[Server] Stopping code-server...');
    try {
      codeServerProcess.kill('SIGTERM');
      // Give it 2 seconds to shut down gracefully, then force kill
      setTimeout(() => {
        if (codeServerProcess) {
          console.log('[Server] Force killing code-server...');
          codeServerProcess.kill('SIGKILL');
        }
      }, 2000);
    } catch (err) {
      console.error('[Server] Error stopping code-server:', err.message);
    }
  }

  // Close the HTTP server
  server.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds if server doesn't close
  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

// Handle process termination signals
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
// Chat views hold only transcript tailers (no processes): stop their timers on exit
process.on('exit', chatService.stopAllChats);

// Handle uncaught exceptions and rejections
process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught exception:', error);
  cleanup();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled rejection at:', promise, 'reason:', reason);
  // Don't call cleanup here - this might be non-fatal
});

startServer().catch(console.error);
