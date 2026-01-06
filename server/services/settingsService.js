import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Settings file path - stored in data/ directory
const SETTINGS_FILE = path.join(__dirname, '..', '..', 'data', 'settings.json');

/**
 * Default settings structure
 */
const defaultSettings = {
  favorites: [],      // Array of app IDs that are favorited
  archived: [],       // Array of app IDs that are archived
  customPorts: {},    // Map of appId -> port number
  customNames: {},    // Map of appId -> custom name
  preferredIDEs: {},  // Map of appId -> preferred IDE id
  version: 1,         // Settings schema version for future migrations
};

/**
 * Ensures the data directory and settings file exist
 */
function ensureSettingsFile() {
  const dataDir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2));
  }
}

/**
 * Read settings from file with automatic migration
 * @returns {object} Settings object
 */
function readSettings() {
  ensureSettingsFile();
  try {
    const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    const loadedSettings = JSON.parse(data);

    // Migrate: Ensure preferredIDEs exists (added in v1.1)
    if (!loadedSettings.preferredIDEs) {
      loadedSettings.preferredIDEs = {};
    }

    return { ...defaultSettings, ...loadedSettings };
  } catch (error) {
    console.error('Failed to read settings:', error);
    return { ...defaultSettings };
  }
}

/**
 * Write settings to file
 * @param {object} settings - Settings to write
 */
function writeSettings(settings) {
  ensureSettingsFile();
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Failed to write settings:', error);
    throw error;
  }
}

/**
 * Settings Service - manages user preferences persistence
 */
class SettingsService {
  /**
   * Get all settings
   * @returns {object} All settings
   */
  getSettings() {
    return readSettings();
  }

  /**
   * Get settings for a specific app
   * @param {string} appId - Application ID
   * @returns {object} App-specific settings
   */
  getAppSettings(appId) {
    const settings = readSettings();
    return {
      isFavorite: settings.favorites.includes(appId),
      isArchived: settings.archived.includes(appId),
      customPort: settings.customPorts[appId] || null,
      customName: settings.customNames[appId] || null,
      preferredIDE: settings.preferredIDEs?.[appId] || null,
    };
  }

  /**
   * Toggle favorite status for an app
   * @param {string} appId - Application ID
   * @returns {boolean} New favorite status
   */
  toggleFavorite(appId) {
    const settings = readSettings();
    const index = settings.favorites.indexOf(appId);

    if (index === -1) {
      settings.favorites.push(appId);
    } else {
      settings.favorites.splice(index, 1);
    }

    writeSettings(settings);
    return index === -1; // Returns true if now favorited
  }

  /**
   * Set favorite status for an app
   * @param {string} appId - Application ID
   * @param {boolean} isFavorite - Whether app should be favorited
   * @returns {boolean} New favorite status
   */
  setFavorite(appId, isFavorite) {
    const settings = readSettings();
    const index = settings.favorites.indexOf(appId);

    if (isFavorite && index === -1) {
      settings.favorites.push(appId);
    } else if (!isFavorite && index !== -1) {
      settings.favorites.splice(index, 1);
    }

    writeSettings(settings);
    return isFavorite;
  }

  /**
   * Toggle archive status for an app
   * @param {string} appId - Application ID
   * @returns {boolean} New archive status
   */
  toggleArchive(appId) {
    const settings = readSettings();
    const index = settings.archived.indexOf(appId);

    if (index === -1) {
      settings.archived.push(appId);
      // Remove from favorites when archiving
      const favIndex = settings.favorites.indexOf(appId);
      if (favIndex !== -1) {
        settings.favorites.splice(favIndex, 1);
      }
    } else {
      settings.archived.splice(index, 1);
    }

    writeSettings(settings);
    return index === -1; // Returns true if now archived
  }

  /**
   * Set archive status for an app
   * @param {string} appId - Application ID
   * @param {boolean} isArchived - Whether app should be archived
   * @returns {boolean} New archive status
   */
  setArchive(appId, isArchived) {
    const settings = readSettings();
    const index = settings.archived.indexOf(appId);

    if (isArchived && index === -1) {
      settings.archived.push(appId);
      // Remove from favorites when archiving
      const favIndex = settings.favorites.indexOf(appId);
      if (favIndex !== -1) {
        settings.favorites.splice(favIndex, 1);
      }
    } else if (!isArchived && index !== -1) {
      settings.archived.splice(index, 1);
    }

    writeSettings(settings);
    return isArchived;
  }

