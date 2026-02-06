import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import yaml from 'js-yaml';
import { getConfig } from './configService.js';

/**
 * Generate a unique ID from a project path using hash
 */
function generateProjectId(projectPath) {
  return crypto.createHash('sha256').update(projectPath).digest('hex').slice(0, 16);
}

// Docker Compose file names to check (in priority order)
const DOCKER_COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
];

/**
 * Check if Docker/Docker Compose is available on the system
 * Uses execFileSync for safety (no shell injection risk)
 */
let dockerAvailable = null;
function isDockerAvailable() {
  if (dockerAvailable !== null) return dockerAvailable;

  try {
    // Try 'docker compose' (new syntax) first
    execFileSync('docker', ['compose', 'version'], { stdio: 'ignore' });
    dockerAvailable = 'docker compose';
    return dockerAvailable;
  } catch {
    try {
      // Fallback to 'docker-compose' (old syntax)
      execFileSync('docker-compose', ['--version'], { stdio: 'ignore' });
      dockerAvailable = 'docker-compose';
      return dockerAvailable;
    } catch {
      dockerAvailable = false;
      return false;
    }
  }
}

/**
 * Find Docker Compose file in a directory
 */
function findDockerComposeFile(dirPath) {
  for (const filename of DOCKER_COMPOSE_FILES) {
    const filePath = path.join(dirPath, filename);
    if (fs.existsSync(filePath)) {
      return { filename, filePath };
    }
  }
  return null;
}

/**
 * Parse Docker Compose file to extract service names
 */
function parseDockerComposeServices(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const compose = yaml.load(content);

    if (!compose || !compose.services) {
      return [];
    }

    return Object.keys(compose.services).map(serviceName => {
      const service = compose.services[serviceName];
      return {
        name: serviceName,
        image: service.image || null,
        ports: service.ports || [],
        status: 'unknown',
      };
    });
  } catch (error) {
    console.error(`Error parsing Docker Compose file ${filePath}:`, error.message);
    return [];
  }
}

/**
 * Scan a directory for Docker Compose project
 */
function scanDockerComposeProject(projectPath) {
  const composeFile = findDockerComposeFile(projectPath);
  if (!composeFile) return null;

  const dockerCmd = isDockerAvailable();
  if (!dockerCmd) {
    console.log(`[Scanner] Docker not available, skipping Docker Compose project at ${projectPath}`);
    return null;
  }

  const services = parseDockerComposeServices(composeFile.filePath);

  // Detect port from first service with ports exposed
  let port = null;
  for (const service of services) {
    if (service.ports && service.ports.length > 0) {
      // Parse port mapping (e.g., "3000:3000" or "8080:80")
      const portMapping = String(service.ports[0]);
      const match = portMapping.match(/^(\d+)(?::\d+)?$/);
      if (match) {
        port = parseInt(match[1], 10);
        break;
      }
    }
  }

  return {
    id: generateProjectId(projectPath),
    name: path.basename(projectPath),
    path: projectPath,
    type: 'docker-compose',
    port: port || 8080,
    startCommand: `${dockerCmd} up`,
    detectedFramework: 'Docker Compose',
    dockerComposeFile: composeFile.filename,
    dockerServices: services,
  };
}

/**
 * Detect the project type from package.json
 */
function detectProjectType(packageJson) {
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  if (deps['next']) return { type: 'next', framework: 'Next.js' };
  if (deps['vite']) return { type: 'vite', framework: 'Vite' };
  if (deps['@vitejs/plugin-react']) return { type: 'vite', framework: 'React + Vite' };
  if (deps['react-scripts']) return { type: 'cra', framework: 'Create React App' };
  if (deps['vue']) return { type: 'vue', framework: 'Vue.js' };
  if (deps['nuxt']) return { type: 'nuxt', framework: 'Nuxt' };
  if (deps['express']) return { type: 'node', framework: 'Express' };
  if (deps['fastify']) return { type: 'node', framework: 'Fastify' };
  if (deps['koa']) return { type: 'node', framework: 'Koa' };
  if (deps['nest']) return { type: 'node', framework: 'NestJS' };
  if (packageJson.scripts?.start) return { type: 'node', framework: 'Node.js' };

  return { type: 'unknown', framework: 'Unknown' };
}

/**
 * Detect the start command from package.json
 */
