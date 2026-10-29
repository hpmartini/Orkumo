import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

/**
 * Health Service
 * Provides system and project health checks
 */

// Cache for version checks (1 hour TTL)
let versionCache = null;
let versionCacheTime = 0;
const VERSION_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Get Node.js version info
 */
async function getNodeVersion() {
  try {
    const { stdout } = await execFileAsync('node', ['--version']);
    return {
      installed: true,
      version: stdout.trim().replace('v', ''),
    };
  } catch {
    return { installed: false, version: null };
  }
}

/**
 * Get npm version info
 */
async function getNpmVersion() {
  try {
    const { stdout } = await execFileAsync('npm', ['--version']);
    return {
      installed: true,
      version: stdout.trim(),
    };
  } catch {
    return { installed: false, version: null };
  }
}

/**
 * Get Git version info
 */
async function getGitVersion() {
  try {
    const { stdout } = await execFileAsync('git', ['--version']);
    const match = stdout.match(/git version (\d+\.\d+\.\d+)/);
    return {
      installed: true,
      version: match ? match[1] : stdout.trim(),
    };
  } catch {
    return { installed: false, version: null };
  }
}

/**
 * Get Docker version info
 */
async function getDockerVersion() {
  try {
    const { stdout } = await execFileAsync('docker', ['--version']);
    const match = stdout.match(/Docker version (\d+\.\d+\.\d+)/);
    return {
      installed: true,
      version: match ? match[1] : stdout.trim(),
    };
  } catch {
    return { installed: false, version: null };
  }
}

/**
 * Check if Docker daemon is running
 */
