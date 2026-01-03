import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { GoogleGenAI, Type } from '@google/genai';
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

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

const app = express();
const PORT = process.env.SERVER_PORT || 3001;

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
    const { path: appPath, command } = req.body;

    const result = startProcess(id, appPath, command);
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

    const prompt = `
      You are a DevOps expert. Analyze the following configuration file content (e.g., package.json or README) for a web application.
      Filename: ${fileName}
      Content:
      ${fileContent.substring(0, 3000)}

      Determine the best command to run this application in development mode, the likely port it will use, and the project type.
      Return a JSON object with keys: command (string), port (number), type (string enum: vite, next, node, static, unknown), and summary (string, short description).
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            command: { type: Type.STRING },
            port: { type: Type.NUMBER },
            type: { type: Type.STRING },
            summary: { type: Type.STRING },
          },
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error('No response from AI');
    }

    const parsed = JSON.parse(text);
    if (!parsed.command || typeof parsed.port !== 'number' || !parsed.type || !parsed.summary) {
      throw new Error('Invalid response structure from AI');
    }

    res.json(parsed);
  } catch (error) {
    console.error('Gemini analysis failed:', error);
    res.json({
      command: 'npm run dev',
      port: 3000,
      type: 'unknown',
      summary: 'Analysis failed. Defaulting to standard configuration.'
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
    timestamp: new Date().toISOString()
  });
});

// ============================================
// Start Server
// ============================================

app.listen(PORT, () => {
  console.log(`🚀 DevOrbit API Server running on http://localhost:${PORT}`);
  console.log(`   AI Features: ${apiKey ? '✅ Enabled' : '❌ Disabled (no API key)'}`);
  console.log(`   Endpoints:`);
  console.log(`   - GET  /api/apps         - List discovered apps`);
  console.log(`   - GET  /api/config       - Get configuration`);
  console.log(`   - PUT  /api/config       - Update configuration`);
  console.log(`   - POST /api/apps/:id/start  - Start an app`);
  console.log(`   - POST /api/apps/:id/stop   - Stop an app`);
  console.log(`   - GET  /api/events       - SSE for real-time updates`);
});
