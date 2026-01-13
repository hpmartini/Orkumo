/**
 * PTY Service - Manages pseudo-terminal sessions for real terminal emulation
 */
import * as pty from 'node-pty';
import os from 'os';
import fs from 'fs';
import { EventEmitter } from 'events';
import { exec } from 'child_process';

// Store active PTY sessions
const ptySessions = new Map();

// Event emitter for PTY events
export const ptyEvents = new EventEmitter();

/**
 * Detect the best available shell - called lazily to ensure env is fully set up
 * @returns {string} Path to shell binary
 */
function detectShell() {
  if (os.platform() === 'win32') {
    return 'powershell.exe';
  }

  // List of shells to try in order of preference
  const shellCandidates = [
    process.env.SHELL,  // User's configured shell
    '/bin/zsh',
    '/bin/bash',
    '/bin/ash',
    '/bin/sh',
  ].filter(Boolean);

  for (const shell of shellCandidates) {
    if (shell && fs.existsSync(shell)) {
      try {
        // Verify shell is executable
        fs.accessSync(shell, fs.constants.X_OK);
        return shell;
      } catch {
        // Shell exists but not executable, try next
        continue;
      }
    }
  }

  // Last resort - sh should always exist
  return '/bin/sh';
}

// Detect shell on startup for logging
const defaultShell = detectShell();
console.log(`[PTY] Service initialized with default shell: ${defaultShell}`);

/**
 * Create a new PTY session
 * @param {string} sessionId - Unique identifier for the session
 * @param {string} cwd - Working directory for the terminal
 * @param {number} cols - Terminal columns
 * @param {number} rows - Terminal rows
 * @param {object} options - Additional options
 * @param {string} options.command - Custom command to run (defaults to shell)
 * @param {string[]} options.args - Command arguments
 * @param {object} options.env - Additional environment variables
 * @returns {object} Session info
 */