async function isDockerRunning() {
  try {
    await execFileAsync('docker', ['info'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get detected Node version manager
 */
async function getNodeVersionManager() {
  const homeDir = os.homedir();

  // Check for nvm
  const nvmDir = process.env.NVM_DIR || path.join(homeDir, '.nvm');
  if (fs.existsSync(path.join(nvmDir, 'nvm.sh'))) {
    return { manager: 'nvm', path: nvmDir };
  }

  // Check for volta
  const voltaDir = path.join(homeDir, '.volta');
  if (fs.existsSync(voltaDir)) {
    return { manager: 'volta', path: voltaDir };
  }

  // Check for fnm
  try {
    await execFileAsync('fnm', ['--version']);
    return { manager: 'fnm', path: null };
  } catch {
    // Not installed
  }

  // Check for asdf
  const asdfDir = path.join(homeDir, '.asdf');
  if (fs.existsSync(asdfDir)) {
    return { manager: 'asdf', path: asdfDir };
  }

  return { manager: 'system', path: null };
}

/**
 * Get disk space info for a path
 */
async function getDiskSpace(targetPath) {
  try {
    // Use df command on Unix-like systems
    const { stdout } = await execFileAsync('df', ['-k', targetPath]);
    const lines = stdout.split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      const totalKB = parseInt(parts[1], 10);
      const usedKB = parseInt(parts[2], 10);
      const availableKB = parseInt(parts[3], 10);

      return {
        total: totalKB * 1024,
        used: usedKB * 1024,
        available: availableKB * 1024,
        usedPercent: Math.round((usedKB / totalKB) * 100),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get all system versions (with caching)
 */
export async function getSystemVersions() {
  const now = Date.now();
  if (versionCache && now - versionCacheTime < VERSION_CACHE_TTL) {
    return versionCache;
  }

  const [node, npm, git, docker, dockerRunning, versionManager] = await Promise.all([
    getNodeVersion(),
    getNpmVersion(),
    getGitVersion(),
    getDockerVersion(),
    isDockerRunning(),
    getNodeVersionManager(),
  ]);

  versionCache = {
    node,
    npm,
    git,
    docker: {
      ...docker,
      running: dockerRunning,
    },
    versionManager,
    timestamp: now,
  };
  versionCacheTime = now;

  return versionCache;
}

/**
 * Get system memory info
 */
export function getMemoryInfo() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  return {
    total: totalMem,
    free: freeMem,
    used: usedMem,
    usedPercent: Math.round((usedMem / totalMem) * 100),
  };
}

/**
 * Get CPU info
 */
export function getCpuInfo() {
  const cpus = os.cpus();
  const loadAvg = os.loadavg();

  return {
    cores: cpus.length,
    model: cpus[0]?.model || 'Unknown',
    loadAverage: {
      '1min': loadAvg[0],
      '5min': loadAvg[1],
      '15min': loadAvg[2],
    },
  };
}

/**
 * Check project health
 */
export async function checkProjectHealth(projectPath) {
  const health = {
    path: projectPath,
    checks: [],
  };

  // Check for package.json
  const packageJsonPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    health.checks.push({
      name: 'package.json',
      status: 'missing',
      severity: 'error',
      message: 'No package.json found',
    });
    return health;
  }

  // Check for node_modules
  const nodeModulesPath = path.join(projectPath, 'node_modules');
  const hasNodeModules = fs.existsSync(nodeModulesPath);
  health.checks.push({
    name: 'node_modules',
    status: hasNodeModules ? 'ok' : 'missing',
    severity: hasNodeModules ? 'ok' : 'warning',
    message: hasNodeModules ? 'Dependencies installed' : 'Run npm install to install dependencies',
    action: hasNodeModules ? null : 'npm install',
  });

  // Check for package-lock.json age
  const lockFilePath = path.join(projectPath, 'package-lock.json');
  if (fs.existsSync(lockFilePath)) {
    const stats = fs.statSync(lockFilePath);
    const ageInDays = Math.floor((Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24));
    const isStale = ageInDays > 90;
    health.checks.push({
      name: 'lockFile',
      status: isStale ? 'stale' : 'ok',
      severity: isStale ? 'warning' : 'ok',
      message: isStale
        ? `Lock file is ${ageInDays} days old - consider updating dependencies`
        : `Lock file updated ${ageInDays} days ago`,
      action: isStale ? 'npm update' : null,
    });
  }

  // Check for .nvmrc or .node-version
  const hasNvmrc = fs.existsSync(path.join(projectPath, '.nvmrc'));
  const hasNodeVersion = fs.existsSync(path.join(projectPath, '.node-version'));
  health.checks.push({
    name: 'nodeVersion',
    status: hasNvmrc || hasNodeVersion ? 'ok' : 'missing',
    severity: 'info',
    message:
      hasNvmrc || hasNodeVersion
        ? 'Node version pinned'
        : 'Consider adding .nvmrc or .node-version for consistent Node version',
  });

  // Check for TypeScript
  const hasTsConfig = fs.existsSync(path.join(projectPath, 'tsconfig.json'));
  if (hasTsConfig) {
    health.checks.push({
      name: 'typescript',
      status: 'ok',
      severity: 'ok',
      message: 'TypeScript configured',
    });
  }

  // Check for ESLint
  const hasEslint =
    fs.existsSync(path.join(projectPath, '.eslintrc.js')) ||
    fs.existsSync(path.join(projectPath, '.eslintrc.json')) ||
    fs.existsSync(path.join(projectPath, 'eslint.config.js'));
  health.checks.push({
    name: 'linting',
    status: hasEslint ? 'ok' : 'missing',
    severity: hasEslint ? 'ok' : 'info',
    message: hasEslint ? 'ESLint configured' : 'Consider adding ESLint for code quality',
  });

  // Check for .gitignore
  const hasGitignore = fs.existsSync(path.join(projectPath, '.gitignore'));
  health.checks.push({
    name: 'gitignore',
    status: hasGitignore ? 'ok' : 'missing',
    severity: hasGitignore ? 'ok' : 'warning',
    message: hasGitignore ? '.gitignore present' : 'Missing .gitignore - may commit unwanted files',
  });

  return health;
}

/**
 * Parse `ps -A -o pid=,pcpu=,rss=,comm=` (statsOut) and `ps -A -ww -o pid=,args=` (argsOut)
 * into the top processes by CPU and by memory, plus the top apps (same name summed).
 * Two outputs because macOS truncates comm to 16 chars unless it is the last column.
 */
export function parseTopProcesses(statsOut, argsOut, limit = 8) {
  const args = new Map();
  for (const line of String(argsOut || '').split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (m) args.set(Number(m[1]), m[2].length > 120 ? `${m[2].slice(0, 119)}…` : m[2]);
  }
  const procs = [];
  for (const line of String(statsOut || '').split('\n')) {
    // pcpu uses the locale's decimal separator (de_DE: "3,0")
    const m = line.match(/^\s*(\d+)\s+(\d+(?:[.,]\d+)?)\s+(\d+)\s+(.+?)\s*$/);
    if (!m) continue;
    const pid = Number(m[1]);
    procs.push({
      pid,
      name: path.basename(m[4]) || m[4],
      command: args.get(pid) ?? m[4],
      cpuPercent: Number(m[2].replace(',', '.')),
      rssBytes: Number(m[3]) * 1024, // ps rss is KiB
    });
  }
  const top = (list, key) => [...list].sort((a, b) => b[key] - a[key]).slice(0, limit);
  const apps = new Map();
  for (const p of procs) {
    const app = apps.get(p.name) || { name: p.name, processCount: 0, cpuPercent: 0, rssBytes: 0 };
    app.processCount += 1;
    app.cpuPercent = Math.round((app.cpuPercent + p.cpuPercent) * 10) / 10;
    app.rssBytes += p.rssBytes;
    apps.set(p.name, app);
  }
  return {
    byCpu: top(procs, 'cpuPercent'),
    byMemory: top(procs, 'rssBytes'),
    byApp: [...apps.values()].sort((a, b) => b.rssBytes - a.rssBytes).slice(0, 5),
  };
}

/**
 * Top processes of the whole machine; empty lists when ps fails.
 */
async function getTopProcesses() {
  const opts = { timeout: 5000, maxBuffer: 16 * 1024 * 1024 };
  try {
    const [stats, args] = await Promise.all([
      execFileAsync('ps', ['-A', '-o', 'pid=,pcpu=,rss=,comm='], opts),
      execFileAsync('ps', ['-A', '-ww', '-o', 'pid=,args='], opts),
    ]);
    return parseTopProcesses(stats.stdout, args.stdout);
  } catch {
    return { byCpu: [], byMemory: [], byApp: [] };
  }
}

/**
 * Get full system health report
 */
export async function getSystemHealth(_projectPaths = []) {
  const [versions, diskSpace, topProcesses] = await Promise.all([
    getSystemVersions(),
    getDiskSpace(os.homedir()),
    getTopProcesses(),
  ]);

  const memory = getMemoryInfo();
  const cpu = getCpuInfo();

  return {
    system: {
      versions,
      memory,
      cpu,
      disk: diskSpace,
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptime: os.uptime(),
    },
    topProcesses,
    timestamp: Date.now(),
  };
}

/**
 * Clear version cache (for testing or forced refresh)
 */
export function clearVersionCache() {
  versionCache = null;
  versionCacheTime = 0;
}
