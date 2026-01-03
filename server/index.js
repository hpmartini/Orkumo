import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
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
  processEvents,
} from './services/processService.js';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

const app = express();
const PORT = process.env.SERVER_PORT || 3001;

app.use(cors());
app.use(express.json());

// Validate API key on startup
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn('⚠️  GEMINI_API_KEY not found in .env.local - AI features will be disabled');
}

// Store connected SSE clients for real-time updates
const sseClients = new Set();

// ============================================
// SSE Endpoint for real-time updates
// ============================================

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Broadcast events to all connected clients
function broadcast(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(message);
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
app.post('/api/config/directories', (req, res) => {
  try {
    const { path } = req.body;
    if (!path) {
      return res.status(400).json({ error: 'Path is required' });
    }
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
app.delete('/api/config/directories', (req, res) => {
  try {
    const { path } = req.body;
    if (!path) {
      return res.status(400).json({ error: 'Path is required' });
    }
    const config = removeDirectory(path);
    res.json(config);
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
app.post('/api/apps/:id/start', (req, res) => {
  try {
    const { id } = req.params;
    const { path: appPath, command } = req.body;

    if (!appPath || !command) {
      return res.status(400).json({ error: 'path and command are required' });
    }

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
app.post('/api/apps/:id/stop', (req, res) => {
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
app.post('/api/apps/:id/restart', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await restartProcess(id);
    res.json(result);
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
