import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = path.join(__dirname, '..', '..', 'data', 'config.json');

// Default configuration
const defaultConfig = {
  directories: [
    process.env.HOME ? path.join(process.env.HOME, 'projects') : '/projects',
  ],
  scanDepth: 2,
  excludePatterns: ['node_modules', '.git', 'dist', 'build', '.next'],
};

// Forbidden paths that should never be scanned (security)
const FORBIDDEN_PATHS = [
  '/etc',
  '/var',
  '/usr',
  '/bin',
  '/sbin',
  '/boot',
  '/root',
  '/sys',
  '/proc',
  '/dev',
  '/.ssh',
  '/.gnupg',
  '/.aws',
  '/.config',
];

/**
 * Validate that a path is safe to scan
 */
function validatePath(dirPath) {
  const absolutePath = path.resolve(dirPath);
  const normalizedPath = path.normalize(absolutePath);

  // Check if path tries to escape via ../
  if (normalizedPath !== absolutePath) {
    throw new Error('Path traversal detected');
  }

  // Check against forbidden paths
  for (const forbidden of FORBIDDEN_PATHS) {
    const forbiddenAbs = path.resolve(process.env.HOME || '/', forbidden);
    if (normalizedPath.startsWith(forbiddenAbs) || normalizedPath === forbiddenAbs) {
      throw new Error(`Access to '${forbidden}' is not allowed for security reasons`);
    }
    // Also check absolute forbidden paths
    if (normalizedPath.startsWith(forbidden) || normalizedPath === forbidden) {
      throw new Error(`Access to '${forbidden}' is not allowed for security reasons`);
    }
  }

  // Check for hidden directories in home
  const homeDir = process.env.HOME || '';
  if (homeDir && normalizedPath.startsWith(homeDir)) {
    const relativePath = normalizedPath.slice(homeDir.length);
    if (relativePath.match(/^\/\.[^/]+/)) {
      throw new Error('Scanning hidden directories in home is not allowed');
    }
  }

  // Ensure path is a directory and exists
  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`Directory does not exist: ${normalizedPath}`);
  }

  const stats = fs.statSync(normalizedPath);
  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${normalizedPath}`);
  }

  // Check for symlinks that might escape
  const realPath = fs.realpathSync(normalizedPath);
  if (realPath !== normalizedPath) {
    // Re-validate the real path
    for (const forbidden of FORBIDDEN_PATHS) {
      if (realPath.startsWith(forbidden)) {
        throw new Error(`Symlink points to forbidden location`);
      }
    }
  }

  return normalizedPath;
}

/**
 * Ensures the data directory and config file exist
 */
function ensureConfigFile() {
  const dataDir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
  }
}

/**
 * Get current configuration
 */
export function getConfig() {
  ensureConfigFile();
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return { ...defaultConfig, ...JSON.parse(data) };
  } catch {
    return defaultConfig;
  }
}

/**
 * Update configuration
 */
export function updateConfig(updates) {
  ensureConfigFile();
  const current = getConfig();
  const updated = { ...current, ...updates };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2));
  return updated;
}

/**
 * Add a directory to scan
 */
export function addDirectory(dirPath) {
  // Validate path for security (prevents path traversal and forbidden access)
  const validatedPath = validatePath(dirPath);

  const config = getConfig();

  if (!config.directories.includes(validatedPath)) {
    config.directories.push(validatedPath);
    updateConfig(config);
  }

  return config;
}

/**
 * Remove a directory from scan list
 */
export function removeDirectory(dirPath) {
  const config = getConfig();
  const absolutePath = path.resolve(dirPath);
  config.directories = config.directories.filter(d => d !== absolutePath);
  updateConfig(config);
  return config;
}
