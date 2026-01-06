/**
 * PTY Service - Manages pseudo-terminal sessions for real terminal emulation
 */
import * as pty from 'node-pty';
import os from 'os';
import fs from 'fs';
import { EventEmitter } from 'events';

// Store active PTY sessions
const ptySessions = new Map();

// Event emitter for PTY events
export const ptyEvents = new EventEmitter();

// Default shell based on platform - uses user's configured shell from environment
// Cached at module load time to ensure consistent shell across all sessions
const defaultShell = (() => {
  if (os.platform() === 'win32') {
    return 'powershell.exe';
  }

  // Use the user's configured shell from environment variable
  const userShell = process.env.SHELL;
  if (userShell && fs.existsSync(userShell)) {
    console.log(`[PTY] Using user's default shell: ${userShell}`);
    return userShell;
  }

  // Fallback for Docker/containers where SHELL may not be set
  const fallbackShells = ['/bin/zsh', '/bin/bash', '/bin/ash', '/bin/sh'];
  for (const shell of fallbackShells) {
    if (fs.existsSync(shell)) {
      console.log(`[PTY] SHELL env not set, using fallback: ${shell}`);
      return shell;
    }
  }

  return '/bin/sh';
})();

console.log(`[PTY] Service initialized with default shell: ${defaultShell}`);

/**
 * Create a new PTY session
 * @param {string} sessionId - Unique identifier for the session
 * @param {string} cwd - Working directory for the terminal
 * @param {number} cols - Terminal columns
 * @param {number} rows - Terminal rows
 * @returns {object} Session info
 */
export function createPtySession(sessionId, cwd = process.env.HOME, cols = 80, rows = 24) {
  // Kill existing session if any
  if (ptySessions.has(sessionId)) {
    killPtySession(sessionId);
  }

  // Validate CWD exists, fallback to /tmp or HOME
  let workingDir = cwd;
  if (!fs.existsSync(workingDir)) {
    console.warn(`[PTY] CWD ${workingDir} doesn't exist, using fallback`);
    workingDir = fs.existsSync('/tmp') ? '/tmp' : (process.env.HOME || '/');
  }

  const shell = defaultShell;
  console.log(`[PTY] Creating session with shell: ${shell}, cwd: ${workingDir}`);

  try {
    // Use -l for login shell to ensure proper initialization (zsh and bash)
    const shellArgs = shell.includes('zsh') || shell.includes('bash') ? ['--login'] : [];

    const ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: workingDir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        HOME: process.env.HOME || '/root',
        USER: process.env.USER || 'root',
        SHELL: shell,
      },
    });

    const session = {
      id: sessionId,
      pty: ptyProcess,
      cwd,
      shell,
      createdAt: Date.now(),
    };

    // Handle PTY output
    ptyProcess.onData((data) => {
      ptyEvents.emit('data', { sessionId, data });
    });

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode, signal }) => {
      ptyEvents.emit('exit', { sessionId, exitCode, signal });
      ptySessions.delete(sessionId);
    });

    ptySessions.set(sessionId, session);

    return {
      success: true,
      sessionId,
      pid: ptyProcess.pid,
      shell,
    };
  } catch (error) {
    console.error(`Failed to create PTY session ${sessionId}:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Write data to a PTY session
 * @param {string} sessionId - Session identifier
 * @param {string} data - Data to write
 */
export function writeToPty(sessionId, data) {
  const session = ptySessions.get(sessionId);
  if (session && session.pty) {
    session.pty.write(data);
    return true;
  }
  return false;
}

/**
 * Resize a PTY session
 * @param {string} sessionId - Session identifier
 * @param {number} cols - New column count
 * @param {number} rows - New row count
 */
export function resizePty(sessionId, cols, rows) {
  const session = ptySessions.get(sessionId);
  if (session && session.pty) {
    session.pty.resize(cols, rows);
    return true;
  }
  return false;
}

/**
 * Kill a PTY session
 * @param {string} sessionId - Session identifier
 */
export function killPtySession(sessionId) {
  const session = ptySessions.get(sessionId);
  if (session && session.pty) {
    try {
      session.pty.kill();
    } catch {
      // Already dead
    }
    ptySessions.delete(sessionId);
    return true;
  }
  return false;
}

/**
 * Get all active PTY sessions
 * @returns {Array} Active session info
 */
export function getAllPtySessions() {
  return Array.from(ptySessions.entries()).map(([id, session]) => ({
    id,
    cwd: session.cwd,
    pid: session.pty?.pid,
    createdAt: session.createdAt,
  }));
}

/**
 * Check if a PTY session exists
 * @param {string} sessionId - Session identifier
 * @returns {boolean}
 */
export function hasPtySession(sessionId) {
  return ptySessions.has(sessionId);
}

// Cleanup on process exit
process.on('exit', () => {
  for (const [sessionId] of ptySessions) {
    killPtySession(sessionId);
  }
});
