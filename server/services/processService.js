import { spawn } from 'child_process';
import path from 'path';
import { EventEmitter } from 'events';
import pidusage from 'pidusage';

// Store running processes
const processes = new Map();

// Event emitter for process events
export const processEvents = new EventEmitter();

// Allowlist of safe commands - prevents command injection
const ALLOWED_COMMANDS = [
  'npm',
  'npx',
  'yarn',
  'pnpm',
  'node',
  'bun',
];

// Allowlist of safe npm script patterns
const ALLOWED_SCRIPT_PATTERNS = [
  /^(run\s+)?(dev|start|serve|develop|preview|build|test)$/,
  /^start$/,
];

/**
 * Validate that a command is safe to execute
 */
function validateCommand(command) {
  const parts = command.trim().split(/\s+/);
  const baseCmd = parts[0];

  // Check if base command is in allowlist
  if (!ALLOWED_COMMANDS.includes(baseCmd)) {
    throw new Error(`Command '${baseCmd}' is not allowed. Allowed: ${ALLOWED_COMMANDS.join(', ')}`);
  }

  // For npm/yarn/pnpm, validate the script pattern
  if (['npm', 'yarn', 'pnpm'].includes(baseCmd)) {
    const scriptPart = parts.slice(1).join(' ');
    const isValid = ALLOWED_SCRIPT_PATTERNS.some(pattern => pattern.test(scriptPart));
    if (!isValid) {
      throw new Error(`Script '${scriptPart}' is not allowed. Use standard scripts like 'dev', 'start', 'serve'.`);
    }
  }

  // Check for dangerous characters that could enable injection
  const dangerousPatterns = [';', '&&', '||', '|', '`', '$', '>', '<', '\\n', '\\r'];
  for (const pattern of dangerousPatterns) {
    if (command.includes(pattern)) {
      throw new Error(`Command contains forbidden character: '${pattern}'`);
    }
  }

  return true;
}

/**
 * Get real CPU and memory usage for a process
 */
export async function getProcessStats(pid) {
  try {
    const stats = await pidusage(pid);
    return {
      cpu: stats.cpu,
      memory: stats.memory / 1024 / 1024, // Convert to MB
    };
  } catch {
    return { cpu: 0, memory: 0 };
  }
}

/**
 * Get process info by app ID
 */
export function getProcessInfo(appId) {
  return processes.get(appId);
}

/**
 * Get all running processes
 */
export function getAllProcesses() {
  const result = {};
  for (const [id, info] of processes) {
    result[id] = {
      pid: info.process?.pid,
      status: info.status,
      startTime: info.startTime,
      uptime: info.startTime ? Math.floor((Date.now() - info.startTime) / 1000) : 0,
    };
  }
  return result;
}

/**
 * Start a process for an app
 */
