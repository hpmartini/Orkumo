import net from 'net';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Port Manager Service
 * Handles port availability checking, allocation, and conflict resolution
 */
class PortManager {
  constructor() {
    // Track allocated ports: { appId: port }
    this.allocations = new Map();
    // Default port range for auto-assignment
    this.defaultPortRange = { start: 3000, end: 4000 };
  }

  /**
   * Check if a specific port is available
   * @param {number} port - Port to check
   * @returns {Promise<boolean>} - True if port is available
   */
  async isPortAvailable(port) {
    return new Promise((resolve) => {
      const server = net.createServer();

      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          resolve(false);
        } else {
          resolve(false);
        }
      });

      server.once('listening', () => {
        server.close(() => resolve(true));
      });

      server.listen(port, '127.0.0.1');
    });
  }

  /**
   * Find the next available port in a range
   * @param {number} startPort - Start of port range
   * @param {number} endPort - End of port range
   * @returns {Promise<number|null>} - Available port or null
   */
  async findAvailablePort(startPort = this.defaultPortRange.start, endPort = this.defaultPortRange.end) {
    for (let port = startPort; port <= endPort; port++) {
      const available = await this.isPortAvailable(port);
      if (available) {
        return port;
      }
    }
    return null;
  }

  /**
   * Get information about the process using a port
   * @param {number} port - Port to check
   * @returns {Promise<object|null>} - Process info or null
   */
  async getProcessOnPort(port) {
    try {
      // macOS / Linux command
      const { stdout } = await execAsync(`lsof -i :${port} -sTCP:LISTEN -t 2>/dev/null`);
      const pid = parseInt(stdout.trim(), 10);

      if (isNaN(pid)) {
        return null;
      }

      // Get process name
      const { stdout: psOutput } = await execAsync(`ps -p ${pid} -o comm= 2>/dev/null`);
      const processName = psOutput.trim();

      // Check if this is a DevOrbit managed app
      const appId = this.getAppIdByPort(port);

      return {
        pid,
        name: processName,
        port,
        isDevOrbitApp: !!appId,
        appId,
      };
    } catch (error) {
      // Port is not in use or command failed
      return null;
    }
  }

  /**
   * Allocate a port for an app
   * @param {string} appId - App identifier
   * @param {number} preferredPort - Preferred port (optional)
   * @returns {Promise<object>} - Allocation result
   */
  async allocatePort(appId, preferredPort = null) {
    // If app already has a port allocated, return it
    if (this.allocations.has(appId)) {
      const existingPort = this.allocations.get(appId);
      const available = await this.isPortAvailable(existingPort);
      if (available) {
        return {
          success: true,
          port: existingPort,
          wasPreferred: true,
        };
      }
    }

    // Try preferred port
    if (preferredPort) {
      const available = await this.isPortAvailable(preferredPort);
      if (available) {
        this.allocations.set(appId, preferredPort);
        return {
          success: true,
          port: preferredPort,
          wasPreferred: true,
        };
      }

      // Port is in use - get conflict info
      const conflictInfo = await this.getProcessOnPort(preferredPort);

      // Find alternative
      const alternativePort = await this.findAvailablePort(preferredPort + 1);

      return {
        success: false,
        requestedPort: preferredPort,
        conflict: conflictInfo,
        suggestedPort: alternativePort,
        message: `Port ${preferredPort} is in use by ${conflictInfo?.name || 'unknown process'}`,
      };
    }

    // Find any available port
    const port = await this.findAvailablePort();
    if (port) {
      this.allocations.set(appId, port);
      return {
        success: true,
        port,
        wasPreferred: false,
      };
    }

    return {
      success: false,
      message: 'No available ports in the configured range',
    };
  }

  /**
   * Release a port allocation
   * @param {string} appId - App identifier
   */
  releasePort(appId) {
    this.allocations.delete(appId);
  }

  /**
   * Get app ID by allocated port
   * @param {number} port - Port to lookup
   * @returns {string|null} - App ID or null
   */
  getAppIdByPort(port) {
    for (const [appId, allocatedPort] of this.allocations) {
      if (allocatedPort === port) {
        return appId;
      }
    }
    return null;
  }

  /**
   * Kill process on a specific port
   * @param {number} port - Port to free
   * @returns {Promise<object>} - Result
   */
  async killProcessOnPort(port) {
    try {
      const processInfo = await this.getProcessOnPort(port);
      if (!processInfo) {
        return { success: true, message: 'No process found on port' };
      }

      // Kill the process
      await execAsync(`kill -9 ${processInfo.pid}`);

      // Wait a moment for port to be released
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify port is now free
      const available = await this.isPortAvailable(port);

      return {
        success: available,
        killedProcess: processInfo,
        message: available
          ? `Successfully killed process ${processInfo.name} (PID: ${processInfo.pid})`
          : 'Process killed but port still in use',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Scan a range of ports and return status
   * @param {number} startPort - Start of range
   * @param {number} endPort - End of range
   * @returns {Promise<object[]>} - Port statuses
   */
  async scanPortRange(startPort = 3000, endPort = 3100) {
    const results = [];

    for (let port = startPort; port <= endPort; port++) {
      const available = await this.isPortAvailable(port);
      if (!available) {
        const processInfo = await this.getProcessOnPort(port);
        results.push({
          port,
          available: false,
          process: processInfo,
        });
      }
    }

    return results;
  }

  /**
   * Get all current port allocations
   * @returns {object[]} - List of allocations
   */
  getAllocations() {
    return Array.from(this.allocations.entries()).map(([appId, port]) => ({
      appId,
      port,
    }));
  }

  /**
   * Set port range for auto-assignment
   * @param {number} start - Start port
   * @param {number} end - End port
   */
  setPortRange(start, end) {
    this.defaultPortRange = { start, end };
  }
}

// Singleton instance
export const portManager = new PortManager();
export default PortManager;
