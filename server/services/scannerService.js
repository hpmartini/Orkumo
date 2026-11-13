import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { execFileSync } from 'child_process';
import yaml from 'js-yaml';
import { getConfig, canonicalDir, validatePath } from './configService.js';
import { FRAMEWORK_PORTS } from '../../config/defaults.js';

/**
 * Generate a unique ID from a project path using hash
 */
export function generateProjectId(projectPath) {
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

    return Object.keys(compose.services).map((serviceName) => {
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
    console.log(
      `[Scanner] Docker not available, skipping Docker Compose project at ${projectPath}`
    );
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

  // Default ports by framework from centralized config
  return FRAMEWORK_PORTS[projectType] || FRAMEWORK_PORTS.default;
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
    const port = detectPort(packageJson, type);

    return {
      id: generateProjectId(projectPath),
      name: packageJson.name || path.basename(projectPath),
      path: projectPath,
      type,
      port,
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

/** `child` is `parent` or lies below it (callers lower-case both for macOS) */
const isInsidePath = (child, parent) =>
  child === parent || child.startsWith(parent.replace(/\/+$/, '') + '/');

/** Main checkout of a git common dir: "<main>/.git" -> "<main>", a bare repo stays itself */
export function mainCheckoutOf(commonDir) {
  const common = path.resolve(commonDir);
  return path.basename(common) === '.git' ? path.dirname(common) : common;
}

/**
 * Git identity of a directory from the file system alone (the scan is synchronous, no spawn).
 * A `.git` directory marks a main checkout. A `.git` file whose git dir names a `commondir` is a
 * linked worktree; its root is the main checkout. A `.git` file without one (submodule,
 * --separate-git-dir) is its own root.
 * @returns {{root: string, worktreeOf: string|null, worktreePath: string|null}|null} null: no repo
 */
export function gitRootInfo(dir) {
  const dotGit = path.join(dir, '.git');
  let stat;
  try {
    stat = fs.statSync(dotGit);
  } catch {
    return null;
  }
  if (stat.isDirectory()) return { root: dir, worktreeOf: null, worktreePath: null };
  let gitDir;
  try {
    const match = fs.readFileSync(dotGit, 'utf-8').match(/^gitdir:\s*(.+)$/m);
    if (!match) return null;
    gitDir = path.resolve(dir, match[1].trim());
  } catch {
    return null;
  }
  // Metadata removed by `git worktree prune`: a dead checkout, no repo
  if (!fs.existsSync(gitDir)) return null;
  let commonDir;
  try {
    commonDir = fs.readFileSync(path.join(gitDir, 'commondir'), 'utf-8').trim();
  } catch {
    return { root: dir, worktreeOf: null, worktreePath: null };
  }
  const main = mainCheckoutOf(path.resolve(gitDir, commonDir));
  return { root: main, worktreeOf: main, worktreePath: dir };
}

/**
 * Linked worktrees git keeps for a main checkout (`.git/worktrees/<name>/gitdir` names
 * "<worktree>/.git"), wherever they live. Deleted but unpruned ones stay listed, so sessions
 * that ran there still find their project.
 */
export function registeredWorktrees(root) {
  const dir = path.join(root, '.git', 'worktrees');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const worktrees = [];
  for (const name of names) {
    try {
      const gitFile = fs.readFileSync(path.join(dir, name, 'gitdir'), 'utf-8').trim();
      if (gitFile) worktrees.push(path.dirname(path.resolve(dir, name, gitFile)));
    } catch {
      // Half-written or foreign entry
    }
  }
  return worktrees;
}

/**
 * Collect git repos below a directory. Only a `.git` entry makes a project: package.json or
 * compose folders without one are no projects. A linked worktree is noted for its main repo and
 * not descended into; inside a repo only nested `.git` directories count (submodules belong to it).
 */
function scanDirectoryRecursive(dirPath, depth, maxDepth, excludePatterns, found, inRepo = false) {
  if (depth > maxDepth) return;

  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error.message);
    return;
  }

  const dotGit = entries.find((e) => e.name === '.git');
  if (dotGit?.isFile()) {
    const info = gitRootInfo(dirPath);
    if (info?.worktreeOf) found.worktrees.push(info);
    else if (info && !inRepo) found.repos.push(dirPath);
    return;
  }
  if (dotGit?.isDirectory()) {
    found.repos.push(dirPath);
    inRepo = true;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (excludePatterns.some((p) => entry.name === p || entry.name.startsWith('.'))) continue;
    scanDirectoryRecursive(
      path.join(dirPath, entry.name),
      depth + 1,
      maxDepth,
      excludePatterns,
      found,
      inRepo
    );
  }
}

/** Git repo without a detected start command: listed, but not runnable until one is set */
function gitRepoProject(projectPath) {
  return {
    id: generateProjectId(projectPath),
    name: path.basename(projectPath),
    path: projectPath,
    type: 'unknown',
    detectedFramework: 'Git',
  };
}

/** A main checkout as a project; package.json / compose only describe it, its worktrees join it */
function repoProject(projectPath) {
  return {
    ...gitRepoProject(projectPath),
    ...(scanProject(projectPath) || scanDockerComposeProject(projectPath)),
    worktrees: registeredWorktrees(projectPath),
  };
}

const JOBS_DIR = path.join(
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
  'jobs'
);

/** Main checkout of a worktree path, mirrors mainRepoPath in utils/agentSessions.ts */
const mainRepoPath = (dir) =>
  dir.match(/^(.+?)\/(?:\.claude\/worktrees|\.worktrees)(?:\/|$)/)?.[1] ?? dir;

/**
 * Main repos background agents ran in, read from the jobs' state.json.
 * shortcut: interactive sessions are not covered, add them if their repos show up missing.
 */
export function agentRepoPaths(jobsDir = JOBS_DIR) {
  let entries = [];
  try {
    entries = fs.readdirSync(jobsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const repos = new Set();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const state = JSON.parse(
        fs.readFileSync(path.join(jobsDir, entry.name, 'state.json'), 'utf-8')
      );
      const dir = state.worktree || state.worktreePath || state.cwd;
      if (typeof dir === 'string' && path.isAbsolute(dir))
        repos.add(gitRootInfo(dir)?.root ?? mainRepoPath(dir));
    } catch {
      // Job without readable state
    }
  }
  return [...repos];
}

/**
 * Add main repos no scanned project covers: agent repos (#133) and the main checkouts of
 * worktrees found in the scan. Paths compare case-insensitively (macOS); a repo inside a scanned
 * project belongs to that project; only main checkouts (a `.git` directory) are added.
 */
export function mergeAgentRepos(projects, repoPaths) {
  const known = projects.map((p) => p.path.toLowerCase());
  const added = [];
  for (const repo of repoPaths) {
    const lower = repo.toLowerCase();
    if (known.some((k) => isInsidePath(lower, k))) continue;
    const info = gitRootInfo(repo);
    if (!info || info.worktreeOf) continue;
    known.push(lower);
    added.push(repoProject(canonicalDir(repo)));
  }
  return [...projects, ...added];
}

/**
 * Scan all configured directories for projects: git main checkouts, each with its worktrees.
 * Ids are the hash of the main checkout's path, so contexts, favorites and overrides keep matching.
 */
export function scanAllDirectories() {
  const config = getConfig();
  const found = { repos: [], worktrees: [] };
  for (const dir of config.directories) {
    if (fs.existsSync(dir))
      scanDirectoryRecursive(dir, 0, config.scanDepth, config.excludePatterns, found);
  }
  // Overlapping scan directories find a repo twice
  const seen = new Set();
  const repos = found.repos.filter((p) => !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()));
  const mains = found.worktrees.map((w) => w.worktreeOf);

  return mergeAgentRepos(repos.map(repoProject), [...mains, ...agentRepoPaths()]).map(
    (project) => ({
      ...project,
      addresses: project.port ? [`http://localhost:${project.port}`] : [],
    })
  );
}

/**
 * Scan a specific directory
 */
export function scanDirectory(dirPath) {
  const config = getConfig();

  if (!fs.existsSync(dirPath)) {
    throw new Error(`Directory does not exist: ${dirPath}`);
  }

  const found = { repos: [], worktrees: [] };
  scanDirectoryRecursive(dirPath, 0, config.scanDepth, config.excludePatterns, found);
  return found.repos.map(repoProject);
}

// ---------------------------------------------------------------------
// User overrides (settings.json, keyed by project id): `archived` disables a project,
// `projectMerges` {sourceId: targetId} folds one into another, `customProjects` adds git roots
// the scan does not find, `customNames` renames detected ones.
// ---------------------------------------------------------------------

function customProject({ id, name, paths }) {
  return {
    id,
    name,
    path: paths[0],
    paths,
    worktrees: paths.flatMap(registeredWorktrees),
    type: 'unknown',
    detectedFramework: 'Git',
    addresses: [],
    source: 'custom',
  };
}

/**
 * Every project, detected and custom, with its state under the user's overrides.
 * `state`: 'active' | 'disabled' | 'merged'; `mergedInto`: final target id of a merge chain.
 * `detectedName` is the name before a rename; `userNamed` means the user chose the name.
 */
export function projectCatalog(detected, settings = {}) {
  const base = [
    ...detected.map((p) => ({
      ...p,
      paths: [p.path],
      worktrees: p.worktrees || [],
      source: 'detected',
    })),
    ...(settings.customProjects || []).map(customProject),
  ];
  const ids = new Set(base.map((p) => p.id));
  const archived = new Set(settings.archived || []);
  const merges = settings.projectMerges || {};
  const names = settings.customNames || {};
  const finalTarget = (id) => {
    const seen = new Set([id]);
    let target = null;
    for (let next = merges[id]; next && ids.has(next) && !seen.has(next); next = merges[next]) {
      target = next;
      seen.add(next);
    }
    return target;
  };
  return base.map((p) => {
    const mergedInto = finalTarget(p.id);
    const customName = p.source === 'detected' ? names[p.id] : undefined;
    return {
      ...p,
      detectedName: p.name,
      name: customName || p.name,
      userNamed: p.source === 'custom' || Boolean(customName),
      state: archived.has(p.id) ? 'disabled' : mergedInto ? 'merged' : 'active',
      mergedInto,
    };
  });
}

/**
 * The projects the app works with (GET /api/apps): active ones only, renamed, each merged
 * project folded into its target (`paths`, `worktrees`, `mergedIds`). Sources of a disabled
 * target stay hidden with it.
 */
export function applyProjectOverrides(detected, settings = {}) {
  const catalog = projectCatalog(detected, settings);
  const active = new Map(
    catalog
      .filter((p) => p.state === 'active')
      // eslint-disable-next-line no-unused-vars -- state fields are catalog-only
      .map(({ state, mergedInto, ...p }) => [p.id, { ...p, mergedIds: [] }])
  );
  for (const p of catalog) {
    const target = p.state === 'merged' ? active.get(p.mergedInto) : null;
    if (!target) continue;
    target.paths = [...target.paths, ...p.paths];
    target.worktrees = [...target.worktrees, ...p.worktrees];
    target.mergedIds.push(p.id);
  }
  return [...active.values()];
}

/**
 * Project of a session: the one whose path, member path or worktree contains the session's repo
 * root, else its worktree / cwd (covers deleted worktrees git still lists). The most specific
 * entry wins; null when no project contains it.
 */
export function projectIdFor(projects, { root, dirs = [] }) {
  const match = (candidates) => {
    let best = null;
    let bestLength = -1;
    for (const p of projects) {
      for (const entry of [...(p.paths || [p.path]), ...(p.worktrees || [])]) {
        const e = entry.toLowerCase();
        if (e.length > bestLength && candidates.some((c) => isInsidePath(c, e))) {
          best = p.id;
          bestLength = e.length;
        }
      }
    }
    return best;
  };
  const lower = (list) => list.filter(Boolean).map((d) => d.toLowerCase());
  return (root && match(lower([root]))) || match(lower(dirs)) || null;
}

/**
 * A path the user adds as a project must be the root of a git repo (main checkout).
 * @returns {string} the path's on-disk spelling
 * @throws {Error} message names the recovery
 */
export function validateProjectRoot(dirPath) {
  const dir = validatePath(dirPath);
  const info = gitRootInfo(dir);
  if (!info) {
    throw new Error(
      `Not a git repository: ${dir}. Pick the folder that contains the repository's .git.`
    );
  }
  if (info.worktreeOf) {
    throw new Error(
      `${dir} is a worktree of ${info.worktreeOf}. Worktrees belong to their main repository: add ${info.worktreeOf} instead.`
    );
  }
  return dir;
}
