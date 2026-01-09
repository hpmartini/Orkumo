import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { GoogleGenAI, Type } from '@google/genai';
import http, { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
// NOTE: This is an API-only server. Static files are served by Nginx in the frontend container.
import { getConfig, updateConfig, addDirectory, removeDirectory } from './services/configService.js';
import { scanAllDirectories, scanDirectory } from './services/scannerService.js';
import {
  startProcess,
  stopProcess,
  restartProcess,
  getProcessInfo,
  getAllProcesses,
  getProcessLogs,
  getProcessStats,
  processEvents,
} from './services/processService.js';
import {
  createPtySession,
  writeToPty,
  resizePty,
  killPtySession,
  ptyEvents,
  detectClaudeCLI,
} from './services/ptyService.js';
import { portManager } from './services/PortManager.js';
import { exec } from 'child_process';
import fs from 'fs';
import WebSocket from 'ws';
import { initializeDatabase, isDatabaseConnected, getDb } from './db/index.js';
import { applicationsRepository } from './db/repositories/applicationsRepository.js';
import { terminalSessionManager } from './services/TerminalSessionManager.js';
import { settingsService } from './services/settingsService.js';
import { ideService } from './services/ideService.js';
import { injectLogger, removeLogger, checkLoggerStatus } from './services/loggerInjection.js';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

const app = express();
const PORT = process.env.SERVER_PORT || 3001;

// Constants
const DEFAULT_TERMINAL_COLS = 80;
const DEFAULT_TERMINAL_ROWS = 24;
const ALLOWED_COMMANDS = ['claude']; // Whitelist of allowed custom commands
const MAX_ARGS_LENGTH = 50; // Maximum number of arguments to prevent DoS

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
const PTY_HOST_URL = process.env.PTY_HOST_URL || 'ws://host.docker.internal:3098';

console.log(`[Server] Running in Docker: ${isRunningInDocker}`);
if (isRunningInDocker) {
  console.log(`[Server] PTY will proxy to host service at: ${PTY_HOST_URL}`);
}

// Rate limiting - prevent DoS attacks
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per minute
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limit for process operations
const processLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20, // limit process operations to 20 per minute
  message: { error: 'Too many process operations, please slow down' },
});

// Rate limit for IDE launch operations
const ideLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // limit IDE launches to 10 per minute
  message: { error: 'Too many IDE launch requests, please slow down' },
});

app.use(cors());
app.use(express.json({ limit: '1mb' })); // Limit body size
app.use(limiter);

// ============================================
// Input Validation Schemas (Zod)
// ============================================

const pathSchema = z.string().min(1).max(500);
const idSchema = z.string().min(1).max(50);
const commandSchema = z.string().min(1).max(200);

const startAppSchema = z.object({
  path: pathSchema,
  command: commandSchema,
  port: z.number().int().min(1).max(65535).optional(),
});

const configUpdateSchema = z.object({
  scanDepth: z.number().int().min(1).max(10).optional(),
  excludePatterns: z.array(z.string().max(50)).max(20).optional(),
});

const directorySchema = z.object({
  path: pathSchema,
});

const analyzeSchema = z.object({
  fileName: z.string().min(1).max(100),
  fileContent: z.string().min(1).max(50000),
});

// IDE ID can be built-in or custom (alphanumeric with dashes)
const ideIdSchema = z.string().min(1).max(50).regex(/^[a-z0-9-]+$/);

const openIdeSchema = z.object({
  ide: ideIdSchema,
});

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
          details: error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
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
      for (const [key, value] of Object.entries(req.params)) {
        schema.parse(value);
      }
      next();
    } catch (error) {
      return res.status(400).json({ error: 'Invalid parameter format' });
    }
  };
}

// Validate API key on startup
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn('⚠️  GEMINI_API_KEY not found in .env.local - AI features will be disabled');
}

// Store connected SSE clients for real-time updates
const sseClients = new Map(); // Map<response, { lastActive: Date, heartbeatInterval: NodeJS.Timeout }>

