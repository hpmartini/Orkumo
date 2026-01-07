#!/usr/bin/env node
/**
 * PTY Host Service - Runs on the HOST machine to spawn shells
 * This service must run on the host, not inside Docker
 * The Docker container proxies WebSocket connections to this service
 */

import { WebSocketServer } from 'ws';
import * as pty from 'node-pty';
import os from 'os';
import fs from 'fs';

const PORT = process.env.PTY_HOST_PORT || 3098;

// Detect user's default shell
const defaultShell = (() => {
  if (os.platform() === 'win32') {
    return 'powershell.exe';
  }
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

  console.log(`[PTY-Host] New connection: ${sessionId}, cwd: ${cwd}`);

  // Validate CWD exists
  let workingDir = cwd;
  if (!fs.existsSync(workingDir)) {
    console.warn(`[PTY-Host] CWD ${workingDir} doesn't exist, using HOME`);
    workingDir = process.env.HOME || '/tmp';
  }

  try {
    const shellArgs = defaultShell.includes('zsh') || defaultShell.includes('bash') ? ['--login'] : [];

    const ptyProcess = pty.spawn(defaultShell, shellArgs, {
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
    ws.send(JSON.stringify({
      type: 'connected',
      shell: defaultShell,
      pid: ptyProcess.pid,
      cwd: workingDir,
    }));

    // Handle PTY output
    ptyProcess.onData((data) => {
      if (ws.readyState === 1) { // WebSocket.OPEN
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

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[PTY-Host] Shutting down...');
  for (const [id, session] of sessions) {
    try {
      session.pty.kill();
    } catch {
      // Ignore
    }
  }
  wss.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.emit('SIGINT');
});
