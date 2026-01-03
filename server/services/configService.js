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
  const config = getConfig();
  const absolutePath = path.resolve(dirPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Directory does not exist: ${absolutePath}`);
  }

  if (!config.directories.includes(absolutePath)) {
    config.directories.push(absolutePath);
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
