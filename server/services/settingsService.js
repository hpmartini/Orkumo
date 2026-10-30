import fs from 'fs';
import { randomUUID } from 'crypto';
import { getDataFilePath, ensureDataDirectory } from './dataPath.js';
import * as projectContexts from './projectContexts.js';

// Settings file path - stored in persistent data directory
const SETTINGS_FILE = getDataFilePath('settings.json');

/**
 * Default settings structure
 */
const defaultSettings = {
  favorites: [], // Array of app IDs that are favorited (order matters for manual sort)
  archived: [], // Array of app IDs that are archived
  customPorts: {}, // Map of appId -> port number
  customNames: {}, // Map of appId -> custom name
  preferredIDEs: {}, // Map of appId -> preferred IDE id
  favoritesSortMode: 'manual', // 'manual' | 'alpha-asc' | 'alpha-desc'
  apiKeys: {}, // Map of provider -> API key (e.g. { provider: "key" })
  keyboardShortcuts: {}, // Custom keyboard shortcut overrides
  agentView: {}, // Claude Code agent view preferences (grouping, layout, dispatch defaults)
  board: {}, // Agent task board: GitHub project source + slice favorites/order/hidden
  contexts: projectContexts.DEFAULT_CONTEXTS, // Project contexts (#97), see projectContexts.js
  activeContextId: projectContexts.DEFAULT_CONTEXT_ID,
  contextState: {}, // Parked per-context values of the inactive contexts
  version: 1, // Settings schema version for future migrations
};

/**
 * Default Claude Code agent view preferences
 */
export const DEFAULT_AGENT_VIEW_SETTINGS = {
  grouping: 'project', // 'project' | 'state' | 'directory' | 'none'
  layout: 'tabs', // 'tabs' | 'columns' | 'rows' | 'grid'
  scopeCwd: null, // Only show sessions started under this path (claude agents --cwd)
  collapsedGroups: [],
  notifications: true,
  desktopNotifications: false,
  cardDetails: 'hover', // 'hover' | 'click' | 'always': when a session card shows its details
  cardDensity: 'comfortable', // 'comfortable' | 'compact'
  // Card element -> slot (#159); mirrors DEFAULT_AGENT_CARD_FIELDS in types.ts
  cardFields: {
    issue: 'left',
    pr: 'left',
    project: 'row2',
    branch: 'row2',
    git: 'row2',
    metrics: 'row3',
    status: 'row4',
    links: 'details',
    servers: 'details',
    subagents: 'details',
  },
  disabled: false, // Mirrors the CLI `disableAgentView` setting
  dispatch: {
    model: null,
    effort: null,
    permissionMode: null,
    agent: null,
    skipPermissions: false,
    allowSkipPermissions: false,
    restricted: false,
    settings: null,
    addDirs: [],
    pluginDirs: [],
    mcpConfigs: [],
    strictMcpConfig: false,
    fallbackModel: null,
  },
  version: 1,
};

/**
 * Default agent task board settings (MACC = users/hpmartini/projects/4)
 */
