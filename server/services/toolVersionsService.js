import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

/**
 * Tool versions (#184): global tool versions plus the Node version each project pins
 * (nvm/fnm/volta read .nvmrc, .node-version or engines.node). System health is gone: the OS task manager covers it.
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

const NODE_PIN_FILES = ['.nvmrc', '.node-version'];

/**
 * Node version a project pins, or null: .nvmrc / .node-version first (what nvm and fnm read), then engines.node.
 */
export async function projectNodeVersion(projectPath) {
  for (const file of NODE_PIN_FILES) {
    try {
      const value = (await fs.promises.readFile(path.join(projectPath, file), 'utf8')).trim();
      if (value) return { version: value.split(/\s/)[0].replace(/^v/, ''), source: file };
    } catch {
      // not pinned in this file
    }
  }
  try {
    const pkg = JSON.parse(
      await fs.promises.readFile(path.join(projectPath, 'package.json'), 'utf8')
    );
    if (typeof pkg.engines?.node === 'string')
      return { version: pkg.engines.node, source: 'engines' };
  } catch {
    // no or invalid package.json
  }
  return null;
}

/** Global versions plus the pinned Node version per project id */
export async function getToolVersions(apps = []) {
  const [system, pins] = await Promise.all([
    getSystemVersions(),
    Promise.all(apps.map(async (app) => [app.id, await projectNodeVersion(app.path)])),
  ]);
  return { system, projects: Object.fromEntries(pins.filter(([, pin]) => pin)) };
}

/**
 * Clear version cache (for testing or forced refresh)
 */
export function clearVersionCache() {
  versionCache = null;
  versionCacheTime = 0;
}