export function startProcess(appId, appPath, command) {
  // Validate command before execution (security check)
  validateCommand(command);

  // Check if already running
  if (processes.has(appId)) {
    const existing = processes.get(appId);
    if (existing.status === 'RUNNING') {
      throw new Error('Process is already running');
    }
  }

  // Parse command safely
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  // Set status to starting
  const processInfo = {
    appId,
    appPath,
    command,
    status: 'STARTING',
    startTime: null,
    logs: [],
    process: null,
  };
  processes.set(appId, processInfo);
  processEvents.emit('status', { appId, status: 'STARTING' });

  // Build PATH with local node_modules/.bin
  const localBinPath = path.join(appPath, 'node_modules', '.bin');
  const currentPath = process.env.PATH || '';
  const newPath = `${localBinPath}:${currentPath}`;

  // Spawn the process
  const childProcess = spawn(cmd, args, {
    cwd: appPath,
    shell: true,
    env: {
      ...process.env,
      PATH: newPath,
      FORCE_COLOR: '1',
    },
  });

  processInfo.process = childProcess;
  processInfo.startTime = Date.now();
  processInfo.status = 'RUNNING';

  // Handle stdout
  childProcess.stdout.on('data', (data) => {
    const log = data.toString().trim();
    if (log) {
      processInfo.logs.push({
        type: 'stdout',
        message: log,
        timestamp: new Date().toISOString(),
      });
      // Keep last 100 logs
      if (processInfo.logs.length > 100) {
        processInfo.logs = processInfo.logs.slice(-100);
      }
      processEvents.emit('log', { appId, type: 'stdout', message: log });
    }
  });

  // Handle stderr
  childProcess.stderr.on('data', (data) => {
    const log = data.toString().trim();
    if (log) {
      processInfo.logs.push({
        type: 'stderr',
        message: log,
        timestamp: new Date().toISOString(),
      });
      if (processInfo.logs.length > 100) {
        processInfo.logs = processInfo.logs.slice(-100);
      }
      processEvents.emit('log', { appId, type: 'stderr', message: log });
    }
  });

  // Handle process exit
  childProcess.on('exit', (code, signal) => {
    processInfo.status = code === 0 ? 'STOPPED' : 'ERROR';
    processInfo.exitCode = code;
    processInfo.exitSignal = signal;
    processEvents.emit('status', {
      appId,
      status: processInfo.status,
      exitCode: code,
      exitSignal: signal,
    });
  });

  // Handle process error
  childProcess.on('error', (error) => {
    processInfo.status = 'ERROR';
    processInfo.error = error.message;
    processInfo.logs.push({
      type: 'error',
      message: `Process error: ${error.message}`,
      timestamp: new Date().toISOString(),
    });
    processEvents.emit('status', { appId, status: 'ERROR', error: error.message });
  });

  processEvents.emit('status', { appId, status: 'RUNNING', pid: childProcess.pid });

  return {
    pid: childProcess.pid,
    status: 'RUNNING',
  };
}

/**
 * Stop a process
 */
export function stopProcess(appId) {
  const processInfo = processes.get(appId);

  if (!processInfo || !processInfo.process) {
    throw new Error('Process not found');
  }

  if (processInfo.status !== 'RUNNING') {
    throw new Error('Process is not running');
  }

  // Kill the process tree
  const pid = processInfo.process.pid;

  try {
    // On Unix, kill the process group
    process.kill(-pid, 'SIGTERM');
  } catch {
    // Fallback to killing just the process
    processInfo.process.kill('SIGTERM');
  }

  processInfo.status = 'STOPPED';
  processInfo.logs.push({
    type: 'system',
    message: '[SYSTEM] Process terminated',
    timestamp: new Date().toISOString(),
  });

  processEvents.emit('status', { appId, status: 'STOPPED' });

  return { status: 'STOPPED' };
}

/**
 * Restart a process
 */
export function restartProcess(appId) {
  const processInfo = processes.get(appId);

  if (!processInfo) {
    throw new Error('Process info not found');
  }

  const { appPath, command } = processInfo;

  // Stop if running
  if (processInfo.status === 'RUNNING') {
    stopProcess(appId);
  }

  // Wait a bit then start
  return new Promise((resolve) => {
    setTimeout(() => {
      const result = startProcess(appId, appPath, command);
      resolve(result);
    }, 1000);
  });
}

/**
 * Get logs for a process
 */
export function getProcessLogs(appId, limit = 50) {
  const processInfo = processes.get(appId);
  if (!processInfo) {
    return [];
  }
  return processInfo.logs.slice(-limit);
}

/**
 * Clean up all processes on shutdown
 */
export function cleanupAllProcesses() {
  for (const [appId] of processes) {
    try {
      stopProcess(appId);
    } catch {
      // Ignore errors during cleanup
    }
  }
}

// Cleanup on process exit
process.on('exit', cleanupAllProcesses);
process.on('SIGINT', () => {
  cleanupAllProcesses();
  process.exit();
});
process.on('SIGTERM', () => {
  cleanupAllProcesses();
  process.exit();
});