export const DEFAULT_BOARD_SETTINGS = {
  source: { owner: 'hpmartini', number: 4 },
  favorites: [],
  order: [],
  hidden: [],
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

    // Migrate: Ensure keyboardShortcuts exists (added in v1.6)
    if (!loadedSettings.keyboardShortcuts) {
      loadedSettings.keyboardShortcuts = {};
    }

    // Migrate: Ensure agentView exists (added in v1.7)
    if (!loadedSettings.agentView || typeof loadedSettings.agentView !== 'object') {
      loadedSettings.agentView = {};
    }

    // Migrate: Ensure board exists (added in v1.8)
    if (!loadedSettings.board || typeof loadedSettings.board !== 'object') {
      loadedSettings.board = {};
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
    const isValid = newOrder.every((id) => currentFavorites.has(id));

    if (!isValid || newOrder.length !== settings.favorites.length) {
      throw new Error('Invalid favorites order: IDs must match current favorites');
    }

    settings.favorites = newOrder;
    writeSettings(settings);
    return newOrder;
  }

  /**
   * Remove settings for apps that no longer exist
   * @param {string[]} validAppIds - List of valid app IDs
   */
  cleanupOrphanedSettings(validAppIds) {
    const settings = readSettings();
    const validSet = new Set(validAppIds);

    // Clean up favorites
    settings.favorites = settings.favorites.filter((id) => validSet.has(id));

    // Clean up context members and parked favorites of inactive contexts
    settings.contexts = settings.contexts.map((c) =>
      c.appIds ? { ...c, appIds: c.appIds.filter((id) => validSet.has(id)) } : c
    );
    for (const parked of Object.values(settings.contextState || {})) {
      if (parked.favorites) parked.favorites = parked.favorites.filter((id) => validSet.has(id));
    }

    // Clean up archived
    settings.archived = settings.archived.filter((id) => validSet.has(id));

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

  /**
   * Get keyboard shortcuts
   * @returns {object} Keyboard shortcuts configuration
   */
  getKeyboardShortcuts() {
    const settings = readSettings();
    return settings.keyboardShortcuts || {};
  }

  /**
   * Update keyboard shortcuts
   * @param {object} shortcuts - Keyboard shortcuts configuration
   * @returns {object} Updated settings
   */
  updateKeyboardShortcuts(shortcuts) {
    const settings = readSettings();
    settings.keyboardShortcuts = shortcuts;
    writeSettings(settings);
    return settings;
  }

  /**
   * Get Claude Code agent view preferences merged with defaults
   * @returns {object}
   */
  getAgentViewSettings() {
    const settings = readSettings();
    const stored =
      settings.agentView && typeof settings.agentView === 'object' ? settings.agentView : {};
    return {
      ...DEFAULT_AGENT_VIEW_SETTINGS,
      ...stored,
      dispatch: { ...DEFAULT_AGENT_VIEW_SETTINGS.dispatch, ...(stored.dispatch || {}) },
      cardFields: { ...DEFAULT_AGENT_VIEW_SETTINGS.cardFields, ...(stored.cardFields || {}) },
    };
  }

  /**
   * Update agent view preferences (shallow merge, dispatch and cardFields merged one level deeper)
   * @param {object} partial
   * @returns {object} Updated preferences
   */
  updateAgentViewSettings(partial) {
    const settings = readSettings();
    const current = this.getAgentViewSettings();
    const next = {
      ...current,
      ...partial,
      dispatch: { ...current.dispatch, ...(partial?.dispatch || {}) },
      cardFields: { ...current.cardFields, ...(partial?.cardFields || {}) },
    };
    settings.agentView = next;
    writeSettings(settings);
    return next;
  }

  /**
   * Get agent task board settings merged with defaults
   * @returns {{source: {owner: string, number: number}, favorites: string[], order: string[], hidden: string[]}}
   */
  getBoardSettings() {
    const stored = readSettings().board || {};
    return {
      ...DEFAULT_BOARD_SETTINGS,
      ...stored,
      source: { ...DEFAULT_BOARD_SETTINGS.source, ...(stored.source || {}) },
    };
  }

  /**
   * Update board settings (shallow merge of validated partial)
   * @param {object} partial - { source?, favorites?, order?, hidden? }
   * @returns {object} Full updated board settings
   */
  updateBoardSettings(partial) {
    const settings = readSettings();
    const next = { ...this.getBoardSettings(), ...partial };
    settings.board = next;
    writeSettings(settings);
    return next;
  }

  /** @returns {{contexts: object[], activeContextId: string}} */
  getContexts() {
    return projectContexts.listContexts(readSettings());
  }

  /** @param {{name: string, appIds?: string[]|null, boardFilter?: string[]}} input */
  createContext(input) {
    const { settings, context } = projectContexts.createContext(
      readSettings(),
      input,
      randomUUID()
    );
    writeSettings(settings);
    return context;
  }

  updateContext(id, patch) {
    const { settings, context } = projectContexts.updateContext(readSettings(), id, patch);
    writeSettings(settings);
    return context;
  }

  reorderContexts(ids) {
    const settings = projectContexts.reorderContexts(readSettings(), ids);
    writeSettings(settings);
    return projectContexts.listContexts(settings);
  }

  deleteContext(id) {
    const settings = projectContexts.deleteContext(readSettings(), id);
    writeSettings(settings);
    return projectContexts.listContexts(settings);
  }

  /**
   * Switches the active context, parking the client's ui state (agent tabs, rail prefs)
   * @returns {{activeContextId: string, ui: object|null}} ui of the now active context
   */
  activateContext(id, ui, from) {
    const result = projectContexts.activateContext(readSettings(), id, ui, from);
    writeSettings(result.settings);
    return { activeContextId: result.settings.activeContextId, ui: result.ui };
  }
}

// Export singleton instance
export const settingsService = new SettingsService();
export default SettingsService;
