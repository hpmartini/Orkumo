import fs from 'fs';
import path from 'path';
import { getDataFilePath, ensureDataDirectory } from './dataPath.js';

// Settings file path - stored in persistent data directory
const SETTINGS_FILE = getDataFilePath('settings.json');

/**
 * Default settings structure
 */
const defaultSettings = {
  favorites: [],      // Array of app IDs that are favorited (order matters for manual sort)
  archived: [],       // Array of app IDs that are archived
  customPorts: {},    // Map of appId -> port number
  customNames: {},    // Map of appId -> custom name
  customCommands: {}, // Map of appId -> custom start command
  preferredIDEs: {},  // Map of appId -> preferred IDE id
  favoritesSortMode: 'manual', // 'manual' | 'alpha-asc' | 'alpha-desc'
  apiKeys: {},        // Map of provider -> API key (e.g. { gemini: "AIza..." })
  version: 1,         // Settings schema version for future migrations
};

/**
 * Ensures the data directory and settings file exist
 */
function ensureSettingsFile() {
  ensureDataDirectory();
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

    // Migrate: Ensure favoritesSortMode exists (added in v1.2)
    if (!loadedSettings.favoritesSortMode) {
      loadedSettings.favoritesSortMode = 'manual';
    }

    // Migrate: Ensure apiKeys exists (added in v1.3)
    if (!loadedSettings.apiKeys) {
      loadedSettings.apiKeys = {};
    }

    // Migrate: Ensure customCommands exists (added in v1.4)
    if (!loadedSettings.customCommands) {
      loadedSettings.customCommands = {};
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
      customCommand: settings.customCommands?.[appId] || null,
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
   * Set custom command for an app
   * @param {string} appId - Application ID
   * @param {string|null} command - Custom command or null to clear
   * @returns {string|null} The set command
   */
  setCommand(appId, command) {
    const settings = readSettings();

    if (!settings.customCommands) {
      settings.customCommands = {};
    }

    if (command === null || command === undefined || command.trim() === '') {
      delete settings.customCommands[appId];
    } else {
      settings.customCommands[appId] = command.trim();
    }

    writeSettings(settings);
    return command;
  }

  /**
   * Get custom command for an app
   * @param {string} appId - Application ID
   * @returns {string|null} Custom command or null
   */
  getCommand(appId) {
    const settings = readSettings();
    return settings.customCommands?.[appId] || null;
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
   * Set favorites sort mode
   * @param {'manual' | 'alpha-asc' | 'alpha-desc'} mode - Sort mode
   * @returns {string} The set mode
   */
  setFavoritesSortMode(mode) {
    const validModes = ['manual', 'alpha-asc', 'alpha-desc'];
    if (!validModes.includes(mode)) {
      throw new Error(`Invalid sort mode: ${mode}`);
    }

    const settings = readSettings();
    settings.favoritesSortMode = mode;
    writeSettings(settings);
    return mode;
  }

  /**
   * Get favorites sort mode
   * @returns {string} Current sort mode
   */
  getFavoritesSortMode() {
    const settings = readSettings();
    return settings.favoritesSortMode || 'manual';
  }

  /**
   * Reorder favorites array
   * @param {string[]} newOrder - New order of favorite app IDs
   * @returns {string[]} The new favorites array
   */
  reorderFavorites(newOrder) {
    const settings = readSettings();

    // Validate that all IDs in newOrder are currently favorites
    const currentFavorites = new Set(settings.favorites);
    const isValid = newOrder.every(id => currentFavorites.has(id));

    if (!isValid || newOrder.length !== settings.favorites.length) {
      throw new Error('Invalid favorites order: IDs must match current favorites');
    }

    settings.favorites = newOrder;
    writeSettings(settings);
    return newOrder;
  }

  /**
   * Get all API keys (masked for security)
   * @returns {object} Map of provider -> masked key info
   */
  getApiKeys() {
    const settings = readSettings();
    const masked = {};
    for (const [provider, key] of Object.entries(settings.apiKeys || {})) {
      if (key && typeof key === 'string' && key.length > 4) {
        masked[provider] = {
          configured: true,
          maskedKey: `${key.substring(0, 4)}...${key.substring(key.length - 4)}`,
        };
      } else if (key) {
        masked[provider] = { configured: true, maskedKey: '****' };
      }
    }
    return masked;
  }

  /**
   * Get the raw API key for a provider (for server-side use only)
   * @param {string} provider - Provider name (e.g. 'gemini')
   * @returns {string|null} Raw API key or null
   */
  getApiKey(provider) {
    const settings = readSettings();
    return settings.apiKeys?.[provider] || null;
  }

  /**
   * Set an API key for a provider
   * @param {string} provider - Provider name
   * @param {string} key - API key
   */
  setApiKey(provider, key) {
    const settings = readSettings();
    if (!settings.apiKeys) {
      settings.apiKeys = {};
    }
    settings.apiKeys[provider] = key;
    writeSettings(settings);
  }

  /**
   * Remove an API key for a provider
   * @param {string} provider - Provider name
   */
  removeApiKey(provider) {
    const settings = readSettings();
    if (settings.apiKeys) {
      delete settings.apiKeys[provider];
      writeSettings(settings);
    }
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

    // Clean up custom commands
    if (settings.customCommands) {
      for (const appId of Object.keys(settings.customCommands)) {
        if (!validSet.has(appId)) {
          delete settings.customCommands[appId];
        }
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

  /**
   * Configure ports for all apps consistently, starting from a base port
   * @param {string[]} appIds - Array of app IDs to configure
   * @param {number} startPort - Starting port number (default: 3001)
   * @param {object} portManager - PortManager instance for conflict detection
   * @param {function} onProgress - Optional progress callback (currentIndex, total)
   * @returns {Promise<object>} Map of appId -> assigned port
   */
  async configureAllPorts(appIds, startPort = 3001, portManager = null, onProgress = null) {
    const settings = readSettings();
    const configured = {};
    let currentPort = startPort;
    let highestPort = startPort;

    // Validate that we won't exhaust port range
    // Use a conservative estimate: assume 20% of ports might be unavailable due to conflicts
    const maxPort = 65535;
    const estimatedPortsNeeded = Math.ceil(appIds.length * 1.2);
    if (startPort + estimatedPortsNeeded > maxPort) {
      throw new Error(`Port range exhausted: Cannot assign ${appIds.length} apps starting from ${startPort} (estimated ${estimatedPortsNeeded} ports needed including conflicts)`);
    }

    // If portManager is provided, check ports in parallel for better performance
    let unavailablePorts = new Set();
    let preCheckedMaxPort = startPort;
    if (portManager) {
      // Batch check ports in parallel (check up to 50 ports ahead)
      const portsToCheck = Math.min(appIds.length + 50, maxPort - startPort + 1);
      preCheckedMaxPort = startPort + portsToCheck - 1;
      const portCheckPromises = [];

      for (let i = 0; i < portsToCheck; i++) {
        const portToCheck = startPort + i;
        portCheckPromises.push(
          portManager.isPortAvailable(portToCheck).then(available => ({
            port: portToCheck,
            available
          }))
        );
      }

      // Wait for all checks to complete
      const results = await Promise.all(portCheckPromises);
      unavailablePorts = new Set(
        results.filter(r => !r.available).map(r => r.port)
      );
    }

    // Assign sequential ports starting from startPort
    for (let i = 0; i < appIds.length; i++) {
      const appId = appIds[i];

      // Find the next available port
      let assignedPort = currentPort;

      // Skip unavailable ports
      while (unavailablePorts.has(assignedPort) && assignedPort <= maxPort) {
        assignedPort++;
      }

      // If we've exhausted our pre-checked range, check new ports
      if (portManager && assignedPort > preCheckedMaxPort) {
        let portAvailable = await portManager.isPortAvailable(assignedPort);
        while (!portAvailable && assignedPort <= maxPort) {
          assignedPort++;
          if (assignedPort > maxPort) {
            throw new Error(`Port range exhausted after configuring ${i} apps`);
          }
          portAvailable = await portManager.isPortAvailable(assignedPort);
        }
      }

      // Track the highest port used
      highestPort = Math.max(highestPort, assignedPort);

      // Validate we haven't exceeded the max port
      if (highestPort > maxPort) {
        throw new Error(`Port range exhausted after configuring ${i} apps`);
      }

      settings.customPorts[appId] = assignedPort;
      configured[appId] = assignedPort;

      // Set currentPort to the next port after the assigned port to ensure sequential allocation
      currentPort = assignedPort + 1;

      // Report progress if callback is provided
      if (onProgress) {
        const percentage = Math.round(((i + 1) / appIds.length) * 100);
        onProgress(i + 1, appIds.length, percentage);
      }
    }

    writeSettings(settings);
    return configured;
  }
}

// Export singleton instance
export const settingsService = new SettingsService();
export default SettingsService;
