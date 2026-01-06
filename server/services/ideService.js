import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Custom error codes for IDE operations
 */
export const IDEErrorCodes = {
  IDE_NOT_SUPPORTED: 'IDE_NOT_SUPPORTED',
  IDE_NOT_INSTALLED: 'IDE_NOT_INSTALLED',
  INVALID_PROJECT_PATH: 'INVALID_PROJECT_PATH',
  LAUNCH_FAILED: 'LAUNCH_FAILED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
};

/**
 * Custom error class for IDE operations
 */
class IDEError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'IDEError';
    this.code = code;
  }
}

/**
 * IDE Service - Detects and launches external IDEs
 * Supports both built-in IDE detection and custom user-defined IDEs
 */
class IDEService {
  constructor() {
    this.platform = os.platform();
    this.idePaths = this._getIDEPaths();
    this.customIDEs = new Map(); // User-defined custom IDEs
    this.detectionCache = null;
    this.cacheTimestamp = null;
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    this.LAUNCH_VERIFICATION_TIMEOUT = 500; // 500ms to verify IDE launch
    this._loadCustomIDEs();
  }

  /**
   * Load custom IDEs from settings file
   */
  _loadCustomIDEs() {
    try {
      const settingsPath = path.join(process.cwd(), 'data', 'custom-ides.json');
      if (fs.existsSync(settingsPath)) {
        const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        if (data.customIDEs && Array.isArray(data.customIDEs)) {
          data.customIDEs.forEach(ide => {
            this.customIDEs.set(ide.id, ide);
          });
        }
      }
    } catch (error) {
      console.warn('[IDE] Failed to load custom IDEs:', error.message);
    }
  }

