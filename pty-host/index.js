#!/usr/bin/env node
/**
 * PTY Host Service - Runs on the HOST machine to spawn shells
 * This service must run on the host, not inside Docker
 * The Docker container proxies WebSocket connections to this service
 *
 * Also exposes a small HTTP /exec endpoint so the API container can run
 * non-interactive commands (like `claude agents --json`) on the host, since
 * the API runs in a Linux container that cannot execute the macOS-only
 * Claude Code binary directly.
 */

import { WebSocketServer } from 'ws';
import * as pty from 'node-pty';
import http from 'http';
import { execFile as execFileCb } from 'child_process';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';

const PORT = process.env.PTY_HOST_PORT || 3098;
const HTTP_PORT = process.env.PTY_HOST_HTTP_PORT || 3099;
const HTTP_TOKEN = process.env.PTY_HOST_HTTP_TOKEN || '';

// Detect user's default shell
const defaultShell = (() => {
  const userShell = process.env.SHELL;
  if (userShell && fs.existsSync(userShell)) {
    return userShell;
  }
  const fallbackShells = ['/bin/zsh', '/bin/bash', '/bin/sh'];
  for (const shell of fallbackShells) {
    if (fs.existsSync(shell)) {
      return shell;
    }
  }
  return '/bin/sh';
})();

console.log(`[PTY-Host] Starting on port ${PORT}`);
console.log(`[PTY-Host] Default shell: ${defaultShell}`);
console.log(`[PTY-Host] Platform: ${os.platform()}`);
console.log(`[PTY-Host] User: ${process.env.USER || 'unknown'}`);

const wss = new WebSocketServer({ port: PORT });

// Store active PTY sessions
const sessions = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const sessionId = url.searchParams.get('sessionId') || `session-${Date.now()}`;
  const cwd = url.searchParams.get('cwd') || process.env.HOME || '/tmp';
  const cols = parseInt(url.searchParams.get('cols') || '80', 10);
  const rows = parseInt(url.searchParams.get('rows') || '24', 10);

  // Optional custom command (e.g. "claude") + args (e.g. ["attach", "84f4be24"])
  // forwarded by the API when proxying in Docker mode. Defaults to a login shell.
  const customCommand = url.searchParams.get('command');
  let customArgs = [];
  const argsParam = url.searchParams.get('args');
  if (argsParam) {
    try {
      const parsed = JSON.parse(argsParam);
      if (Array.isArray(parsed) && parsed.every((a) => typeof a === 'string')) {
        customArgs = parsed;
      }
    } catch {
      // ignore malformed args, fall back to default shell
    }
  }

  console.log(
    `[PTY-Host] New connection: ${sessionId}, cwd=${cwd}, command=${customCommand || defaultShell}${customArgs.length ? ` args=${JSON.stringify(customArgs)}` : ''}`
  );

  // Validate CWD exists
  let workingDir = cwd;
  if (!fs.existsSync(workingDir)) {
    console.warn(`[PTY-Host] CWD ${workingDir} doesn't exist, using HOME`);
    workingDir = process.env.HOME || '/tmp';
  }

  try {
    let spawnBin;
    let spawnArgs;
    let spawnedShell;

    if (customCommand) {
      // Resolve absolute path so things like `~/.local/bin/claude` work even
      // when the API caller's PATH doesn't include them.
      spawnBin = resolveBinary(customCommand) || customCommand;
      spawnArgs = customArgs;
      spawnedShell = customCommand;
    } else {
      spawnedShell = defaultShell;
      spawnBin = defaultShell;
      spawnArgs = defaultShell.includes('zsh') || defaultShell.includes('bash') ? ['--login'] : [];
    }

    const ptyProcess = pty.spawn(spawnBin, spawnArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: workingDir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });

    sessions.set(sessionId, { pty: ptyProcess, ws });

    // Send connection success
    ws.send(
      JSON.stringify({
        type: 'connected',
        shell: spawnedShell,
        pid: ptyProcess.pid,
        cwd: workingDir,
      })
    );

    // Handle PTY output
    ptyProcess.onData((data) => {
      if (ws.readyState === 1) {
        // WebSocket.OPEN
        ws.send(JSON.stringify({ type: 'output', data }));
      }
    });

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode, signal }) => {
      console.log(`[PTY-Host] Session ${sessionId} exited: code=${exitCode}, signal=${signal}`);
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'exit', exitCode, signal }));
      }
      sessions.delete(sessionId);
    });

    // Handle incoming messages
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        switch (data.type) {
          case 'input':
            ptyProcess.write(data.data);
            break;
          case 'resize':
            if (data.cols && data.rows) {
              ptyProcess.resize(data.cols, data.rows);
            }
            break;
        }
      } catch (err) {
        // Raw input fallback
        ptyProcess.write(message.toString());
      }
    });

    // Handle WebSocket close
    ws.on('close', () => {
      console.log(`[PTY-Host] Connection closed: ${sessionId}`);
      try {
        ptyProcess.kill();
      } catch {
        // Already dead
      }
      sessions.delete(sessionId);
    });

    ws.on('error', (err) => {
      console.error(`[PTY-Host] WebSocket error: ${err.message}`);
    });
  } catch (error) {
    console.error(`[PTY-Host] Failed to create PTY: ${error.message}`);
    ws.send(JSON.stringify({ type: 'error', message: error.message }));
    ws.close();
  }
});

