import { exec } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
   * @returns {Object} Map of IDE ID to path
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
        vscode: '/usr/bin/code',
        cursor: '/usr/bin/cursor',
        webstorm: '/usr/local/bin/webstorm',
        intellij: '/usr/local/bin/idea',
        phpstorm: '/usr/local/bin/phpstorm',
        pycharm: '/usr/local/bin/pycharm',
        sublime: '/usr/bin/subl',
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
   * Check if IDE is installed at given path
   * @param {string} idePath - Path to IDE
   * @returns {Promise<boolean>} Whether IDE is installed
   */
  async _isInstalled(idePath) {
    try {
      await fs.promises.access(idePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Detect all installed IDEs on the system
   * @returns {Promise<Array>} List of installed IDEs
   */
  async detectInstalledIDEs() {
    const installed = [];

    for (const [ideId, idePath] of Object.entries(this.idePaths)) {
      if (await this._isInstalled(idePath)) {
        installed.push({
          id: ideId,
          name: this._getIDEName(ideId),
          path: idePath,
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
      throw new Error(`IDE ${ideId} is not configured for platform ${this.platform}`);
    }

    if (!(await this._isInstalled(idePath))) {
      throw new Error(`IDE ${ideId} is not installed at ${idePath}`);
    }

    // Verify project path exists
    try {
      await fs.promises.access(projectPath, fs.constants.F_OK);
    } catch {
      throw new Error(`Project path does not exist: ${projectPath}`);
    }

    let command;
    switch (this.platform) {
      case 'darwin':
        command = `open -a "${idePath}" "${projectPath}"`;
        break;
      case 'linux':
        command = `"${idePath}" "${projectPath}"`;
        break;
      case 'win32':
        command = `start "" "${idePath}" "${projectPath}"`;
        break;
      default:
        throw new Error(`Unsupported platform: ${this.platform}`);
    }

    try {
      const { stdout, stderr } = await execAsync(command);
      return {
        success: true,
        ide: this._getIDEName(ideId),
        stdout,
        stderr,
      };
    } catch (error) {
      throw new Error(`Failed to open IDE: ${error.message}`);
    }
  }
}

// Export singleton instance
export const ideService = new IDEService();
export default IDEService;