function detectStartCommand(packageJson, projectType) {
  const scripts = packageJson.scripts || {};

  // Priority order for dev commands
  const devCommands = ['dev', 'start:dev', 'serve', 'develop'];
  for (const cmd of devCommands) {
    if (scripts[cmd]) return `npm run ${cmd}`;
  }

  if (scripts.start) return 'npm start';

  // Fallback based on project type
  switch (projectType) {
    case 'next': return 'npm run dev';
    case 'vite': return 'npm run dev';
    case 'cra': return 'npm start';
    default: return 'npm start';
  }
}

/**
 * Detect the likely port from package.json scripts or config
 */
function detectPort(packageJson, projectType) {
  const scripts = packageJson.scripts || {};
  const devScript = scripts.dev || scripts.start || '';

  // Check for explicit port in scripts
  const portMatch = devScript.match(/--port[=\s]+(\d+)|-p[=\s]+(\d+)|PORT[=\s]+(\d+)/i);
  if (portMatch) {
    return parseInt(portMatch[1] || portMatch[2] || portMatch[3], 10);
  }

  // Default ports by framework
  switch (projectType) {
    case 'next': return 3000;
    case 'vite': return 5173;
    case 'cra': return 3000;
    case 'vue': return 8080;
    case 'nuxt': return 3000;
    case 'node': return 3000;
    default: return 3000;
  }
}

/**
 * Scan a single directory for project info
 */
function scanProject(projectPath) {
  const packageJsonPath = path.join(projectPath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const { type, framework } = detectProjectType(packageJson);
    const startCommand = detectStartCommand(packageJson, type);
    const port = detectPort(packageJson, type);

    return {
      id: generateProjectId(projectPath),
      name: packageJson.name || path.basename(projectPath),
      path: projectPath,
      type,
      port,
      startCommand,
      detectedFramework: framework,
      packageJson: {
        name: packageJson.name,
        version: packageJson.version,
        scripts: packageJson.scripts,
      },
    };
  } catch (error) {
    console.error(`Error scanning ${projectPath}:`, error.message);
    return null;
  }
}

/**
 * Recursively scan directories for projects
 */
function scanDirectoryRecursive(dirPath, depth, maxDepth, excludePatterns) {
  if (depth > maxDepth) return [];

  const projects = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    // Check if this directory is a Node.js project (has package.json)
    if (entries.some(e => e.name === 'package.json' && e.isFile())) {
      const project = scanProject(dirPath);
      if (project) {
        projects.push(project);
        return projects; // Don't scan subdirectories of a project
      }
    }

    // Check if this directory is a Docker Compose project
    const hasDockerCompose = DOCKER_COMPOSE_FILES.some(
      filename => entries.some(e => e.name === filename && e.isFile())
    );
    if (hasDockerCompose) {
      const dockerProject = scanDockerComposeProject(dirPath);
      if (dockerProject) {
        projects.push(dockerProject);
        return projects; // Don't scan subdirectories of a Docker project
      }
    }

    // Scan subdirectories
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (excludePatterns.some(p => entry.name === p || entry.name.startsWith('.'))) continue;

      const subPath = path.join(dirPath, entry.name);
      projects.push(...scanDirectoryRecursive(subPath, depth + 1, maxDepth, excludePatterns));
    }
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error.message);
  }

  return projects;
}

/**
 * Scan all configured directories for projects
 */
export function scanAllDirectories() {
  const config = getConfig();
  const allProjects = [];

  for (const dir of config.directories) {
    if (fs.existsSync(dir)) {
      const projects = scanDirectoryRecursive(dir, 0, config.scanDepth, config.excludePatterns);
      allProjects.push(...projects);
    }
  }

  // Add default stats structure
  return allProjects.map(project => ({
    ...project,
    status: 'STOPPED',
    uptime: 0,
    logs: [],
    stats: {
      cpu: Array(20).fill(0),
      memory: Array(20).fill(0),
    },
    addresses: [`http://localhost:${project.port}`],
  }));
}

/**
 * Scan a specific directory
 */
export function scanDirectory(dirPath) {
  const config = getConfig();

  if (!fs.existsSync(dirPath)) {
    throw new Error(`Directory does not exist: ${dirPath}`);
  }

  return scanDirectoryRecursive(dirPath, 0, config.scanDepth, config.excludePatterns);
}
