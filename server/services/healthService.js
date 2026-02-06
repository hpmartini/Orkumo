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
  if (versionCache && (now - versionCacheTime) < VERSION_CACHE_TTL) {
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
    message: hasNvmrc || hasNodeVersion
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
  const hasEslint = fs.existsSync(path.join(projectPath, '.eslintrc.js')) ||
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
 * Get full system health report
 */
export async function getSystemHealth(projectPaths = []) {
  const [versions, diskSpace] = await Promise.all([
    getSystemVersions(),
    getDiskSpace(os.homedir()),
  ]);

  const memory = getMemoryInfo();
  const cpu = getCpuInfo();

  // Generate recommendations based on health data
  const recommendations = [];

  // Check Node version
  if (versions.node.installed) {
    const nodeVersion = versions.node.version.split('.')[0];
    if (parseInt(nodeVersion, 10) < 20) {
      recommendations.push({
        type: 'update',
        severity: 'warning',
        title: 'Node.js Update Available',
        message: `Current Node.js version (${versions.node.version}) is older than LTS 20.x`,
        action: versions.versionManager.manager === 'nvm'
          ? 'nvm install --lts && nvm use --lts'
          : versions.versionManager.manager === 'volta'
            ? 'volta install node@lts'
            : 'Download from nodejs.org',
      });
    }
  }

  // Check Docker
  if (versions.docker.installed && !versions.docker.running) {
    recommendations.push({
      type: 'service',
      severity: 'info',
      title: 'Docker Not Running',
      message: 'Docker is installed but the daemon is not running',
      action: 'Start Docker Desktop or run: sudo systemctl start docker',
    });
  }

  // Check disk space
  if (diskSpace && diskSpace.usedPercent > 90) {
    recommendations.push({
      type: 'disk',
      severity: 'warning',
      title: 'Low Disk Space',
      message: `Disk is ${diskSpace.usedPercent}% full`,
      action: 'Free up disk space or expand storage',
    });
  }

  // Check memory
  if (memory.usedPercent > 85) {
    recommendations.push({
      type: 'memory',
      severity: 'warning',
      title: 'High Memory Usage',
      message: `Memory is ${memory.usedPercent}% utilized`,
      action: 'Close unused applications to free memory',
    });
  }

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
    recommendations,
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
