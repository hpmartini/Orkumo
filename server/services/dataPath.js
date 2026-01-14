/**
 * Data Path Service
 *
 * Provides a centralized way to get the correct data directory path
 * that persists across app updates.
 *
 * In Electron production mode: Uses userData path passed from main process
 * In development/standalone: Uses local data/ directory
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the data directory path
 *
 * Priority:
 * 1. DEVORBIT_DATA_PATH env var (set by Electron main process)
 * 2. Local data/ directory relative to server (development/standalone)
 *
 * @returns {string} Absolute path to the data directory
 */
export function getDataPath() {
  // In Electron production mode, the main process passes the userData path
  if (process.env.DEVORBIT_DATA_PATH) {
    return process.env.DEVORBIT_DATA_PATH;
  }

  // Development or standalone mode: use local data directory
  return path.join(__dirname, '..', '..', 'data');
}

/**
 * Ensure the data directory exists
 * @returns {string} The data directory path
 */
export function ensureDataDirectory() {
  const dataPath = getDataPath();
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
    console.log(`[DataPath] Created data directory: ${dataPath}`);
  }
  return dataPath;
}

/**
 * Get full path to a data file
 * @param {string} filename - The filename (e.g., 'config.json')
 * @returns {string} Full path to the file
 */
export function getDataFilePath(filename) {
  return path.join(getDataPath(), filename);
}

/**
 * Migrate data from old location to new location (for existing users)
 * Called once when userData path is first used
 *
 * @param {string} oldDataPath - The old data directory (inside app bundle)
 * @param {string} newDataPath - The new data directory (userData)
 */
export function migrateDataIfNeeded(oldDataPath, newDataPath) {
  const migrationMarker = path.join(newDataPath, '.migrated');

  // Skip if already migrated
  if (fs.existsSync(migrationMarker)) {
    return { migrated: false, reason: 'already_migrated' };
  }

  // Skip if old path doesn't exist or has no data
  if (!fs.existsSync(oldDataPath)) {
    // Create marker to skip future checks
    fs.mkdirSync(newDataPath, { recursive: true });
    fs.writeFileSync(migrationMarker, new Date().toISOString());
    return { migrated: false, reason: 'no_old_data' };
  }

  const filesToMigrate = ['config.json', 'settings.json', 'custom-ides.json'];
  const migratedFiles = [];

  // Ensure new directory exists
  fs.mkdirSync(newDataPath, { recursive: true });

  for (const file of filesToMigrate) {
    const oldFile = path.join(oldDataPath, file);
    const newFile = path.join(newDataPath, file);

    // Only migrate if old file exists and new file doesn't
    if (fs.existsSync(oldFile) && !fs.existsSync(newFile)) {
      try {
        const content = fs.readFileSync(oldFile, 'utf-8');
        fs.writeFileSync(newFile, content);
        migratedFiles.push(file);
        console.log(`[DataPath] Migrated ${file} to ${newDataPath}`);
      } catch (err) {
        console.error(`[DataPath] Failed to migrate ${file}:`, err);
      }
    }
  }

  // Create migration marker
  fs.writeFileSync(migrationMarker, JSON.stringify({
    migratedAt: new Date().toISOString(),
    migratedFiles,
    oldPath: oldDataPath,
    newPath: newDataPath
  }, null, 2));

  return { migrated: true, files: migratedFiles };
}

export default {
  getDataPath,
  ensureDataDirectory,
  getDataFilePath,
  migrateDataIfNeeded
};