  /**
   * Set custom port for an app
   * @param {string} appId - Application ID
   * @param {number|null} port - Port number or null to clear
   * @returns {number|null} The set port
   */
  setPort(appId, port) {
    const settings = readSettings();

    if (port === null || port === undefined) {
      delete settings.customPorts[appId];
    } else {
      settings.customPorts[appId] = port;
    }

    writeSettings(settings);
    return port;
  }

  /**
   * Set custom name for an app
   * @param {string} appId - Application ID
   * @param {string|null} name - Custom name or null to clear
   * @returns {string|null} The set name
   */
  setName(appId, name) {
    const settings = readSettings();

    if (name === null || name === undefined || name.trim() === '') {
      delete settings.customNames[appId];
    } else {
      settings.customNames[appId] = name.trim();
    }

    writeSettings(settings);
    return name;
  }

  /**
   * Bulk import settings (for migration from localStorage)
   * @param {object} importData - Settings to import
   * @returns {object} Merged settings
   */
  importSettings(importData) {
    const settings = readSettings();

    // Merge arrays (deduplicate)
    if (Array.isArray(importData.favorites)) {
      settings.favorites = [...new Set([...settings.favorites, ...importData.favorites])];
    }
    if (Array.isArray(importData.archived)) {
      settings.archived = [...new Set([...settings.archived, ...importData.archived])];
    }

    // Merge objects
    if (importData.customPorts && typeof importData.customPorts === 'object') {
      settings.customPorts = { ...settings.customPorts, ...importData.customPorts };
    }
    if (importData.customNames && typeof importData.customNames === 'object') {
      settings.customNames = { ...settings.customNames, ...importData.customNames };
    }

    writeSettings(settings);
    return settings;
  }

  /**
   * Clear all settings (reset to defaults)
   */
  clearAll() {
    writeSettings(defaultSettings);
    return defaultSettings;
  }

  /**
   * Set preferred IDE for an app
   * @param {string} appId - Application ID
   * @param {string|null} ideId - IDE identifier or null to clear
   * @returns {string|null} The set IDE
   */
  setPreferredIDE(appId, ideId) {
    const settings = readSettings();

    if (!settings.preferredIDEs) {
      settings.preferredIDEs = {};
    }

    if (ideId === null || ideId === undefined || ideId.trim() === '') {
      delete settings.preferredIDEs[appId];
    } else {
      settings.preferredIDEs[appId] = ideId.trim();
    }

    writeSettings(settings);
    return ideId;
  }

  /**
   * Get preferred IDE for an app
   * @param {string} appId - Application ID
   * @returns {string|null} Preferred IDE ID or null
   */
  getPreferredIDE(appId) {
    const settings = readSettings();
    return settings.preferredIDEs?.[appId] || null;
  }

  /**
   * Remove settings for apps that no longer exist
   * @param {string[]} validAppIds - List of valid app IDs
   */
  cleanupOrphanedSettings(validAppIds) {
    const settings = readSettings();
    const validSet = new Set(validAppIds);

    // Clean up favorites
    settings.favorites = settings.favorites.filter(id => validSet.has(id));

    // Clean up archived
    settings.archived = settings.archived.filter(id => validSet.has(id));

    // Clean up custom ports
    for (const appId of Object.keys(settings.customPorts)) {
      if (!validSet.has(appId)) {
        delete settings.customPorts[appId];
      }
    }

    // Clean up custom names
    for (const appId of Object.keys(settings.customNames)) {
      if (!validSet.has(appId)) {
        delete settings.customNames[appId];
      }
    }

    // Clean up preferred IDEs
    if (settings.preferredIDEs) {
      for (const appId of Object.keys(settings.preferredIDEs)) {
        if (!validSet.has(appId)) {
          delete settings.preferredIDEs[appId];
        }
      }
    }

    writeSettings(settings);
    return settings;
  }
}

// Export singleton instance
export const settingsService = new SettingsService();
export default SettingsService;
