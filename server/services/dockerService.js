import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Docker Compose Service
 * Provides methods to interact with Docker Compose projects
 */

// Cache for docker command availability
let dockerCommand = null;

/**
 * Get the appropriate docker compose command
 * Returns 'docker compose' (new) or 'docker-compose' (legacy)
 */
async function getDockerComposeCommand() {
  if (dockerCommand !== null) return dockerCommand;

  try {
    await execFileAsync('docker', ['compose', 'version']);
    dockerCommand = { cmd: 'docker', args: ['compose'] };
    return dockerCommand;
  } catch {
    try {
      await execFileAsync('docker-compose', ['--version']);
      dockerCommand = { cmd: 'docker-compose', args: [] };
      return dockerCommand;
    } catch {
      dockerCommand = false;
      return false;
    }
  }
}

/**
 * Run a docker compose command in a project directory
 */
async function runDockerCompose(projectPath, composeArgs, options = {}) {
  const dockerCmd = await getDockerComposeCommand();
  if (!dockerCmd) {
    throw new Error('Docker Compose is not available on this system');
  }

  const args = [...dockerCmd.args, ...composeArgs];
  const execOptions = {
    cwd: projectPath,
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer for logs
    ...options,
  };

  try {
    const { stdout, stderr } = await execFileAsync(dockerCmd.cmd, args, execOptions);
    return { success: true, stdout, stderr };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
    };
  }
}

/**
 * Get list of services defined in docker-compose file
 */
export async function getServices(projectPath) {
  const result = await runDockerCompose(projectPath, ['config', '--services']);
  if (!result.success) {
    return { services: [], error: result.error };
  }

  const services = result.stdout
    .split('\n')
    .filter(line => line.trim())
    .map(name => ({ name, status: 'unknown' }));

  return { services };
}

/**
 * Get status of all containers for a project
 */
export async function getContainerStatus(projectPath) {
  const result = await runDockerCompose(projectPath, [
    'ps',
    '--format', 'json',
  ]);

  if (!result.success) {
    // Try alternative format for older docker-compose versions
    const altResult = await runDockerCompose(projectPath, ['ps']);
    if (!altResult.success) {
      return { containers: [], error: altResult.error };
    }

    // Parse text output (fallback)
    const lines = altResult.stdout.split('\n').slice(1); // Skip header
    const containers = lines
      .filter(line => line.trim())
      .map(line => {
        const parts = line.split(/\s{2,}/);
        return {
          name: parts[0] || 'unknown',
          status: parts[2]?.toLowerCase().includes('up') ? 'running' : 'exited',
          ports: parts[4] || '',
        };
      });

    return { containers };
  }

  try {
    // Parse JSON output (modern docker compose)
    const containers = result.stdout
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          const container = JSON.parse(line);
          return {
            id: container.ID,
            name: container.Name || container.Service,
            service: container.Service,
            status: container.State?.toLowerCase() || 'unknown',
            ports: container.Ports || container.Publishers || '',
            image: container.Image,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    return { containers };
  } catch {
    return { containers: [], error: 'Failed to parse container status' };
  }
}

/**
 * Start all services or a specific service
 */
export async function startServices(projectPath, serviceName = null) {
  const args = ['up', '-d'];
  if (serviceName) {
    args.push(serviceName);
  }

  const result = await runDockerCompose(projectPath, args);
  return {
    success: result.success,
    message: result.success ? 'Services started' : result.error,
    output: result.stdout + result.stderr,
  };
}

/**
 * Stop all services or a specific service
 */
export async function stopServices(projectPath, serviceName = null) {
  const args = ['stop'];
  if (serviceName) {
    args.push(serviceName);
  }

  const result = await runDockerCompose(projectPath, args);
  return {
    success: result.success,
    message: result.success ? 'Services stopped' : result.error,
    output: result.stdout + result.stderr,
  };
}

/**
 * Restart all services or a specific service
 */
export async function restartServices(projectPath, serviceName = null) {
  const args = ['restart'];
  if (serviceName) {
    args.push(serviceName);
  }

  const result = await runDockerCompose(projectPath, args);
  return {
    success: result.success,
    message: result.success ? 'Services restarted' : result.error,
    output: result.stdout + result.stderr,
  };
}

/**
 * Get logs for all services or a specific service
 */
export async function getLogs(projectPath, serviceName = null, tail = 100) {
  const args = ['logs', '--tail', String(tail), '--no-color'];
  if (serviceName) {
    args.push(serviceName);
  }

  const result = await runDockerCompose(projectPath, args);
  return {
    success: result.success,
    logs: result.stdout || result.stderr,
    error: result.success ? null : result.error,
  };
}

/**
 * Pull latest images for all services
 */
export async function pullImages(projectPath) {
  const result = await runDockerCompose(projectPath, ['pull']);
  return {
    success: result.success,
    message: result.success ? 'Images pulled' : result.error,
    output: result.stdout + result.stderr,
  };
}

/**
 * Build images for all services
 */
export async function buildImages(projectPath, serviceName = null) {
  const args = ['build'];
  if (serviceName) {
    args.push(serviceName);
  }

  const result = await runDockerCompose(projectPath, args);
  return {
    success: result.success,
    message: result.success ? 'Images built' : result.error,
    output: result.stdout + result.stderr,
  };
}

/**
 * Remove all containers for a project
 */
export async function removeContainers(projectPath, removeVolumes = false) {
  const args = ['down'];
  if (removeVolumes) {
    args.push('-v');
  }

  const result = await runDockerCompose(projectPath, args);
  return {
    success: result.success,
    message: result.success ? 'Containers removed' : result.error,
    output: result.stdout + result.stderr,
  };
}

/**
 * Check if Docker is available
 */
export async function isDockerAvailable() {
  const cmd = await getDockerComposeCommand();
  return cmd !== false;
}