wss.on('listening', () => {
  console.log(`[PTY-Host] WebSocket server listening on ws://localhost:${PORT}`);
});

// ---------------------------------------------------------------------------
// HTTP /exec endpoint - lets the API container run commands on the host
// ---------------------------------------------------------------------------

const execFileAsync = (bin, args, options) =>
  new Promise((resolve) => {
    execFileCb(
      bin,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeout,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, ...(options.env || {}) },
      },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || '') + (error && error.killed ? '\n(timed out)' : ''),
        });
      }
    );
  });

/**
 * Resolve a binary by name the same way `resolveClaudeBinary` does on the
 * server side, so the host can find `claude` installed under ~/.local/bin
 * even when the caller's PATH is not loaded.
 */
function resolveBinary(name) {
  const home = process.env.HOME || os.homedir();
  const candidates = [
    process.env.CLAUDE_CLI_PATH,
    `${home}/.bun/bin/${name}`,
    `${home}/.local/bin/${name}`,
    '/opt/homebrew/bin/' + name,
    '/usr/local/bin/' + name,
    '/usr/bin/' + name,
  ].filter(Boolean);
  const pathDirs = (process.env.PATH || '').split(':').filter(Boolean);
  for (const dir of pathDirs) candidates.push(`${dir}/${name}`);
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

const httpServer = http.createServer(async (req, res) => {
  // CORS for browser-side tooling during local development
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Pty-Host-Token');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'pty-host' }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/exec') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  if (HTTP_TOKEN) {
    const provided = req.headers['x-pty-host-token'];
    const expected = `Bearer ${HTTP_TOKEN}`;
    if (
      typeof provided !== 'string' ||
      !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    ) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
  }

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 256 * 1024) {
      req.destroy();
    }
  });
  req.on('end', async () => {
    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const { command, args = [], cwd, timeout = 60000, env } = body || {};
    if (typeof command !== 'string' || !command.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing `command` string' }));
      return;
    }
    if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '`args` must be a string array' }));
      return;
    }

    const bin = resolveBinary(command) || command;
    const resolvedCwd =
      typeof cwd === 'string' && cwd.trim() && fs.existsSync(cwd) ? cwd : process.env.HOME || os.homedir();

    const result = await execFileAsync(bin, args, {
      cwd: resolvedCwd,
      timeout,
      env,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  });
  req.on('error', () => {
    // client disconnected
  });
});

httpServer.listen(HTTP_PORT, () => {
  const auth = HTTP_TOKEN ? ' (token-protected)' : ' (no token, localhost only)';
  console.log(`[PTY-Host] HTTP /exec listening on http://localhost:${HTTP_PORT}${auth}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[PTY-Host] Shutting down...');
  for (const session of sessions.values()) {
    try {
      session.pty.kill();
    } catch {
      // Ignore
    }
  }
  wss.close();
  httpServer.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.emit('SIGINT');
});
