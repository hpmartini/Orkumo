import { promises as fs } from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import yaml from 'js-yaml';
import { EventEmitter } from 'events';

const execAsync = promisify(exec);

// Compose file names to look for (in priority order)
const COMPOSE_FILE_NAMES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'docker-compose.dev.yml',
  'docker-compose.dev.yaml',
  'docker-compose.local.yml',
  'docker-compose.local.yaml',
];

/**
 * Docker Compose Service
 * Handles detection, parsing, and management of Docker Compose projects
 */
class DockerComposeService extends EventEmitter {
  constructor() {
    super();
    this.runningProjects = new Map(); // projectPath -> { services, process, logs }
  }

  /**
   * Check if Docker is available
   * @returns {Promise<boolean>}
   */
  async isDockerAvailable() {
    try {
      await execAsync('docker --version');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if Docker Compose is available
   * @returns {Promise<object>} - { available, version, isV2 }
   */
  async isComposeAvailable() {
    try {
      // Try docker compose (v2)
      const { stdout } = await execAsync('docker compose version');
      const version = stdout.match(/v?(\d+\.\d+\.\d+)/)?.[1] || 'unknown';
      return { available: true, version, isV2: true, command: 'docker compose' };
    } catch {
      try {
        // Try docker-compose (v1)
        const { stdout } = await execAsync('docker-compose --version');
        const version = stdout.match(/(\d+\.\d+\.\d+)/)?.[1] || 'unknown';
        return { available: true, version, isV2: false, command: 'docker-compose' };
      } catch {
        return { available: false, version: null, isV2: false, command: null };
      }
    }
  }

  /**
   * Detect if a directory contains a Docker Compose project
   * @param {string} dirPath - Directory to check
   * @returns {Promise<object|null>} - Compose file info or null
   */
  async detectComposeProject(dirPath) {
    for (const fileName of COMPOSE_FILE_NAMES) {
      const filePath = path.join(dirPath, fileName);
      try {
        await fs.access(filePath);
        return {
          path: dirPath,
          composeFile: fileName,
          fullPath: filePath,
        };
      } catch {
        // File doesn't exist, continue
      }
    }
    return null;
  }

  /**
   * Parse a Docker Compose file
   * @param {string} filePath - Path to compose file
   * @returns {Promise<object>} - Parsed compose configuration
   */
  async parseComposeFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = yaml.load(content);

      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid compose file structure');
      }

      const services = this.extractServices(parsed);
      const volumes = this.extractVolumes(parsed);
      const networks = this.extractNetworks(parsed);

      return {
        version: parsed.version || '3',
        services,
        volumes,
        networks,
        raw: parsed,
      };
    } catch (error) {
      console.error(`Failed to parse compose file ${filePath}:`, error);
      throw new Error(`Failed to parse compose file: ${error.message}`);
    }
  }

  /**
   * Extract services from parsed compose config
   * @param {object} parsed - Parsed YAML
   * @returns {object[]} - Array of service objects
   */
  extractServices(parsed) {
    const services = parsed.services || {};
    return Object.entries(services).map(([name, config]) => ({
      name,
      image: config.image,
      build: config.build ? (typeof config.build === 'string' ? config.build : config.build.context) : null,
      ports: this.extractPorts(config.ports),
      volumes: config.volumes || [],
      environment: config.environment || {},
      dependsOn: config.depends_on || [],
      command: config.command,
      healthcheck: config.healthcheck,
      profiles: config.profiles || [],
    }));
  }

  /**
   * Extract port mappings
   * @param {array} ports - Port definitions
   * @returns {object[]} - Normalized port mappings
   */
  extractPorts(ports) {
    if (!ports) return [];

    return ports.map((port) => {
      if (typeof port === 'number') {
        return { host: port, container: port };
      }

      if (typeof port === 'string') {
        // Parse formats like "8080:80", "8080:80/tcp", "127.0.0.1:8080:80"
        const match = port.match(/(?:([^:]+):)?(\d+):(\d+)(?:\/(\w+))?/);
        if (match) {
          return {
            host: parseInt(match[2], 10),
            container: parseInt(match[3], 10),
            ip: match[1] || '0.0.0.0',
            protocol: match[4] || 'tcp',
          };
        }

        // Simple format "8080"
        const simplePort = parseInt(port, 10);
        if (!isNaN(simplePort)) {
          return { host: simplePort, container: simplePort };
        }
      }

      if (typeof port === 'object' && port.target) {
        return {
          host: port.published || port.target,
          container: port.target,
          protocol: port.protocol || 'tcp',
        };
      }

      return null;
    }).filter(Boolean);
  }

  /**
   * Extract volumes from parsed compose config
   * @param {object} parsed - Parsed YAML
   * @returns {object[]} - Array of volume objects
   */
  extractVolumes(parsed) {
    const volumes = parsed.volumes || {};
    return Object.entries(volumes).map(([name, config]) => ({
      name,
      driver: config?.driver,
      external: config?.external || false,
    }));
  }

  /**
   * Extract networks from parsed compose config
   * @param {object} parsed - Parsed YAML
   * @returns {object[]} - Array of network objects
   */
  extractNetworks(parsed) {
    const networks = parsed.networks || {};
    return Object.entries(networks).map(([name, config]) => ({
      name,
      driver: config?.driver,
      external: config?.external || false,
    }));
  }

  /**
   * Get running container status for a compose project
   * @param {string} projectPath - Path to project
   * @returns {Promise<object[]>} - Container statuses
   */
  async getContainerStatus(projectPath) {
    const compose = await this.isComposeAvailable();
    if (!compose.available) {
      throw new Error('Docker Compose is not available');
    }

    try {
      const { stdout } = await execAsync(`${compose.command} ps --format json`, {
        cwd: projectPath,
      });

      // Parse JSON output (may be multiple JSON objects)
      const containers = stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      return containers.map((c) => ({
        id: c.ID,
        name: c.Name,
        service: c.Service,
        state: c.State,
        status: c.Status,
        ports: c.Ports,
        health: c.Health,
      }));
    } catch (error) {
      console.error('Failed to get container status:', error);
      return [];
    }
  }

  /**
   * Start a Docker Compose project
   * @param {string} projectPath - Path to project
   * @param {object} options - Start options
   * @returns {Promise<object>} - Start result
   */
  async composeUp(projectPath, options = {}) {
    const compose = await this.isComposeAvailable();
    if (!compose.available) {
      throw new Error('Docker Compose is not available');
    }

    const {
      detached = true,
      build = false,
      services = [], // specific services to start
      env = {},
    } = options;

    const args = ['up'];
    if (detached) args.push('-d');
    if (build) args.push('--build');
    if (services.length > 0) args.push(...services);

    const cmdParts = compose.command.split(' ');
    const cmd = cmdParts[0];
    const cmdArgs = [...cmdParts.slice(1), ...args];

    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, cmdArgs, {
        cwd: projectPath,
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        this.emit('log', { projectPath, type: 'stdout', data: data.toString() });
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        this.emit('log', { projectPath, type: 'stderr', data: data.toString() });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          this.runningProjects.set(projectPath, { startedAt: new Date() });
          resolve({ success: true, stdout, stderr });
        } else {
          reject(new Error(`docker compose up failed with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Stop a Docker Compose project
   * @param {string} projectPath - Path to project
   * @param {object} options - Stop options
   * @returns {Promise<object>} - Stop result
   */
  async composeDown(projectPath, options = {}) {
    const compose = await this.isComposeAvailable();
    if (!compose.available) {
      throw new Error('Docker Compose is not available');
    }

    const {
      removeVolumes = false,
      removeOrphans = true,
    } = options;

    const args = ['down'];
    if (removeVolumes) args.push('-v');
    if (removeOrphans) args.push('--remove-orphans');

    try {
      const { stdout, stderr } = await execAsync(`${compose.command} ${args.join(' ')}`, {
        cwd: projectPath,
      });

      this.runningProjects.delete(projectPath);
      return { success: true, stdout, stderr };
    } catch (error) {
      throw new Error(`docker compose down failed: ${error.message}`);
    }
  }

  /**
   * Restart a Docker Compose project
   * @param {string} projectPath - Path to project
   * @param {string[]} services - Specific services to restart (optional)
   * @returns {Promise<object>} - Restart result
   */
  async composeRestart(projectPath, services = []) {
    const compose = await this.isComposeAvailable();
    if (!compose.available) {
      throw new Error('Docker Compose is not available');
    }

    const args = ['restart', ...services];

    try {
      const { stdout, stderr } = await execAsync(`${compose.command} ${args.join(' ')}`, {
        cwd: projectPath,
      });
      return { success: true, stdout, stderr };
    } catch (error) {
      throw new Error(`docker compose restart failed: ${error.message}`);
    }
  }

  /**
   * Get logs from a Docker Compose project
   * @param {string} projectPath - Path to project
   * @param {object} options - Log options
   * @returns {AsyncGenerator<string>} - Log stream
   */
  async *composeLogs(projectPath, options = {}) {
    const compose = await this.isComposeAvailable();
    if (!compose.available) {
      throw new Error('Docker Compose is not available');
    }

    const {
      follow = true,
      tail = 100,
      services = [],
    } = options;

    const args = ['logs'];
    if (follow) args.push('-f');
    if (tail) args.push('--tail', tail.toString());
    if (services.length > 0) args.push(...services);

    const cmdParts = compose.command.split(' ');
    const cmd = cmdParts[0];
    const cmdArgs = [...cmdParts.slice(1), ...args];

    const proc = spawn(cmd, cmdArgs, {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const readline = await import('readline');
    const rl = readline.createInterface({ input: proc.stdout });

    for await (const line of rl) {
      yield line;
    }

    proc.kill();
  }

  /**
   * Build images for a Docker Compose project
   * @param {string} projectPath - Path to project
   * @param {string[]} services - Specific services to build
   * @returns {Promise<object>} - Build result
   */
  async composeBuild(projectPath, services = []) {
    const compose = await this.isComposeAvailable();
    if (!compose.available) {
      throw new Error('Docker Compose is not available');
    }

    const args = ['build', ...services];

    return new Promise((resolve, reject) => {
      const cmdParts = compose.command.split(' ');
      const cmd = cmdParts[0];
      const cmdArgs = [...cmdParts.slice(1), ...args];

      const proc = spawn(cmd, cmdArgs, {
        cwd: projectPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        this.emit('build', { projectPath, type: 'stdout', data: data.toString() });
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        this.emit('build', { projectPath, type: 'stderr', data: data.toString() });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, stdout, stderr });
        } else {
          reject(new Error(`docker compose build failed with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Pull images for a Docker Compose project
   * @param {string} projectPath - Path to project
   * @returns {Promise<object>} - Pull result
   */
  async composePull(projectPath) {
    const compose = await this.isComposeAvailable();
    if (!compose.available) {
      throw new Error('Docker Compose is not available');
    }

    try {
      const { stdout, stderr } = await execAsync(`${compose.command} pull`, {
        cwd: projectPath,
      });
      return { success: true, stdout, stderr };
    } catch (error) {
      throw new Error(`docker compose pull failed: ${error.message}`);
    }
  }

  /**
   * Execute command in a running container
   * @param {string} projectPath - Path to project
   * @param {string} service - Service name
   * @param {string} command - Command to execute
   * @returns {Promise<object>} - Exec result
   */
  async composeExec(projectPath, service, command) {
    const compose = await this.isComposeAvailable();
    if (!compose.available) {
      throw new Error('Docker Compose is not available');
    }

    try {
      const { stdout, stderr } = await execAsync(
        `${compose.command} exec -T ${service} ${command}`,
        { cwd: projectPath }
      );
      return { success: true, stdout, stderr };
    } catch (error) {
      throw new Error(`docker compose exec failed: ${error.message}`);
    }
  }

  /**
   * Get all running compose projects
   * @returns {Map} - Running projects
   */
  getRunningProjects() {
    return this.runningProjects;
  }
}

// Singleton instance
export const dockerComposeService = new DockerComposeService();
export default DockerComposeService;