  /**
   * Save custom IDEs to settings file
   */
  _saveCustomIDEs() {
    try {
      const settingsPath = path.join(process.cwd(), 'data', 'custom-ides.json');
      const dir = path.dirname(settingsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = { customIDEs: Array.from(this.customIDEs.values()) };
      fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[IDE] Failed to save custom IDEs:', error.message);
    }
  }

  /**
   * Add a custom IDE
   * @param {string} id - Unique identifier
   * @param {string} name - Display name
   * @param {string} idePath - Path to IDE application
   * @returns {Object} Added IDE info
   */
  addCustomIDE(id, name, idePath) {
    const normalizedId = id.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const ide = { id: normalizedId, name, path: idePath, custom: true };
    this.customIDEs.set(normalizedId, ide);
    this._saveCustomIDEs();
    // Invalidate cache
    this.detectionCache = null;
    this.cacheTimestamp = null;
    return ide;
  }

  /**
   * Remove a custom IDE
   * @param {string} id - IDE identifier
   * @returns {boolean} Success
   */
  removeCustomIDE(id) {
    const result = this.customIDEs.delete(id);
    if (result) {
      this._saveCustomIDEs();
      // Invalidate cache
      this.detectionCache = null;
      this.cacheTimestamp = null;
    }
    return result;
  }

  /**
   * Get all custom IDEs
   * @returns {Array} List of custom IDEs
   */
  getCustomIDEs() {
    return Array.from(this.customIDEs.values());
  }

  /**
   * Get IDE paths for current platform
   * Supports environment variables for custom paths:
   * VSCODE_PATH, CURSOR_PATH, WEBSTORM_PATH, etc.
   * @returns {Object} Map of IDE ID to path or command
   */
  _getIDEPaths() {
    const paths = {
      darwin: {
        vscode: process.env.VSCODE_PATH || '/Applications/Visual Studio Code.app',
        cursor: process.env.CURSOR_PATH || '/Applications/Cursor.app',
        antigravity: process.env.ANTIGRAVITY_PATH || '/Applications/Antigravity.app',
        webstorm: process.env.WEBSTORM_PATH || '/Applications/WebStorm.app',
        intellij: process.env.INTELLIJ_PATH || '/Applications/IntelliJ IDEA.app',
        phpstorm: process.env.PHPSTORM_PATH || '/Applications/PhpStorm.app',
        pycharm: process.env.PYCHARM_PATH || '/Applications/PyCharm.app',
        sublime: process.env.SUBLIME_PATH || '/Applications/Sublime Text.app',
        zed: process.env.ZED_PATH || '/Applications/Zed.app',
        fleet: process.env.FLEET_PATH || '/Applications/Fleet.app',
        nova: process.env.NOVA_PATH || '/Applications/Nova.app',
      },
      linux: {
        vscode: process.env.VSCODE_PATH ? [process.env.VSCODE_PATH] : ['/usr/bin/code', '/snap/bin/code', '/var/lib/flatpak/exports/bin/com.visualstudio.code'],
        cursor: process.env.CURSOR_PATH ? [process.env.CURSOR_PATH] : ['/usr/bin/cursor', '/snap/bin/cursor'],
        webstorm: process.env.WEBSTORM_PATH ? [process.env.WEBSTORM_PATH] : ['/usr/local/bin/webstorm', '/snap/bin/webstorm'],
        intellij: process.env.INTELLIJ_PATH ? [process.env.INTELLIJ_PATH] : ['/usr/local/bin/idea', '/snap/bin/intellij-idea-community', '/snap/bin/intellij-idea-ultimate'],
        phpstorm: process.env.PHPSTORM_PATH ? [process.env.PHPSTORM_PATH] : ['/usr/local/bin/phpstorm', '/snap/bin/phpstorm'],
        pycharm: process.env.PYCHARM_PATH ? [process.env.PYCHARM_PATH] : ['/usr/local/bin/pycharm', '/snap/bin/pycharm-community', '/snap/bin/pycharm-professional'],
        sublime: process.env.SUBLIME_PATH ? [process.env.SUBLIME_PATH] : ['/usr/bin/subl', '/snap/bin/sublime-text'],
      },
      win32: {
        vscode: process.env.VSCODE_PATH || 'C:\\Program Files\\Microsoft VS Code\\Code.exe',
        cursor: process.env.CURSOR_PATH || path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Cursor', 'Cursor.exe'),
        webstorm: process.env.WEBSTORM_PATH || 'C:\\Program Files\\JetBrains\\WebStorm\\bin\\webstorm64.exe',
        intellij: process.env.INTELLIJ_PATH || 'C:\\Program Files\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe',
        phpstorm: process.env.PHPSTORM_PATH || 'C:\\Program Files\\JetBrains\\PhpStorm\\bin\\phpstorm64.exe',
        pycharm: process.env.PYCHARM_PATH || 'C:\\Program Files\\JetBrains\\PyCharm\\bin\\pycharm64.exe',
        sublime: process.env.SUBLIME_PATH || 'C:\\Program Files\\Sublime Text\\sublime_text.exe',
      },
    };
    return paths[this.platform] || {};
  }

  /**
   * Get IDE display names
   * @param {string} ideId - IDE identifier
   * @returns {string} Display name
   */
  _getIDEName(ideId) {
    const names = {
      vscode: 'Visual Studio Code',
      cursor: 'Cursor',
      antigravity: 'Antigravity',
      webstorm: 'WebStorm',
      intellij: 'IntelliJ IDEA',
      phpstorm: 'PhpStorm',
      pycharm: 'PyCharm',
      sublime: 'Sublime Text',
      zed: 'Zed',
      fleet: 'Fleet',
      nova: 'Nova',
    };
    // Check custom IDEs for name
    if (this.customIDEs.has(ideId)) {
      return this.customIDEs.get(ideId).name;
    }
    return names[ideId] || ideId;
  }

  /**
   * Check if IDE is installed at given path(s) - uses parallel checks for performance
   * @param {string|string[]} idePath - Path to IDE or array of possible paths
   * @returns {Promise<string|null>} Path if installed, null otherwise
   */
  async _isInstalled(idePath) {
    const paths = Array.isArray(idePath) ? idePath : [idePath];

    // Check all paths in parallel for better performance
    const checks = paths.map(p =>
      fs.promises.access(p, fs.constants.F_OK)
        .then(() => p)
        .catch(() => null)
    );

    const results = await Promise.all(checks);
    return results.find(Boolean) || null;
  }

  /**
   * Detect all installed IDEs on the system (with caching)
   * @param {boolean} forceRefresh - Skip cache and force re-detection
   * @returns {Promise<Array>} List of installed IDEs
   */
  async detectInstalledIDEs(forceRefresh = false) {
    const now = Date.now();

    // Return cached result if valid and not forcing refresh
    if (!forceRefresh && this.detectionCache && this.cacheTimestamp && (now - this.cacheTimestamp < this.CACHE_TTL)) {
      return this.detectionCache;
    }

    // Parallelize IDE detection for better performance
    const checks = Object.entries(this.idePaths).map(async ([ideId, idePath]) => {
      const installedPath = await this._isInstalled(idePath);
      return installedPath ? {
        id: ideId,
        name: this._getIDEName(ideId),
        path: installedPath,
        custom: false,
      } : null;
    });

    const results = await Promise.all(checks);
    const builtInIDEs = results.filter(Boolean);

    // Check custom IDEs
    const customChecks = Array.from(this.customIDEs.values()).map(async (ide) => {
      const installedPath = await this._isInstalled(ide.path);
      return installedPath ? {
        id: ide.id,
        name: ide.name,
        path: installedPath,
        custom: true,
      } : null;
    });

    const customResults = await Promise.all(customChecks);
    const installedCustomIDEs = customResults.filter(Boolean);

    // Combine built-in and custom IDEs
    const allIDEs = [...builtInIDEs, ...installedCustomIDEs];

    // Update cache
    this.detectionCache = allIDEs;
    this.cacheTimestamp = now;

    return allIDEs;
  }

  /**
   * Open project in specified IDE
   * @param {string} projectPath - Path to project directory
   * @param {string} ideId - IDE identifier
   * @returns {Promise<Object>} Result of operation
   */
  async openInIDE(projectPath, ideId) {
    // Check built-in IDEs first, then custom IDEs
    let idePath = this.idePaths[ideId];
    let ideName = this._getIDEName(ideId);

    // Check if it's a custom IDE
    if (!idePath && this.customIDEs.has(ideId)) {
      const customIDE = this.customIDEs.get(ideId);
      idePath = customIDE.path;
      ideName = customIDE.name;
    }

    if (!idePath) {
      throw new IDEError(
        `IDE '${ideId}' is not supported on ${this.platform}`,
        IDEErrorCodes.IDE_NOT_SUPPORTED
      );
    }

    const installedPath = await this._isInstalled(idePath);
    if (!installedPath) {
      const pathStr = Array.isArray(idePath) ? idePath.join(', ') : idePath;
      throw new IDEError(
        `IDE '${ideName}' is not installed. Checked: ${pathStr}`,
        IDEErrorCodes.IDE_NOT_INSTALLED
      );
    }

    // Validate and resolve project path to prevent directory traversal attacks
    const resolvedPath = path.resolve(projectPath);
    const realPath = await fs.promises.realpath(projectPath).catch(() => null);

    if (!realPath) {
      throw new IDEError(
        'Project directory does not exist',
        IDEErrorCodes.INVALID_PROJECT_PATH
      );
    }

    // Verify project path exists and check permissions
    try {
      await fs.promises.access(realPath, fs.constants.F_OK);
    } catch (error) {
      if (error.code === 'EACCES') {
        throw new IDEError(
          'Permission denied: Cannot access project directory',
          IDEErrorCodes.PERMISSION_DENIED
        );
      }
      throw new IDEError(
        'Project directory does not exist',
        IDEErrorCodes.INVALID_PROJECT_PATH
      );
    }

    // Use realPath for launching to ensure we're opening the correct directory
    projectPath = realPath;

    // Use spawn to avoid shell interpretation and prevent command injection
    return new Promise((resolve, reject) => {
      let cmd, args;

      switch (this.platform) {
        case 'darwin':
          cmd = 'open';
          args = ['-a', installedPath, projectPath];
          break;
        case 'linux':
          cmd = installedPath;
          args = [projectPath];
          break;
        case 'win32':
          // Use installedPath directly to avoid shell interpretation
          cmd = installedPath;
          args = [projectPath];
          break;
        default:
          return reject(new Error(`Unsupported platform: ${this.platform}`));
      }

      const child = spawn(cmd, args, {
        detached: true,
        stdio: 'ignore',
      });

      child.on('error', (error) => {
        const errorCode = error.code === 'EACCES' ? IDEErrorCodes.PERMISSION_DENIED : IDEErrorCodes.LAUNCH_FAILED;
        reject(new IDEError(`Failed to launch IDE: ${error.message}`, errorCode));
      });

      // Detach and allow the process to continue independently
      child.unref();

      // Use Promise.race to handle timeout vs immediate exit properly
      const exitPromise = new Promise((resolveExit, rejectExit) => {
        child.on('exit', (code) => {
          if (code !== 0 && code !== null) {
            rejectExit(new IDEError(
              'IDE failed to launch (process exited with error)',
              IDEErrorCodes.LAUNCH_FAILED
            ));
          } else {
            resolveExit();
          }
        });
      });

      const timeoutPromise = new Promise((resolveTimeout) => {
        setTimeout(() => {
          resolveTimeout({
            success: true,
            ide: this._getIDEName(ideId),
            message: `Launched ${this._getIDEName(ideId)} (process started successfully)`,
          });
        }, this.LAUNCH_VERIFICATION_TIMEOUT);
      });

      // Race between timeout and exit - if process exits with error before timeout, we reject
      Promise.race([exitPromise, timeoutPromise])
        .then(result => {
          if (result) {
            resolve(result);
          }
        })
        .catch(err => reject(err));
    });
  }
}

// Export singleton instance
export const ideService = new IDEService();
export default IDEService;
