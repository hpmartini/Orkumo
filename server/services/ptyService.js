/**
 * PTY Service - Manages pseudo-terminal sessions for real terminal emulation.
 *
 * Shells run as PTYs of this process and end with it. Agent PTYs run in a holder process each
 * (`heldPty.js`), so closing their pane, reloading the page, restarting the server or quitting
 * Electron only detaches them.
 */
import * as pty from 'node-pty';
import fs from 'fs';
import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { ptyBaseEnv } from '../../config/ptyEnv.js';
import { connectHeldPty, heldPtySockets, removeStaleSocket, spawnHeldPty } from './heldPty.js';

// Store active PTY sessions
const ptySessions = new Map();
/** Output kept per agent PTY, replayed to a client that reattaches */
const BACKLOG_CHARS = 512 * 1024;

// Event emitter for PTY events
export const ptyEvents = new EventEmitter();

/**
 * Detect the best available shell - called lazily to ensure env is fully set up
 * @returns {string} Path to shell binary
 */
function detectShell() {
  // List of shells to try in order of preference
  const shellCandidates = [
    process.env.SHELL, // User's configured shell
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
 * What a PTY runs: `options.command` or the login shell, in `cwd` (a missing one falls back to
 * /tmp or $HOME), with an env for an interactive xterm.js color terminal.
 */
function spawnSpec(cwd, options = {}) {
  let workingDir = cwd;
  if (!fs.existsSync(workingDir)) {
    console.warn(`[PTY] CWD ${workingDir} doesn't exist, using fallback`);
    workingDir = fs.existsSync('/tmp') ? '/tmp' : process.env.HOME || '/';
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

  console.log(
    `[PTY] Creating session with command: ${command}, args: ${JSON.stringify(commandArgs)}, cwd: ${workingDir}`
  );

  // Re-detect shell at spawn time to ensure we use the best available
  // CLAUDE_CLI_PATH pins the binary, like agentService.resolveClaudeBinary (review stubs, #236)
  const shellToUse = !isCustomCommand
    ? detectShell()
    : command === 'claude' && process.env.CLAUDE_CLI_PATH
      ? process.env.CLAUDE_CLI_PATH
      : command;

  // Build a clean environment for the PTY
  // Ensure PATH includes common binary locations
  const homeDir = process.env.HOME || '/root';
  const basePaths = [
    `${homeDir}/.nvm/versions/node`, // Will be expanded below
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
      const versions = fs.readdirSync(nvmNodeDir).filter((v) => v.startsWith('v'));
      versions
        .sort()
        .reverse()
        .forEach((v) => {
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
  const enhancedPath = [...nvmPaths, ...basePaths.filter((p) => fs.existsSync(p)), existingPath]
    .filter(Boolean)
    .join(':');

  // The launcher's terminal identity and color opt-outs stay out (config/ptyEnv.js); a PTY is
  // an interactive xterm.js color terminal (TERM/COLORTERM below); options.env may still set them.
  const ptyEnv = {
    ...ptyBaseEnv(),
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
  return {
    command,
    file: shellToUse,
    args: commandArgs,
    cwd: workingDir,
    env: ptyEnv,
    type: isCustomCommand ? 'custom' : 'shell',
  };
}

function spawnErrorMessage(command, error) {
  if (!error.message.includes('posix_spawnp') && !error.message.includes('spawn'))
    return error.message;
  // posix_spawnp also fails when node-pty's own `spawn-helper` lost its
  // executable bit during bun install - in that case *every* terminal
  // fails, not just this command, so point at the repair step.
  return (
    `Failed to start shell (${command}). ` +
    `The command may not exist on PATH, or node-pty's spawn-helper is not executable. ` +
    `If no terminal works at all, run "bun run postinstall" to repair it.`
  );
}

/** Registers `session` (its `pty` local or held) and relays its output and exit as ptyEvents */
function addSession(session) {
  const { id: sessionId, pty: ptyProcess } = session;
  // A reconnect reuses the sessionId and replaces this PTY; a replaced PTY must not
  // talk to (or unregister) its successor, or the new terminal shows output but drops input.
  const isCurrent = () => ptySessions.get(sessionId) === session;

  ptyProcess.onData((data) => {
    if (!isCurrent()) return;
    if (session.held) {
      session.backlog += data;
      if (session.backlog.length > BACKLOG_CHARS)
        session.backlog = session.backlog.slice(-BACKLOG_CHARS);
    }
    ptyEvents.emit('data', { sessionId, data });
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    if (!isCurrent()) return;
    ptyEvents.emit('exit', { sessionId, exitCode, signal });
    ptySessions.delete(sessionId);
  });

  ptySessions.set(sessionId, session);
}

/**
 * Create a PTY session of this process (shells, `claude attach`): it ends with the server
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
export function createPtySession(
  sessionId,
  cwd = process.env.HOME,
  cols = 80,
  rows = 24,
  options = {}
) {
  // Kill existing session if any
  if (ptySessions.has(sessionId)) {
    killPtySession(sessionId);
  }

  try {
    const spec = spawnSpec(cwd, options);
    const ptyProcess = pty.spawn(spec.file, spec.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: spec.cwd,
      env: spec.env,
    });
    addSession({
      id: sessionId,
      pty: ptyProcess,
      cwd: spec.cwd,
      shell: spec.file,
      type: spec.type,
      createdAt: Date.now(),
      held: false,
    });
    return {
      success: true,
      sessionId,
      pid: ptyProcess.pid,
      shell: spec.file,
      type: spec.type,
    };
  } catch (error) {
    console.error(`[PTY] Failed to create session ${sessionId}:`, error);
    console.error(`[PTY] PATH: ${process.env.PATH?.substring(0, 200)}...`);
    return { success: false, error: spawnErrorMessage(options.command || defaultShell, error) };
  }
}

/** A held agent PTY as a session (`hello`: what its holder reported) */
function addHeldSession(held) {
  const { hello } = held;
  addSession({
    id: hello.id,
    pty: held,
    cwd: hello.cwd,
    shell: hello.file,
    type: 'custom',
    createdAt: hello.createdAt,
    held: true,
    backlog: hello.backlog,
    cols: hello.cols,
    rows: hello.rows,
  });
  held.start();
}

async function startHeldSession(sessionId, cwd, cols, rows, options) {
  try {
    const spec = spawnSpec(cwd, options);
    const held = await spawnHeldPty({
      id: sessionId,
      file: spec.file,
      args: spec.args,
      cwd: spec.cwd,
      cols,
      rows,
      env: spec.env,
    });
    addHeldSession(held);
    return {
      success: true,
      reattached: false,
      sessionId,
      pid: held.pid,
      shell: spec.file,
      type: spec.type,
      cwd: spec.cwd,
    };
  } catch (error) {
    console.error(`[PTY] Failed to start agent ${sessionId}:`, error);
    return { success: false, error: spawnErrorMessage(options.command, error) };
  }
}

const paneIdOf = (sessionId) => /^agent-(.+)-\d+$/.exec(sessionId)?.[1] ?? null;

/** The running agent PTY of pane `paneId` (PTY ids are `agent-<pane>-<ts>`), null when none runs */
function runningPanePty(paneId) {
  let found = null;
  for (const session of ptySessions.values()) {
    if (!session.held || paneIdOf(session.id) !== paneId) continue;
    if (!found || session.createdAt > found.createdAt) found = session;
  }
  return (
    found && {
      sessionId: found.id,
      pid: found.pty.pid,
      cwd: found.cwd,
      shell: found.shell,
      type: found.type,
      cols: found.cols,
      rows: found.rows,
      backlog: found.backlog,
    }
  );
}

/** Agent panes whose PTY is starting: a second socket for the pane waits for it */
const startingPanes = new Map();

/**
 * Opens the PTY of an agent pane (`sessionId` = `agent-<pane>-<ts>`): reattaches to the one still
 * running for the pane (it was closed, the page or the server reloaded), else starts the agent in
 * a holder process, so it outlives pane and server. Concurrent calls for a pane share one start.
 * @returns {Promise<object>} `{ success, reattached, sessionId, pid, shell, type, cwd, backlog?, cols?, rows? }`
 *   or `{ success: false, error }`
 */
export async function openAgentPty(sessionId, cwd, cols, rows, options) {
  const paneId = paneIdOf(sessionId);
  if (!paneId) return startHeldSession(sessionId, cwd, cols, rows, options);
  while (startingPanes.has(paneId)) await startingPanes.get(paneId);
  // no await from here until the start is registered
  const running = runningPanePty(paneId);
  if (running) return { success: true, reattached: true, ...running };
  const start = startHeldSession(sessionId, cwd, cols, rows, options);
  startingPanes.set(paneId, start);
  try {
    return await start;
  } finally {
    startingPanes.delete(paneId);
  }
}

/** Reconnects to the agents whose holders outlived the previous server; await before serving */
export async function restoreHeldPtys() {
  await Promise.all(
    heldPtySockets().map(async (socketPath) => {
      try {
        const held = await connectHeldPty(socketPath);
        addHeldSession(held);
        console.log(`[PTY] Reconnected agent ${held.hello.id} (pid ${held.pid})`);
      } catch (error) {
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') removeStaleSocket(socketPath);
        else console.warn(`[PTY] Agent holder ${socketPath} not reachable:`, error.message);
      }
    })
  );
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
    session.cols = cols;
    session.rows = rows;
    return true;
  }
  return false;
}

/** Ends every PTY of agent pane `paneId` (Stop on a detached agent); returns how many */
export function killPanePtys(paneId) {
  let killed = 0;
  for (const id of [...ptySessions.keys()]) {
    if (paneIdOf(id) === paneId && killPtySession(id)) killed += 1;
  }
  return killed;
}

/**
 * Types `text` into the running agent of pane `paneId` and submits it, like a paste into its
 * terminal: bracketed paste keeps a multi-line message one message, Enter follows separately
 * (a TUI treats an Enter in the same chunk as part of the paste). false when no agent runs there.
 */
export function typeIntoPanePty(paneId, text) {
  const running = runningPanePty(paneId);
  if (!running) return false;
  writeToPty(running.sessionId, `\x1b[200~${text}\x1b[201~`);
  setTimeout(() => writeToPty(running.sessionId, '\r'), 80);
  return true;
}

/**
 * Kill a PTY session
 * @param {string} sessionId - Session identifier
 * @param {number} [pid] - Only kill if the session still runs this PTY (a reconnect may have replaced it)
 */
export function killPtySession(sessionId, pid) {
  const session = ptySessions.get(sessionId);
  if (session && session.pty && (pid === undefined || session.pty.pid === pid)) {
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

    currentProcess = exec(
      'which claude',
      { timeout: 5000, env: { ...process.env, PATH: extendedPath } },
      (error, stdout) => {
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
      }
    );
  });
}

// Shells end with the server; held agents keep running in their holders
process.on('exit', () => {
  for (const [sessionId, session] of ptySessions) {
    if (!session.held) killPtySession(sessionId);
  }
});
