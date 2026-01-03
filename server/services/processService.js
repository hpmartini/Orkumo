import { spawn } from 'child_process';
import path from 'path';
import { EventEmitter } from 'events';

// Store running processes
const processes = new Map();

// Event emitter for process events
export const processEvents = new EventEmitter();

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
  // Check if already running
  if (processes.has(appId)) {
    const existing = processes.get(appId);
    if (existing.status === 'RUNNING') {
      throw new Error('Process is already running');
    }
  }

  // Parse command
  const parts = command.split(' ');
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

  // Spawn the process
  const childProcess = spawn(cmd, args, {
    cwd: appPath,
    shell: true,
    env: { ...process.env, FORCE_COLOR: '1' },
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