// SSE heartbeat interval (30 seconds)
const SSE_HEARTBEAT_INTERVAL = 30000;
// SSE client timeout (2 minutes of no response)
const SSE_CLIENT_TIMEOUT = 120000;

// Cleanup stale SSE clients periodically
setInterval(() => {
  const now = Date.now();
  for (const [client, info] of sseClients) {
    if (now - info.lastActive > SSE_CLIENT_TIMEOUT) {
      clearInterval(info.heartbeatInterval);
      sseClients.delete(client);
      try {
        client.end();
      } catch {
        // Client already disconnected
      }
    }
  }
}, 60000); // Check every minute

// ============================================
// SSE Endpoint for real-time updates
// ============================================

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send initial connection message
  res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

  // Set up heartbeat to keep connection alive and detect dead clients
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
      const clientInfo = sseClients.get(res);
      if (clientInfo) {
        clientInfo.lastActive = Date.now();
      }
    } catch {
      // Client disconnected, cleanup will handle it
    }
  }, SSE_HEARTBEAT_INTERVAL);

  sseClients.set(res, { lastActive: Date.now(), heartbeatInterval });

  req.on('close', () => {
    const clientInfo = sseClients.get(res);
    if (clientInfo) {
      clearInterval(clientInfo.heartbeatInterval);
    }
    sseClients.delete(res);
  });

  req.on('error', () => {
    const clientInfo = sseClients.get(res);
    if (clientInfo) {
      clearInterval(clientInfo.heartbeatInterval);
    }
    sseClients.delete(res);
  });
});

// Broadcast events to all connected clients
function broadcast(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [client] of sseClients) {
    try {
      client.write(message);
    } catch {
      // Client disconnected, will be cleaned up
    }
  }
}

// Forward process events to SSE clients
processEvents.on('status', (data) => broadcast('process-status', data));
processEvents.on('log', (data) => broadcast('process-log', data));

// Broadcast stats for all running processes every 2 seconds
const STATS_BROADCAST_INTERVAL = 2000;
const statsInterval = setInterval(async () => {
  const allProcesses = getAllProcesses();
  const runningProcesses = Object.entries(allProcesses).filter(
    ([_, info]) => info.status === 'RUNNING' && info.pid
  );

  // Skip iteration if no processes are running
  if (runningProcesses.length === 0) return;

  for (const [appId, processInfo] of runningProcesses) {
    try {
      const stats = await getProcessStats(processInfo.pid);
      // Include actual uptime from server
      const uptime = processInfo.startTime ? Math.floor((Date.now() - processInfo.startTime) / 1000) : 0;
      broadcast('process-stats', {
        appId,
        cpu: stats.cpu,
        memory: stats.memory,
        uptime,
      });
    } catch (error) {
      console.warn(`[Stats] Failed to collect stats for ${appId}:`, error.message);
    }
  }
}, STATS_BROADCAST_INTERVAL);

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
      return res.status(400).json({ error: 'Invalid sort mode. Must be one of: manual, alpha-asc, alpha-desc' });
    }

    const newMode = settingsService.setFavoritesSortMode(mode);
    res.json({ favoritesSortMode: newMode });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
 * PUT /api/settings/port/:id
 * Set custom port for an app
 */
