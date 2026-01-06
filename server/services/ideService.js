import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * IDE Service - Detects and launches external IDEs
 */
class IDEService {
  constructor() {
    this.platform = os.platform();
    this.idePaths = this._getIDEPaths();
  }

  /**
   * Get IDE paths for current platform
   * @returns {Object} Map of IDE ID to path or command
   */
  _getIDEPaths() {
    const paths = {
      darwin: {
        vscode: '/Applications/Visual Studio Code.app',
        cursor: '/Applications/Cursor.app',
        webstorm: '/Applications/WebStorm.app',
        intellij: '/Applications/IntelliJ IDEA.app',
        phpstorm: '/Applications/PhpStorm.app',
        pycharm: '/Applications/PyCharm.app',
        sublime: '/Applications/Sublime Text.app',
      },
      linux: {
        vscode: ['/usr/bin/code', '/snap/bin/code', '/var/lib/flatpak/exports/bin/com.visualstudio.code'],
        cursor: ['/usr/bin/cursor', '/snap/bin/cursor'],
        webstorm: ['/usr/local/bin/webstorm', '/snap/bin/webstorm'],
        intellij: ['/usr/local/bin/idea', '/snap/bin/intellij-idea-community', '/snap/bin/intellij-idea-ultimate'],
        phpstorm: ['/usr/local/bin/phpstorm', '/snap/bin/phpstorm'],
        pycharm: ['/usr/local/bin/pycharm', '/snap/bin/pycharm-community', '/snap/bin/pycharm-professional'],
        sublime: ['/usr/bin/subl', '/snap/bin/sublime-text'],
      },
      win32: {
        vscode: 'C:\\Program Files\\Microsoft VS Code\\Code.exe',
        cursor: path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Cursor', 'Cursor.exe'),
        webstorm: 'C:\\Program Files\\JetBrains\\WebStorm\\bin\\webstorm64.exe',
        intellij: 'C:\\Program Files\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe',
        phpstorm: 'C:\\Program Files\\JetBrains\\PhpStorm\\bin\\phpstorm64.exe',
        pycharm: 'C:\\Program Files\\JetBrains\\PyCharm\\bin\\pycharm64.exe',
        sublime: 'C:\\Program Files\\Sublime Text\\sublime_text.exe',
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
      webstorm: 'WebStorm',
      intellij: 'IntelliJ IDEA',
      phpstorm: 'PhpStorm',
      pycharm: 'PyCharm',
      sublime: 'Sublime Text',
    };
    return names[ideId] || ideId;
  }

  /**
   * Check if IDE is installed at given path(s)
   * @param {string|string[]} idePath - Path to IDE or array of possible paths
   * @returns {Promise<string|null>} Path if installed, null otherwise
   */
  async _isInstalled(idePath) {
    const paths = Array.isArray(idePath) ? idePath : [idePath];

    for (const p of paths) {
      try {
        await fs.promises.access(p, fs.constants.F_OK);
        return p; // Return the first valid path
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * Detect all installed IDEs on the system
   * @returns {Promise<Array>} List of installed IDEs
   */
  async detectInstalledIDEs() {
    const installed = [];

    for (const [ideId, idePath] of Object.entries(this.idePaths)) {
      const installedPath = await this._isInstalled(idePath);
      if (installedPath) {
        installed.push({
          id: ideId,
          name: this._getIDEName(ideId),
          path: installedPath,
        });
      }
    }

    return installed;
  }

  /**
   * Open project in specified IDE
   * @param {string} projectPath - Path to project directory
   * @param {string} ideId - IDE identifier
   * @returns {Promise<Object>} Result of operation
   */
  async openInIDE(projectPath, ideId) {
    const idePath = this.idePaths[ideId];

    if (!idePath) {
      throw new Error(`IDE '${ideId}' is not supported on ${this.platform}`);
    }

    const installedPath = await this._isInstalled(idePath);
    if (!installedPath) {
      const pathStr = Array.isArray(idePath) ? idePath.join(', ') : idePath;
      throw new Error(`IDE '${this._getIDEName(ideId)}' is not installed. Checked: ${pathStr}`);
    }

    // Verify project path exists
    try {
      await fs.promises.access(projectPath, fs.constants.F_OK);
    } catch {
      throw new Error(`Project directory does not exist: ${projectPath}`);
    }

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
        reject(new Error(`Failed to launch IDE: ${error.message}`));
      });

      // Detach and allow the process to continue independently
      child.unref();

      // Assume success if no immediate error
      setTimeout(() => {
        resolve({
          success: true,
          ide: this._getIDEName(ideId),
          message: `Successfully opened project in ${this._getIDEName(ideId)}`,
        });
      }, 100);
    });
  }
}

// Export singleton instance
export const ideService = new IDEService();
export default IDEService;