export function createPtySession(sessionId, cwd = process.env.HOME, cols = 80, rows = 24, options = {}) {
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

  // Use custom command or default shell
  const command = options.command || defaultShell;
  const isCustomCommand = !!options.command;

  // Prepare command arguments
  let commandArgs = options.args || [];
  if (!isCustomCommand) {
    // Use -l for login shell to ensure proper initialization (zsh and bash)
    commandArgs = command.includes('zsh') || command.includes('bash') ? ['--login'] : [];
  }

  console.log(`[PTY] Creating session with command: ${command}, args: ${JSON.stringify(commandArgs)}, cwd: ${workingDir}`);

  try {
    // Re-detect shell at spawn time to ensure we use the best available
    const shellToUse = isCustomCommand ? command : detectShell();

    // Build a clean environment for the PTY
    // Ensure PATH includes common binary locations
    const homeDir = process.env.HOME || '/root';
    const basePaths = [
      `${homeDir}/.nvm/versions/node`,  // Will be expanded below
      `${homeDir}/.bun/bin`,
      `${homeDir}/.local/bin`,
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ];

    // Add NVM paths if they exist
    const nvmPaths = [];
    try {
      const nvmNodeDir = `${homeDir}/.nvm/versions/node`;
      if (fs.existsSync(nvmNodeDir)) {
        const versions = fs.readdirSync(nvmNodeDir).filter(v => v.startsWith('v'));
        versions.sort().reverse().forEach(v => {
          const binPath = `${nvmNodeDir}/${v}/bin`;
          if (fs.existsSync(binPath)) {
            nvmPaths.push(binPath);
          }
        });
      }
    } catch {
      // Ignore NVM detection errors
    }

    // Build enhanced PATH - NVM first, then base paths, then existing PATH
    const existingPath = process.env.PATH || '';
    const enhancedPath = [...nvmPaths, ...basePaths.filter(p => fs.existsSync(p)), existingPath]
      .filter(Boolean)
      .join(':');

    const ptyEnv = {
      ...process.env,
      ...options.env,
      PATH: enhancedPath,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      HOME: homeDir,
      USER: process.env.USER || 'root',
      SHELL: shellToUse,
      // Ensure these are set for proper shell initialization
      LANG: process.env.LANG || 'en_US.UTF-8',
      LC_ALL: process.env.LC_ALL || process.env.LANG || 'en_US.UTF-8',
    };

    console.log(`[PTY] Spawning shell: ${shellToUse}, cwd: ${workingDir}`);

    const ptyProcess = pty.spawn(shellToUse, commandArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: workingDir,
      env: ptyEnv,
    });

    const session = {
      id: sessionId,
      pty: ptyProcess,
      cwd: workingDir,
      shell: shellToUse,
      type: isCustomCommand ? 'custom' : 'shell',
      commandInfo: isCustomCommand ? { command, args: commandArgs } : null,
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
      shell: shellToUse,
      type: session.type,
    };
  } catch (error) {
    console.error(`[PTY] Failed to create session ${sessionId}:`, error);
    console.error(`[PTY] Shell: ${command}, CWD: ${workingDir}`);
    console.error(`[PTY] PATH: ${process.env.PATH?.substring(0, 200)}...`);

    // Try to provide more helpful error message
    let errorMessage = error.message;
    if (errorMessage.includes('posix_spawnp') || errorMessage.includes('spawn')) {
      errorMessage = `Failed to start shell (${command}). ` +
        `The shell may not exist or may not be executable. ` +
        `Try restarting the application.`;
    }

    return {
      success: false,
      error: errorMessage,
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

/**
 * Check if Claude Code CLI is installed
 * @returns {Promise<{installed: boolean, path?: string, version?: string, error?: string}>}
 */
export function detectClaudeCLI() {
  return new Promise((resolve) => {
    let isResolved = false;
    let currentProcess = null;

    // Common installation locations for Claude CLI
    const home = process.env.HOME || '/root';
    const commonPaths = [
      `${home}/.bun/bin/claude`,
      `${home}/.claude/local/claude`,
      `${home}/.local/bin/claude`,
      '/usr/local/bin/claude',
      '/usr/bin/claude',
    ];

    // Set overall timeout with process cleanup
    const timeout = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        if (currentProcess) {
          try {
            currentProcess.kill('SIGTERM');
          } catch (e) {
            // Process may have already exited
          }
        }
        resolve({ installed: false, error: 'Detection timeout' });
      }
    }, 5000);

    const resolveWith = (result) => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timeout);
      if (currentProcess) {
        try {
          currentProcess.kill('SIGTERM');
        } catch (e) {
          // Process may have already exited
        }
      }
      resolve(result);
    };

    // First, check common installation paths directly (faster and more reliable)
    for (const claudePath of commonPaths) {
      if (fs.existsSync(claudePath)) {
        // Found it! Try to get version
        currentProcess = exec(`"${claudePath}" --version`, { timeout: 5000 }, (vError, vStdout) => {
          resolveWith({
            installed: true,
            path: claudePath,
            version: vError ? 'unknown' : vStdout.trim(),
          });
        });
        return;
      }
    }

    // If not found in common paths, try 'which claude' with extended PATH
    const extendedPath = [
      `${home}/.bun/bin`,
      `${home}/.claude/local`,
      `${home}/.local/bin`,
      '/usr/local/bin',
      process.env.PATH || '',
    ].join(':');

    currentProcess = exec('which claude', { timeout: 5000, env: { ...process.env, PATH: extendedPath } }, (error, stdout) => {
      if (isResolved) return;

      if (error) {
        resolveWith({ installed: false });
        return;
      }

      const foundPath = stdout.trim();

      // Get version
      currentProcess = exec(`"${foundPath}" --version`, { timeout: 5000 }, (vError, vStdout) => {
        resolveWith({
          installed: true,
          path: foundPath,
          version: vError ? 'unknown' : vStdout.trim(),
        });
      });
    });
  });
}

// Cleanup on process exit
process.on('exit', () => {
  for (const [sessionId] of ptySessions) {
    killPtySession(sessionId);
  }
});