app.put('/api/settings/port/:id', validateParams(idSchema), (req, res) => {
  try {
    const { id } = req.params;
    const { port } = req.body;

    // Validate port
    if (port !== null && port !== undefined) {
      const portNum = parseInt(port, 10);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        return res.status(400).json({ error: 'Invalid port number' });
      }
      settingsService.setPort(id, portNum);
      res.json({ id, port: portNum });
    } else {
      // Clear custom port
      settingsService.setPort(id, null);
      res.json({ id, port: null });
    }
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
 * POST /api/apps/:id/open-ide
 * Open app directory in specified IDE
 */
app.post('/api/apps/:id/open-ide', ideLimiter, validateParams(idSchema), validate(openIdeSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const { ide } = req.body;

    // Verify IDE is actually installed before attempting to launch
    const installedIDEs = await ideService.detectInstalledIDEs();
    if (!installedIDEs.some(i => i.id === ide)) {
      return res.status(404).json({
        error: 'IDE not installed',
        code: 'IDE_NOT_INSTALLED',
      });
    }

    // Get app directory from config
    const apps = scanAllDirectories();
    const app = apps.find(a => a.id === id);

    if (!app) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Open in IDE
    const result = await ideService.openInIDE(app.path, ide);

    // Save preferred IDE to settings
    settingsService.setPreferredIDE(id, ide);

    res.json(result);
  } catch (error) {
    console.error(`[IDE] Failed to open IDE for app ${req.params.id}:`, error.message);

    // Invalidate cache on IDE_NOT_INSTALLED errors (IDE may have been uninstalled)
    if (error.code === 'IDE_NOT_INSTALLED') {
      ideService.detectionCache = null;
      ideService.cacheTimestamp = null;
    }

    // Send appropriate status code based on error type
    const statusCode = error.code === 'IDE_NOT_INSTALLED' ? 404 :
                      error.code === 'IDE_NOT_SUPPORTED' ? 400 :
                      error.code === 'INVALID_PROJECT_PATH' ? 404 :
                      error.code === 'PERMISSION_DENIED' ? 403 : 500;

    // Sanitize error messages to avoid exposing sensitive paths
    const sanitizedMessage = error.code === 'PERMISSION_DENIED' ? 'Permission denied accessing project directory' :
                            error.code === 'INVALID_PROJECT_PATH' ? 'Project directory not found' :
                            error.message;

    res.status(statusCode).json({
      error: sanitizedMessage,
      code: error.code || 'UNKNOWN_ERROR',
    });
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

/**
 * PUT /api/settings/preferred-ide/:id
 * Set preferred IDE for an app
 */
app.put('/api/settings/preferred-ide/:id', validateParams(idSchema), (req, res) => {
  try {
    const { id } = req.params;
    const { ide } = req.body;

    if (ide && typeof ide === 'string' && ide.trim().length > 0) {
      settingsService.setPreferredIDE(id, ide.trim());
      res.json({ id, ide: ide.trim() });
    } else {
      // Clear preferred IDE
      settingsService.setPreferredIDE(id, null);
      res.json({ id, ide: null });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// DevTools Logger Injection Endpoints
// ============================================

/**
 * GET /api/apps/:id/devtools-status
 * Check if DevOrbit logger is injected in a project
 */
app.get('/api/apps/:id/devtools-status', validateParams(idSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const apps = scanAllDirectories();
    const app = apps.find(a => a.id === id);

    if (!app) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const status = await checkLoggerStatus(app.path);
    res.json({
      appId: id,
      ...status,
    });
  } catch (error) {
    console.error(`[DevTools] Error checking status for app ${req.params.id}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/apps/:id/inject-logger
 * Inject DevOrbit logger into a project's entry file
 */
app.post('/api/apps/:id/inject-logger', processLimiter, validateParams(idSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const apps = scanAllDirectories();
    const app = apps.find(a => a.id === id);

    if (!app) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const result = await injectLogger(app.path);

    if (result.success) {
      console.log(`[DevTools] Logger injected into ${app.name} (${result.framework})`);
      res.json({
        success: true,
        message: result.message,
        file: result.file,
        framework: result.framework,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.message,
        file: result.file,
      });
    }
  } catch (error) {
    console.error(`[DevTools] Error injecting logger for app ${req.params.id}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/apps/:id/remove-logger
 * Remove DevOrbit logger from a project's entry file
 */
app.post('/api/apps/:id/remove-logger', processLimiter, validateParams(idSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const apps = scanAllDirectories();
    const app = apps.find(a => a.id === id);

    if (!app) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const result = await removeLogger(app.path);

    if (result.success) {
      console.log(`[DevTools] Logger removed from ${app.name}`);
      res.json({
        success: true,
        message: result.message,
        file: result.file,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.message,
        file: result.file,
      });
    }
  } catch (error) {
    console.error(`[DevTools] Error removing logger for app ${req.params.id}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// File System Endpoints (for Monaco Editor)
// ============================================

/**
 * GET /api/files/tree
 * Get file tree for a directory
 */
app.get('/api/files/tree', async (req, res) => {
  try {
    const { path: dirPath, depth = 3 } = req.query;
    if (!dirPath) {
      return res.status(400).json({ error: 'path is required' });
    }

    const { default: fs } = await import('fs');
    const { default: pathModule } = await import('path');

    const buildTree = (dir, currentDepth = 0, maxDepth = parseInt(depth)) => {
      if (currentDepth >= maxDepth) return [];

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        return entries
          .filter(entry => !entry.name.startsWith('.') && entry.name !== 'node_modules')
          .sort((a, b) => {
            // Directories first
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name);
          })
          .map(entry => {
            const fullPath = pathModule.join(dir, entry.name);
            const node = {
              name: entry.name,
              path: fullPath,
              isDirectory: entry.isDirectory(),
            };
            if (entry.isDirectory()) {
              node.children = buildTree(fullPath, currentDepth + 1, maxDepth);
            }
            return node;
          });
      } catch (err) {
        return [];
      }
    };

    const tree = buildTree(dirPath);
    res.json({ tree });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/files/read
 * Read a file's content
 */
app.get('/api/files/read', async (req, res) => {
  try {
    const { path: filePath } = req.query;
    if (!filePath) {
      return res.status(400).json({ error: 'path is required' });
    }

    const { default: fs } = await import('fs');
    const { default: pathModule } = await import('path');

    // Security: ensure path is within allowed directories
    const config = getConfig();
    const allowedDirs = config.directories || [];
    const realPath = fs.realpathSync(filePath);
    const isAllowed = allowedDirs.some(dir => realPath.startsWith(fs.realpathSync(dir)));

    if (!isAllowed) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Cannot read directory' });
    }

    // Limit file size to 1MB
    if (stats.size > 1024 * 1024) {
      return res.status(400).json({ error: 'File too large (max 1MB)' });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = pathModule.extname(filePath).slice(1);

    res.json({
      path: filePath,
      content,
      language: getLanguageFromExtension(ext),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/files/write
 * Write content to a file
 */
app.put('/api/files/write', async (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) {
      return res.status(400).json({ error: 'path and content are required' });
    }

    const { default: fs } = await import('fs');

    // Security: ensure path is within allowed directories
    const config = getConfig();
    const allowedDirs = config.directories || [];
    const realPath = fs.existsSync(filePath) ? fs.realpathSync(filePath) : filePath;
    const isAllowed = allowedDirs.some(dir => {
      const realDir = fs.realpathSync(dir);
      return realPath.startsWith(realDir);
    });

    if (!isAllowed) {
      return res.status(403).json({ error: 'Access denied' });
    }

    fs.writeFileSync(filePath, content, 'utf-8');
    res.json({ success: true, path: filePath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper to map file extensions to Monaco language IDs
function getLanguageFromExtension(ext) {
  const map = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    json: 'json',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    md: 'markdown',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    sql: 'sql',
    graphql: 'graphql',
    vue: 'vue',
    svelte: 'svelte',
  };
  return map[ext] || 'plaintext';
}

/**
 * GET /api/apps/:id/package
 * Read actual package.json from an app's directory
 */
app.get('/api/apps/:id/package', validateParams(idSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const apps = scanAllDirectories();
    const app = apps.find(a => a.id === id);

    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const { default: fs } = await import('fs');
    const { default: pathModule } = await import('path');
    const packagePath = pathModule.join(app.path, 'package.json');

    if (!fs.existsSync(packagePath)) {
      return res.status(404).json({ error: 'package.json not found' });
    }

    const content = fs.readFileSync(packagePath, 'utf-8');
    res.json({ fileName: 'package.json', content });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// Scanning Endpoints
// ============================================

/**
 * GET /api/apps
 * Scan all configured directories and return discovered apps
 */
app.get('/api/apps', (req, res) => {
  try {
    const apps = scanAllDirectories();

    // Merge with running process info
    const processes = getAllProcesses();
    const enrichedApps = apps.map(app => {
      const processInfo = processes[app.id];
      if (processInfo) {
        return {
          ...app,
          status: processInfo.status,
          uptime: processInfo.uptime,
        };
      }
      return app;
    });

    res.json(enrichedApps);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

/**
 * POST /api/apps/:id/start
 * Start an app
 */
app.post('/api/apps/:id/start', processLimiter, validateParams(idSchema), validate(startAppSchema), (req, res) => {
  try {
    const { id } = req.params;
    const { path: appPath, command, port } = req.body;

    const result = startProcess(id, appPath, command, port);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/apps/:id/stop
 * Stop an app
 */
app.post('/api/apps/:id/stop', processLimiter, validateParams(idSchema), (req, res) => {
  try {
    const { id } = req.params;
    const result = stopProcess(id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/apps/:id/restart
 * Restart an app
 */
app.post('/api/apps/:id/restart', processLimiter, validateParams(idSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await restartProcess(id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/apps/:id/stats
 * Get real CPU/memory stats for a running app
 */
app.get('/api/apps/:id/stats', validateParams(idSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const info = getProcessInfo(id);
    if (!info || !info.process?.pid) {
      return res.json({ cpu: 0, memory: 0 });
    }
    const stats = await getProcessStats(info.process.pid);
    res.json(stats);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/apps/:id/logs
 * Get logs for an app
 */
app.get('/api/apps/:id/logs', (req, res) => {
  try {
    const { id } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const logs = getProcessLogs(id, limit);
    res.json(logs);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/apps/:id/status
 * Get status for an app
 */
app.get('/api/apps/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    const info = getProcessInfo(id);
    if (!info) {
      return res.json({ status: 'STOPPED' });
    }
    res.json({
      status: info.status,
      pid: info.process?.pid,
      uptime: info.startTime ? Math.floor((Date.now() - info.startTime) / 1000) : 0,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================
// AI Analysis Endpoint
// ============================================

/**
 * POST /api/analyze
 * Analyzes app configuration using Gemini AI
 */
app.post('/api/analyze', async (req, res) => {
  const { fileName, fileContent } = req.body;

  if (!fileName || !fileContent) {
    return res.status(400).json({
      error: 'Missing required fields: fileName and fileContent'
    });
  }

  if (!apiKey) {
    return res.json({
      command: 'npm start',
      port: 3000,
      type: 'unknown',
      summary: 'API Key missing. Using defaults.'
    });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `Analyze this configuration file for a web application.

Filename: ${fileName}
Content:
${fileContent.substring(0, 3000)}

Return a JSON object with:
- command: The command to run this app in dev mode (e.g., "npm run dev", "yarn dev")
- port: The port number the app will run on (e.g., 3000, 5173)
- type: One of: "vite", "next", "node", "static", "unknown"
- summary: A short one-sentence description of the project`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            command: { type: Type.STRING, description: 'Development command like npm run dev' },
            port: { type: Type.NUMBER, description: 'Port number like 3000 or 5173' },
            type: { type: Type.STRING, enum: ['vite', 'next', 'node', 'static', 'unknown'] },
            summary: { type: Type.STRING, description: 'One sentence project description' },
          },
          required: ['command', 'port', 'type', 'summary'],
        }
      }
    });

    const text = response.text;
    console.log('[Analyze] Raw AI response:', text);

    if (!text) {
      console.error('[Analyze] No response text from AI');
      return res.status(500).json({
        error: 'No response from AI',
        fallback: { command: 'npm run dev', port: 3000, type: 'unknown' }
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (parseError) {
      console.error('[Analyze] JSON parse error:', parseError.message);
      console.error('[Analyze] Raw text was:', text);
      return res.status(500).json({
        error: 'Failed to parse AI response as JSON',
        rawResponse: text.substring(0, 500),
        fallback: { command: 'npm run dev', port: 3000, type: 'unknown' }
      });
    }

    // Validate and provide defaults for missing fields
    // Required fields: command, port, type are critical - summary can be generated
    const criticalMissing = [];
    if (!parsed.command) criticalMissing.push('command');
    if (typeof parsed.port !== 'number') criticalMissing.push('port');
    if (!parsed.type) criticalMissing.push('type');

    if (criticalMissing.length > 0) {
      console.error('[Analyze] Critical fields missing:', criticalMissing);
      console.error('[Analyze] Parsed response:', JSON.stringify(parsed, null, 2));
      return res.status(500).json({
        error: `Invalid response structure: missing ${criticalMissing.join(', ')}`,
        parsedResponse: parsed,
        fallback: { command: 'npm run dev', port: 3000, type: 'unknown' }
      });
    }

    // Provide default summary if missing
    const result = {
      command: parsed.command,
      port: parsed.port,
      type: parsed.type,
      summary: parsed.summary || `${parsed.type} project running on port ${parsed.port}`
    };

    console.log('[Analyze] Success:', result);
    res.json(result);
  } catch (error) {
    console.error('[Analyze] Unexpected error:', error.message);
    console.error('[Analyze] Stack:', error.stack);
    return res.status(500).json({
      error: error.message,
      fallback: { command: 'npm run dev', port: 3000, type: 'unknown' }
    });
  }
});

// ============================================
// Health Check
// ============================================

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    aiEnabled: !!apiKey,
    databaseConnected: isDatabaseConnected(),
    terminalSessions: terminalSessionManager.getStats(),
    timestamp: new Date().toISOString()
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
      error: error.message
    });
  }
});

// ============================================
// Database Application Endpoints
// ============================================

/**
 * PUT /api/apps/:id/preferences
 * Update app preferences (favorite, archive, custom port)
 */
app.put('/api/apps/:id/preferences', validateParams(idSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await applicationsRepository.updatePreferences(id, req.body);

    if (result) {
      res.json(result);
    } else {
      res.status(404).json({ error: 'App not found or no valid updates' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/apps/:id/favorite
 * Toggle favorite status
 */
app.post('/api/apps/:id/favorite', validateParams(idSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const success = await applicationsRepository.toggleFavorite(id);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/apps/:id/archive
 * Toggle archive status
 */
app.post('/api/apps/:id/archive', validateParams(idSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const success = await applicationsRepository.toggleArchive(id);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/apps/:id/history
 * Get run history for an app
 */
app.get('/api/apps/:id/history', validateParams(idSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    const history = await applicationsRepository.getRunHistory(id, limit);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
    res.json(sessions.map(s => ({
      id: s.id,
      appId: s.appId,
      cwd: s.cwd,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
      bufferSize: s.outputBuffer?.length || 0,
    })));
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

/**
 * GET /api/ports/check/:port
 * Check if a port is available
 */
app.get('/api/ports/check/:port', async (req, res) => {
  try {
    const port = parseInt(req.params.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      return res.status(400).json({ error: 'Invalid port number' });
    }

    const available = await portManager.isPortAvailable(port);
    const processInfo = available ? null : await portManager.getProcessOnPort(port);

    res.json({
      port,
      available,
      process: processInfo,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ports/available
 * Find next available port
 */
app.get('/api/ports/available', async (req, res) => {
  try {
    const startPort = parseInt(req.query.start, 10) || 3000;
    const endPort = parseInt(req.query.end, 10) || 4000;

    const port = await portManager.findAvailablePort(startPort, endPort);
    res.json({ port });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/ports/allocate
 * Allocate a port for an app
 */
app.post('/api/ports/allocate', async (req, res) => {
  try {
    const { appId, preferredPort } = req.body;
    if (!appId) {
      return res.status(400).json({ error: 'appId is required' });
    }

    const result = await portManager.allocatePort(appId, preferredPort);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/ports/kill/:port
 * Kill process on a specific port
 */
app.post('/api/ports/kill/:port', processLimiter, async (req, res) => {
  try {
    const port = parseInt(req.params.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      return res.status(400).json({ error: 'Invalid port number' });
    }

    const result = await portManager.killProcessOnPort(port);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ports/scan
 * Scan a range of ports for usage
 */
app.get('/api/ports/scan', async (req, res) => {
  try {
    const startPort = parseInt(req.query.start, 10) || 3000;
    const endPort = parseInt(req.query.end, 10) || 3100;

    const results = await portManager.scanPortRange(startPort, endPort);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Finder/Terminal Integration Endpoints
// ============================================

/**
 * POST /api/apps/:id/open-finder
 * Open app directory in Finder (macOS)
 */
app.post('/api/apps/:id/open-finder', validateParams(idSchema), (req, res) => {
  try {
    const { id } = req.params;
    const apps = scanAllDirectories();
    const app = apps.find(a => a.id === id);

    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    // macOS: open in Finder
    exec(`open "${app.path}"`, (error) => {
      if (error) {
        return res.status(500).json({ error: 'Failed to open Finder' });
      }
      res.json({ success: true });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/apps/:id/open-terminal
 * Open app directory in Terminal (macOS)
 */
app.post('/api/apps/:id/open-terminal', validateParams(idSchema), (req, res) => {
  try {
    const { id } = req.params;
    const apps = scanAllDirectories();
    const app = apps.find(a => a.id === id);

    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    // macOS: open Terminal at path
    const script = `tell application "Terminal" to do script "cd '${app.path}'"`;
    exec(`osascript -e '${script}'`, (error) => {
      if (error) {
        return res.status(500).json({ error: 'Failed to open Terminal' });
      }
      res.json({ success: true });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
      if (!['transfer-encoding', 'content-length', 'content-encoding'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    if (isHtml) {
      // Collect HTML to inject logger script
      let body = '';
      proxyRes.on('data', chunk => { body += chunk.toString(); });
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
const wss = new WebSocketServer({ server, path: '/api/pty' });

// Store WebSocket -> sessionId mapping (for local PTY mode)
const wsSessionMap = new Map();

// Store WebSocket -> host PTY WebSocket mapping (for Docker proxy mode)
const wsProxyMap = new Map();

/**
 * Handle PTY connection in Docker mode - proxy to host PTY service
 */
function handleDockerPtyConnection(clientWs, sessionId, cwd, cols, rows) {
  // Build URL to host PTY service
  const hostPtyUrl = `${PTY_HOST_URL}?sessionId=${encodeURIComponent(sessionId)}&cwd=${encodeURIComponent(cwd)}&cols=${cols}&rows=${rows}`;

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
      clientWs.send(JSON.stringify({ type: 'error', message: `Failed to connect to host PTY service: ${err.message}` }));
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
 * Handle PTY connection in local mode - spawn PTY directly
 */
function handleLocalPtyConnection(ws, sessionId, cwd, cols, rows, options = {}) {
  try {
    const result = createPtySession(sessionId, cwd, cols, rows, options);

    if (!result.success) {
      console.error(`[PTY] Failed to create session ${sessionId}:`, result.error);
      ws.send(JSON.stringify({ type: 'error', message: result.error }));
      ws.close();
      return;
    }

    wsSessionMap.set(ws, sessionId);

    // Send session info
    ws.send(JSON.stringify({
      type: 'connected',
      sessionId,
      pid: result.pid,
      shell: result.shell,
      sessionType: result.type,
    }));

    console.log(`[PTY] Session ${sessionId} created successfully, pid=${result.pid}, type=${result.type}`);
  } catch (err) {
    console.error(`[PTY] Exception creating session ${sessionId}:`, err);
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
    ws.close();
    return;
  }

  // Handle incoming messages from client
  ws.on('message', (message) => {
    const sid = wsSessionMap.get(ws);
    if (!sid) return;

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
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        default:
          console.warn('[PTY] Unknown message type:', data.type);
      }
    } catch (err) {
      writeToPty(sid, message.toString());
    }
  });

  // Handle WebSocket close
  ws.on('close', () => {
    const sid = wsSessionMap.get(ws);
    if (sid) {
      console.log(`[PTY] Session ${sid} closed`);
      wsSessionMap.delete(ws);
      killPtySession(sid);
    }
  });

  ws.on('error', (err) => {
    const sid = wsSessionMap.get(ws);
    console.error(`[PTY] WebSocket error for session ${sid}:`, err);
    if (sid) {
      wsSessionMap.delete(ws);
      killPtySession(sid);
    }
  });
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

  let args = [];
  const argsParam = url.searchParams.get('args');
  if (argsParam) {
    try {
      const parsedArgs = JSON.parse(decodeURIComponent(argsParam));
      // Validate that args is an array of strings
      if (!Array.isArray(parsedArgs) || !parsedArgs.every(arg => typeof arg === 'string')) {
        console.error('[PTY] Invalid args format: must be array of strings');
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid args format' }));
        ws.close();
        return;
      }
      // Validate args length to prevent DoS
      if (parsedArgs.length > MAX_ARGS_LENGTH) {
        console.error(`[PTY] Args length exceeds maximum: ${parsedArgs.length} > ${MAX_ARGS_LENGTH}`);
        ws.send(JSON.stringify({ type: 'error', message: `Too many arguments (max: ${MAX_ARGS_LENGTH})` }));
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
          ws.send(JSON.stringify({ type: 'error', message: `Argument too long (max: ${maxArgLength} characters)` }));
          ws.close();
          return;
        }

        // For Claude CLI, we only allow specific flags, reject anything with shell metacharacters
        if (command === 'claude' && dangerousPatterns.test(arg)) {
          console.error(`[PTY] Argument contains dangerous characters: ${arg}`);
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid argument: contains forbidden characters' }));
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

  const options = command ? { command, args } : {};

  console.log(`[PTY] New connection request: sessionId=${sessionId}, cwd=${cwd}, command=${command || 'default shell'}, dockerMode=${isRunningInDocker}`);

  if (isRunningInDocker) {
    // In Docker: proxy to host PTY service
    handleDockerPtyConnection(ws, sessionId, cwd, cols, rows);
  } else {
    // On host: spawn PTY directly
    handleLocalPtyConnection(ws, sessionId, cwd, cols, rows, options);
  }
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

// Graceful shutdown handler
function setupGracefulShutdown() {
  const shutdown = (signal) => {
    console.log(`\n[Server] Received ${signal}, shutting down gracefully...`);

    // Clear stats interval
    clearInterval(statsInterval);

    // Close server
    server.close(() => {
      console.log('[Server] HTTP server closed');
      process.exit(0);
    });

    // Force close after 10 seconds
    setTimeout(() => {
      console.error('[Server] Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Initialize database before starting server
async function startServer() {
  // Try to connect to database (non-blocking)
  const dbConnected = await initializeDatabase();

  server.listen(PORT, () => {
    console.log(`🚀 DevOrbit API Server running on http://localhost:${PORT}`);
    console.log(`   AI Features: ${apiKey ? '✅ Enabled' : '❌ Disabled (no API key)'}`);
    console.log(`   Database: ${dbConnected ? '✅ Connected' : '⚠️  Not connected (using file storage)'}`);
    console.log(`   WebSocket PTY: ws://localhost:${PORT}/api/pty`);
    console.log(`   Endpoints:`);
    console.log(`   - GET  /api/apps            - List discovered apps`);
    console.log(`   - GET  /api/config          - Get configuration`);
    console.log(`   - GET  /api/ports/check/:p  - Check port availability`);
    console.log(`   - GET  /api/terminal/sessions - List terminal sessions`);
    console.log(`   - POST /api/apps/:id/start  - Start an app`);
    console.log(`   - POST /api/apps/:id/stop   - Stop an app`);
    console.log(`   - GET  /api/events          - SSE for real-time updates`);
    console.log(`   - WS   /api/pty             - WebSocket for terminal`);

    // Set up graceful shutdown
    setupGracefulShutdown();
  });
}

startServer().catch(console.error);
