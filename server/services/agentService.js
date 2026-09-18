/**
 * Agent Service - browser-side counterpart of `claude agents` (Claude Code agent view).
 *
 * Wraps the Claude Code CLI (`claude --bg`, `claude agents --json`, `claude logs|stop|respawn|rm`,
 * `claude daemon ...`) and the on-disk session state the CLI keeps under ~/.claude:
 *
 *   ~/.claude/jobs/<id>/state.json   per-session state (name, detail, output, PR links, ...)
 *   ~/.claude/jobs/<id>/order        manual sort position (Shift+Up/Down in the TUI)
 *   ~/.claude/jobs/pins.json         array of pinned session ids (Ctrl+T in the TUI)
 *   ~/.claude/projects/<slug>/*.jsonl transcripts (used for peek fallback and /resume picker)
 *
 * All CLI calls use execFile/spawn with argument arrays - never a shell - so prompts and
 * session ids are passed verbatim without any injection surface.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import * as nodePty from 'node-pty';
import { getConfig } from './configService.js';

export const agentEvents = new EventEmitter();

const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const JOBS_DIR = path.join(CLAUDE_HOME, 'jobs');
const PINS_FILE = path.join(JOBS_DIR, 'pins.json');
const PROJECTS_DIR = path.join(CLAUDE_HOME, 'projects');
const USER_SETTINGS_FILE = path.join(CLAUDE_HOME, 'settings.json');

/** Short session id as printed by `claude --bg` (also used for route validation). */
export const SHORT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;

/**
 * Dispatch options that widen what a background session may do on this machine.
 * They are only forwarded to the CLI when the server was started with
 * DEVORBIT_AGENTS_ALLOW_UNSAFE_FLAGS=true - never on the say-so of a client request.
 */
export const UNSAFE_DISPATCH_FLAGS = [
  'skipPermissions',
  'allowSkipPermissions',
  'settings',
  'mcpConfigs',
  'pluginDirs',
];

export function isUnsafeFlagsAllowed() {
  return process.env.DEVORBIT_AGENTS_ALLOW_UNSAFE_FLAGS === 'true';
}
const MIN_PROMPT_LENGTH = 4;
const CLI_TIMEOUT = 60000;
const POLL_INTERVAL = 2500;
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;

// ---------------------------------------------------------------------------
// CLI resolution
// ---------------------------------------------------------------------------

let cachedClaudeBin = null;

/**
 * Locate the Claude Code binary. Mirrors ptyService.detectClaudeCLI but synchronous.
 * @returns {string|null}
 */
export function resolveClaudeBinary() {
  if (cachedClaudeBin && fs.existsSync(cachedClaudeBin)) return cachedClaudeBin;
  const home = os.homedir();
  const candidates = [
    process.env.CLAUDE_CLI_PATH,
    `${home}/.bun/bin/claude`,
    `${home}/.claude/local/claude`,
    `${home}/.local/bin/claude`,
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude',
  ].filter(Boolean);
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    candidates.push(path.join(dir, os.platform() === 'win32' ? 'claude.cmd' : 'claude'));
  }
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      cachedClaudeBin = candidate;
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Run the claude CLI with an argument array.
 * @param {string[]} args
 * @param {{cwd?: string, timeout?: number, env?: object}} options
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export function runClaude(args, options = {}) {
  const bin = resolveClaudeBinary();
  if (!bin) {
    return Promise.reject(
      new Error(
        'Claude Code CLI not found. Install it with: npm install -g @anthropic-ai/claude-code'
      )
    );
  }
  const cwd = options.cwd && fs.existsSync(options.cwd) ? options.cwd : os.homedir();
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      {
        cwd,
        timeout: options.timeout ?? CLI_TIMEOUT,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, ...options.env, FORCE_HYPERLINK: '0', NO_COLOR: '1' },
      },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || '') + (error && error.killed ? '\n(timed out)' : ''),
        });
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Build the argument list for `claude --bg ...` from dispatch options.
 * @param {object} opts
 * @returns {string[]}
 */
export function buildDispatchArgs(opts = {}) {
  const args = ['--bg'];
  const pushRepeat = (flag, values) => {
    for (const value of Array.isArray(values) ? values : values ? [values] : []) {
      if (typeof value === 'string' && value.trim()) args.push(flag, value.trim());
    }
  };

  if (opts.resume) args.push('--resume', String(opts.resume));
  if (opts.name) args.push('--name', String(opts.name));
  if (opts.agent) args.push('--agent', String(opts.agent));
  if (opts.model) args.push('--model', String(opts.model));
  if (opts.fallbackModel) args.push('--fallback-model', String(opts.fallbackModel));
  if (opts.effort) args.push('--effort', String(opts.effort));
  if (opts.permissionMode) args.push('--permission-mode', String(opts.permissionMode));
  if (opts.skipPermissions) args.push('--dangerously-skip-permissions');
  if (opts.allowSkipPermissions) args.push('--allow-dangerously-skip-permissions');
  if (opts.restricted) args.push('--restricted');
  if (opts.settings) args.push('--settings', String(opts.settings));
  pushRepeat('--add-dir', opts.addDirs);
  pushRepeat('--plugin-dir', opts.pluginDirs);
  pushRepeat('--mcp-config', opts.mcpConfigs);
  if (opts.strictMcpConfig) args.push('--strict-mcp-config');

  if (opts.exec) {
    args.push('--exec', String(opts.exec));
  } else if (opts.prompt) {
    args.push(String(opts.prompt));
  }
  return args;
}

/**
 * Parse the output of `claude --bg` to find the new session id.
 *   backgrounded · a5df1c0f · hello-agent
 * @param {string} output
 * @returns {{id: string|null, name: string|null, alreadyRunning: boolean}}
 */
export function parseDispatchOutput(output) {
  const text = String(output || '');
  const line = text.match(/backgrounded\s*[·:-]\s*([a-z0-9-]+)\s*(?:[·:-]\s*(.*))?/i);
  if (line) {
    return {
      id: line[1],
      name: (line[2] || '').trim() || null,
      alreadyRunning: /already running|copy/i.test(text),
    };
  }
  const attach = text.match(/claude attach\s+([a-z0-9-]+)/i);
  return {
    id: attach ? attach[1] : null,
    name: null,
    alreadyRunning: /already running|copy/i.test(text),
  };
}

/**
 * Parse `claude rm` refusal output for the force flags it suggests.
 * @param {string} output
 */
export function parseRemoveHints(output) {
  const text = String(output || '');
  const discard = text.match(/--discard-unpushed\s+(\S+)/);
  const force = text.match(/--force-remove-worktree\s+(\S+)/);
  return {
    discardUnpushed: discard ? discard[1] : null,
    forceRemoveWorktree: force ? force[1] : null,
  };
}

/**
 * Parse `claude daemon status` output into a small structure.
 * @param {string} output
 */
export function parseDaemonStatus(output) {
  const text = String(output || '');
  const firstLine = text.split('\n').find((l) => l.trim()) || '';
  const running = !/not running/i.test(firstLine);
  const pid = text.match(/pid[:\s]+(\d+)/i);
  const version = text.match(/version[:\s]+([\d.]+)/i);
  const workers = text.match(/(\d+)\s+(?:bg\s+)?workers?/i) || text.match(/workers?:\s*(\d+)/i);
  const mismatch = /different version|update needed|newer|older/i.test(text);
  return {
    running,
    pid: pid ? Number(pid[1]) : null,
    version: version ? version[1] : null,
    workers: workers ? Number(workers[1]) : null,
    versionMismatch: mismatch,
    raw: text.trim(),
  };
}

/**
 * Derive the display state used by the agent view from a session record.
 * @param {object} session
 * @returns {'working'|'needs-input'|'idle'|'completed'|'failed'|'stopped'|'loop'|'interactive'}
 */
export function deriveDisplayState(session) {
  if (!session) return 'idle';
  if (session.kind === 'interactive') return 'interactive';
  if (session.loop && session.state === 'working' && session.tempo === 'idle') return 'loop';
  switch (session.state) {
    case 'working':
      return 'working';
    case 'blocked':
      return 'needs-input';
    case 'failed':
      return 'failed';
    case 'stopped':
      return 'stopped';
    case 'done':
      return session.status === 'idle' || session.pid ? 'idle' : 'completed';
    default:
      return session.status === 'busy' ? 'working' : 'idle';
  }
}

/**
 * Extract PR / MR links from the state.json `children` array.
 */
export function extractPrLinks(children) {
  if (!Array.isArray(children)) return [];
  return children
    .filter(
      (c) =>
        c &&
        typeof c.href === 'string' &&
        (c.kind === 'pr' || /\/(pull|merge_requests)\/\d+/.test(c.href))
    )
    .map((c) => {
      const gh = c.href.match(/\/pull\/(\d+)/);
      const gl = c.href.match(/\/merge_requests\/(\d+)/);
      return {
        id: c.id || c.href,
        href: c.href,
        title: c.title || null,
        number: gh ? Number(gh[1]) : gl ? Number(gl[1]) : null,
        provider: gl ? 'gitlab' : 'github',
        state: c.state || c.status || null,
      };
    });
}

/**
 * Convert a working directory into the transcript folder slug Claude Code uses.
 * @param {string} cwd
 */
export function projectSlug(cwd) {
  return String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Pull a readable text out of a transcript message content field.
 */
function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block) return '';
        if (typeof block === 'string') return block;
        if (block.type === 'text') return block.text || '';
        if (block.type === 'tool_use') return `[tool: ${block.name || 'tool'}]`;
        if (block.type === 'tool_result')
          return typeof block.content === 'string' ? block.content : '[tool result]';
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

// ---------------------------------------------------------------------------
// State files
// ---------------------------------------------------------------------------

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, file);
}

function jobDir(id) {
  if (!SHORT_ID_RE.test(id)) throw new Error('Invalid session id');
  return path.join(JOBS_DIR, id);
}

async function readJobState(id) {
  return readJson(path.join(jobDir(id), 'state.json'), null);
}

async function readPins() {
  const pins = await readJson(PINS_FILE, []);
  return new Set(Array.isArray(pins) ? pins.map(String) : []);
}

async function readOrder(id) {
  try {
    const raw = (await fsp.readFile(path.join(jobDir(id), 'order'), 'utf-8')).trim();
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Read the user's ~/.claude/settings.json (model, effort, permission defaults).
 */
export async function readClaudeUserSettings() {
  const settings = (await readJson(USER_SETTINGS_FILE, {})) || {};
  return {
    model: settings.model || null,
    effortLevel: settings.effortLevel || null,
    permissionMode: settings.permissions?.defaultMode || null,
    disableAgentView:
      settings.disableAgentView === true || process.env.CLAUDE_CODE_DISABLE_AGENT_VIEW === '1',
    leftArrowOpensAgents: settings.leftArrowOpensAgents !== false,
    prefersReducedMotion: settings.prefersReducedMotion === true,
    bgIsolation: settings.worktree?.bgIsolation || 'worktree',
  };
}

// ---------------------------------------------------------------------------
// Path allowlisting (same convention as the file routes in server/index.js)
// ---------------------------------------------------------------------------

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

/**
 * Configured scan directories - the only places sessions may be started in.
 */
export function getAllowedDirectories() {
  try {
    return (getConfig().directories || []).filter((dir) => typeof dir === 'string' && dir.trim());
  } catch {
    return [];
  }
}

/**
 * Resolve a directory and verify it lies inside one of the allowed directories.
 * Symlinks are resolved on both sides so a link cannot escape the allowlist.
 * @param {string} target
 * @param {string[]} allowedDirs
 * @param {string} label - used in error messages
 * @returns {string} real path of the directory
 */
export function assertAllowedPath(target, allowedDirs, label = 'Directory') {
  if (typeof target !== 'string' || !target.trim() || target.includes('\0')) {
    throw forbidden(`${label} is invalid`);
  }
  let real;
  try {
    real = fs.realpathSync(path.resolve(target));
  } catch {
    const error = new Error(`${label} does not exist: ${target}`);
    error.status = 400;
    throw error;
  }
  if (!fs.statSync(real).isDirectory()) {
    const error = new Error(`${label} is not a directory: ${target}`);
    error.status = 400;
    throw error;
  }
  const allowed = (allowedDirs || []).some((dir) => {
    try {
      const realDir = fs.realpathSync(path.resolve(dir));
      return (
        real === realDir ||
        real.startsWith(realDir.endsWith(path.sep) ? realDir : realDir + path.sep)
      );
    } catch {
      return false;
    }
  });
  if (!allowed) {
    throw forbidden(
      `${label} is outside the configured project directories: ${target}. Add it in the admin panel first.`
    );
  }
  return real;
}

/**
 * Validate dispatch options coming from a client:
 * - cwd and every --add-dir must be inside the allowed directories
 * - unsafe flags (bypass permissions, --settings, --mcp-config, --plugin-dir) need the
 *   server-side opt-in DEVORBIT_AGENTS_ALLOW_UNSAFE_FLAGS=true
 * @param {object} opts
 * @param {{allowedDirs: string[], unsafeAllowed: boolean}} context
 * @returns {object} sanitized options with real paths
 */
export function sanitizeDispatchOptions(opts, context) {
  const allowedDirs = context?.allowedDirs || [];
  const unsafeAllowed = context?.unsafeAllowed === true;
  if (allowedDirs.length === 0) {
    throw forbidden(
      'No project directories are configured. Add one in the admin panel before dispatching sessions.'
    );
  }
  const requested = UNSAFE_DISPATCH_FLAGS.filter((flag) => {
    const value = opts[flag];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
  if (requested.length > 0 && !unsafeAllowed) {
    throw forbidden(
      `Option(s) ${requested.join(', ')} are disabled on this server. Start it with DEVORBIT_AGENTS_ALLOW_UNSAFE_FLAGS=true to enable them.`
    );
  }
  const cwd = assertAllowedPath(opts.cwd, allowedDirs, 'Working directory');
  const addDirs = (Array.isArray(opts.addDirs) ? opts.addDirs : [])
    .filter((dir) => typeof dir === 'string' && dir.trim())
    .map((dir) =>
      assertAllowedPath(path.isAbsolute(dir) ? dir : path.join(cwd, dir), allowedDirs, '--add-dir')
    );
  return { ...opts, cwd, addDirs };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * List sessions via `claude agents --json` and enrich background sessions with state.json data.
 * @param {{cwd?: string, all?: boolean}} options
 * @returns {Promise<object[]>}
 */
export async function listSessions(options = {}) {
  const args = ['agents', '--json'];
  if (options.all !== false) args.push('--all');
  if (options.cwd) args.push('--cwd', options.cwd);

  const result = await runClaude(args, { timeout: 20000 });
  let raw = [];
  if (result.code === 0 || result.stdout.trim().startsWith('[')) {
    try {
      const start = result.stdout.indexOf('[');
      raw = JSON.parse(result.stdout.slice(start));
    } catch (error) {
      throw new Error(`Could not parse \`claude agents --json\` output: ${error.message}`);
    }
  } else {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'claude agents --json failed');
  }

  const pins = await readPins();
  const sessions = await Promise.all(
    raw.map(async (entry) => {
      if (entry.kind !== 'background' || !entry.id) {
        return {
          id: `interactive-${entry.pid || entry.sessionId || Math.random().toString(36).slice(2)}`,
          sessionId: entry.sessionId || null,
          kind: 'interactive',
          cwd: entry.cwd,
          startedAt: entry.startedAt,
          name: entry.name || path.basename(entry.cwd || '') || 'interactive',
          status: entry.status || null,
          pid: entry.pid || null,
          state: null,
          waitingFor: entry.waitingFor || null,
          detail: entry.status === 'busy' ? 'working in a terminal' : 'interactive session',
          pinned: false,
          order: null,
          links: [],
          displayState: 'interactive',
        };
      }
      const state = (await readJobState(entry.id)) || {};
      const order = await readOrder(entry.id);
      const outputResult =
        state.output && typeof state.output === 'object'
          ? typeof state.output.result === 'string'
            ? state.output.result
            : JSON.stringify(state.output)
          : typeof state.output === 'string'
            ? state.output
            : null;
      const session = {
        id: entry.id,
        sessionId: entry.sessionId || state.sessionId || null,
        kind: 'background',
        cwd: entry.cwd || state.cwd,
        startedAt: entry.startedAt || (state.createdAt ? Date.parse(state.createdAt) : Date.now()),
        updatedAt: state.updatedAt ? Date.parse(state.updatedAt) : null,
        name: entry.name || state.name || state.intent || entry.id,
        nameSource: state.nameSource || null,
        state: entry.state || state.state || null,
        status: entry.status || null,
        waitingFor: entry.waitingFor || null,
        pid: entry.pid || null,
        detail: state.detail || null,
        tempo: state.tempo || null,
        intent: state.intent || null,
        template: state.template || null,
        agent: state.agent || null,
        result: outputResult,
        suggestedReply: state.suggestedReply || null,
        needsOverlay: state.needsOverlay || null,
        tokens: typeof state.tokens === 'number' ? state.tokens : null,
        inFlight: state.inFlight || null,
        loop: state.routine ? { routine: state.routine } : null,
        respawnFlags: Array.isArray(state.respawnFlags) ? state.respawnFlags : [],
        worktree: state.worktree || state.worktreePath || null,
        transcriptPath: state.linkScanPath || null,
        cliVersion: state.cliVersion || null,
        pinned: pins.has(entry.id),
        order,
        links: extractPrLinks(state.children),
      };
      session.displayState = deriveDisplayState(session);
      return session;
    })
  );
  return sessions;
}

/**
 * Raw JSON as printed by `claude agents --json` (for the "copy JSON" affordance).
 */
export async function rawSessionsJson(options = {}) {
  const args = ['agents', '--json'];
  if (options.all) args.push('--all');
  if (options.cwd) args.push('--cwd', options.cwd);
  const result = await runClaude(args, { timeout: 20000 });
  return result.stdout;
}

async function findSession(id) {
  const sessions = await listSessions({ all: true });
  return sessions.find((s) => s.id === id) || null;
}

// ---------------------------------------------------------------------------
// Dispatch / control
// ---------------------------------------------------------------------------

/**
 * Dispatch a new background session (`claude --bg ...`).
 * @param {object} opts - see buildDispatchArgs, plus cwd
 */
export async function dispatch(opts = {}, context = {}) {
  const prompt = typeof opts.prompt === 'string' ? opts.prompt.trim() : '';
  const exec = typeof opts.exec === 'string' ? opts.exec.trim() : '';
  if (!exec && !opts.resume && prompt.length < MIN_PROMPT_LENGTH) {
    const error = new Error('Too short');
    error.status = 400;
    throw error;
  }
  const safe = sanitizeDispatchOptions(opts, {
    allowedDirs: context.allowedDirs || getAllowedDirectories(),
    unsafeAllowed: context.unsafeAllowed ?? isUnsafeFlagsAllowed(),
  });
  const cwd = safe.cwd;
  const args = buildDispatchArgs({ ...safe, prompt, exec });
  const result = await runClaude(args, { cwd, timeout: 90000 });
  const parsed = parseDispatchOutput(`${result.stdout}\n${result.stderr}`);
  if (result.code !== 0 && !parsed.id) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'Dispatch failed');
  }
  if (!parsed.id) {
    throw new Error(`Session id not found in CLI output: ${result.stdout.trim()}`);
  }
  triggerRefresh();
  return {
    id: parsed.id,
    name: parsed.name,
    alreadyRunning: parsed.alreadyRunning,
    output: result.stdout.trim(),
  };
}

/**
 * Recent terminal output of a session (`claude logs <id>`), falling back to the transcript
 * when the worker process has exited (the CLI then reports "job not found").
 */
export async function getLogs(id, options = {}) {
  jobDir(id);
  const result = await runClaude(['logs', id], { timeout: 15000 });
  const failed =
    result.code !== 0 ||
    /Couldn't read logs|job not found|unreachable/i.test(result.stdout + result.stderr);
  if (!failed && result.stdout.trim()) {
    return { source: 'logs', text: result.stdout, entries: [] };
  }
  const transcript = await getTranscriptTail(id, options.lines || 40);
  return {
    source: 'transcript',
    text: transcript.entries.map((e) => `${e.role === 'user' ? '❯' : '●'} ${e.text}`).join('\n\n'),
    entries: transcript.entries,
    note: (result.stdout + result.stderr).trim() || null,
  };
}

/**
 * Last N user/assistant messages from a session transcript.
 */
export async function getTranscriptTail(id, limit = 40) {
  const state = (await readJobState(id)) || {};
  let file = state.linkScanPath;
  if (!file || !fs.existsSync(file)) {
    if (state.sessionId && state.cwd) {
      const candidate = path.join(PROJECTS_DIR, projectSlug(state.cwd), `${state.sessionId}.jsonl`);
      if (fs.existsSync(candidate)) file = candidate;
    }
  }
  if (!file) return { entries: [] };
  const stat = await fsp.stat(file);
  const readSize = Math.min(stat.size, 512 * 1024);
  const handle = await fsp.open(file, 'r');
  try {
    const buffer = Buffer.alloc(readSize);
    await handle.read(buffer, 0, readSize, stat.size - readSize);
    const lines = buffer.toString('utf-8').split('\n');
    if (readSize < stat.size) lines.shift(); // drop partial first line
    const entries = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if ((record.type === 'user' || record.type === 'assistant') && record.message) {
        const text = contentToText(record.message.content).trim();
        if (!text) continue;
        entries.push({
          role: record.type,
          text: text.slice(0, 4000),
          timestamp: record.timestamp || null,
        });
      }
    }
    return { entries: entries.slice(-limit) };
  } finally {
    await handle.close();
  }
}

export async function stopSession(id) {
  jobDir(id);
  const result = await runClaude(['stop', id], { timeout: 20000 });
  if (result.code !== 0)
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'Stop failed');
  triggerRefresh();
  return { output: result.stdout.trim() };
}

export async function respawnSession(id) {
  if (id !== '--all') jobDir(id);
  const args = id === '--all' ? ['respawn', '--all'] : ['respawn', id];
  const result = await runClaude(args, { timeout: 30000 });
  if (result.code !== 0)
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'Respawn failed');
  triggerRefresh();
  return { output: result.stdout.trim() };
}

/**
 * Delete a session (`claude rm`). Returns hints when the CLI refuses (unpushed commits etc.).
 */
export async function removeSession(id, options = {}) {
  jobDir(id);
  const args = ['rm', id];
  if (options.discardUnpushed) args.push('--discard-unpushed', String(options.discardUnpushed));
  if (options.forceRemoveWorktree)
    args.push('--force-remove-worktree', String(options.forceRemoveWorktree));
  const result = await runClaude(args, { timeout: 30000 });
  const combined = `${result.stdout}\n${result.stderr}`.trim();
  if (result.code !== 0) {
    return {
      removed: false,
      message: combined || 'Delete refused',
      hints: parseRemoveHints(combined),
    };
  }
  triggerRefresh();
  return { removed: true, message: combined };
}

export async function renameSession(id, name) {
  const file = path.join(jobDir(id), 'state.json');
  const state = await readJson(file, null);
  if (!state) throw new Error('Session state not found');
  state.name = String(name).trim();
  state.nameSource = 'user';
  state.updatedAt = new Date().toISOString();
  await writeJsonAtomic(file, state);
  triggerRefresh();
  return { id, name: state.name };
}

export async function setPinned(id, pinned) {
  jobDir(id);
  const pins = await readPins();
  if (pinned) pins.add(id);
  else pins.delete(id);
  await writeJsonAtomic(PINS_FILE, [...pins]);
  triggerRefresh();
  return { id, pinned: !!pinned };
}

/**
 * Persist a manual order. Writes the numeric position into each job's `order` file.
 * @param {string[]} ids
 */
export async function reorderSessions(ids) {
  let index = 0;
  for (const id of ids) {
    try {
      const dir = jobDir(id);
      if (fs.existsSync(dir)) {
        await fsp.writeFile(path.join(dir, 'order'), String(index));
        index += 1;
      }
    } catch {
      // skip invalid ids
    }
  }
  triggerRefresh();
  return { ids };
}

/**
 * Send a reply to a session without attaching to it in the UI.
 * Uses a hidden PTY running `claude attach <id>` so that permission answers, numbered
 * choices and `!` shell commands reach the session exactly like keystrokes would.
 * Falls back to `claude --resume <sessionId> --bg <text>` when no PTY is available.
 */
export async function replySession(id, text, options = {}) {
  const session = await findSession(id);
  if (!session) throw new Error('Session not found');
  const message = String(text ?? '');
  if (!message.trim()) throw new Error('Reply is empty');

  if (options.mode !== 'resume') {
    try {
      await replyViaAttach(id, session.cwd, message);
      triggerRefresh();
      return { delivered: true, mode: 'attach' };
    } catch (error) {
      if (options.mode === 'attach') throw error;
      console.warn(`[Agents] PTY reply failed for ${id}, falling back to --resume:`, error.message);
    }
  }
  if (!session.sessionId) throw new Error('Session has no resumable id');
  const result = await runClaude(['--resume', session.sessionId, '--bg', message], {
    cwd: session.cwd,
    timeout: 90000,
  });
  if (result.code !== 0)
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'Reply failed');
  triggerRefresh();
  return { delivered: true, mode: 'resume', output: result.stdout.trim() };
}

function replyViaAttach(id, cwd, message) {
  return new Promise((resolve, reject) => {
    const pty = nodePty;
    const bin = resolveClaudeBinary();
    if (!bin) {
      reject(new Error('Claude CLI not found'));
      return;
    }
    let output = '';
    let settled = false;
    let quietTimer = null;
    let sent = false;
    const proc = pty.spawn(bin, ['attach', id], {
      name: 'xterm-256color',
      cols: 140,
      rows: 40,
      cwd: fs.existsSync(cwd || '') ? cwd : os.homedir(),
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(quietTimer);
      clearTimeout(hardTimeout);
      try {
        proc.kill();
      } catch {
        // already exited
      }
      if (error) reject(error);
      else resolve();
    };
    const hardTimeout = setTimeout(() => finish(new Error('Timed out delivering reply')), 25000);

    // Timing is a best-effort heuristic: the CLI has no "prompt ready" signal, so we wait for
    // the output to go quiet (1.2 s), type, press Enter, give the session 2.5 s to accept the
    // input and then detach. On a very slow machine a reply could land mid-render; the
    // --resume fallback in replySession covers that case when the PTY path throws.
    const sendMessage = () => {
      if (sent) return;
      sent = true;
      // Multi-line replies use Shift+Enter (CSI u) so they stay in one prompt
      const encoded = message.replace(/\r?\n/g, '\x1b[13;2u');
      proc.write(encoded);
      setTimeout(() => {
        proc.write('\r');
        // Give the session time to accept the input, then detach with Ctrl+Z
        setTimeout(() => {
          proc.write('\x1a');
          setTimeout(() => finish(), 1500);
        }, 2500);
      }, 300);
    };

    proc.onData((data) => {
      output += data;
      if (sent) return;
      // Wait until output goes quiet (prompt rendered) before typing
      clearTimeout(quietTimer);
      quietTimer = setTimeout(sendMessage, 1200);
      if (/nothing to resume|no such session|not found/i.test(output)) {
        finish(new Error(output.replace(ANSI_ESCAPE_RE, '').trim().slice(-300)));
      }
    });
    proc.onExit(({ exitCode }) => {
      if (!sent) finish(new Error(`attach exited before the prompt was ready (code ${exitCode})`));
      else finish();
    });
  });
}

// ---------------------------------------------------------------------------
// Daemon
// ---------------------------------------------------------------------------

export async function daemonStatus() {
  const result = await runClaude(['daemon', 'status'], { timeout: 15000 });
  return parseDaemonStatus(`${result.stdout}\n${result.stderr}`);
}

export async function daemonStop(options = {}) {
  const args = ['daemon', 'stop'];
  if (options.any) args.push('--any');
  if (options.keepWorkers) args.push('--keep-workers');
  const result = await runClaude(args, { timeout: 30000 });
  triggerRefresh();
  return { output: `${result.stdout}\n${result.stderr}`.trim(), code: result.code };
}

// ---------------------------------------------------------------------------
// Discovery: subagents, repos, past sessions, slash commands
// ---------------------------------------------------------------------------

function parseFrontmatter(content) {
  const match = String(content).match(/^---\s*\n([\s\S]*?)\n---/);
  const meta = {};
  if (!match) return meta;
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return meta;
}

async function listMarkdownDefinitions(dir, source) {
  const items = [];
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const content = await fsp.readFile(path.join(dir, entry.name), 'utf-8').catch(() => '');
      const meta = parseFrontmatter(content);
      items.push({
        name: meta.name || entry.name.replace(/\.md$/, ''),
        description: meta.description || '',
        model: meta.model || null,
        source,
        path: path.join(dir, entry.name),
      });
    }
  } catch {
    // directory missing
  }
  return items;
}

/**
 * Custom subagents visible from a directory (project + user level).
 */
export async function listSubagents(cwd) {
  const project = cwd
    ? await listMarkdownDefinitions(path.join(cwd, '.claude', 'agents'), 'project')
    : [];
  const user = await listMarkdownDefinitions(path.join(CLAUDE_HOME, 'agents'), 'user');
  const seen = new Set();
  return [...project, ...user].filter((a) => {
    if (seen.has(a.name)) return false;
    seen.add(a.name);
    return true;
  });
}

/**
 * Slash commands / skills that can be suggested in the dispatch input.
 */
export async function listSlashCommands(cwd) {
  const builtins = [
    {
      name: 'resume',
      description: 'Resume a past session as a background session',
      source: 'builtin',
    },
    {
      name: 'model',
      description: 'Set the dispatch model (e.g. /model opus, /model default)',
      source: 'builtin',
    },
    {
      name: 'effort',
      description: 'Set the dispatch effort level (/effort high)',
      source: 'builtin',
    },
  ];
  const dirs = [];
  if (cwd)
    dirs.push(
      [path.join(cwd, '.claude', 'commands'), 'project'],
      [path.join(cwd, '.claude', 'skills'), 'project']
    );
  dirs.push(
    [path.join(CLAUDE_HOME, 'commands'), 'user'],
    [path.join(CLAUDE_HOME, 'skills'), 'user']
  );
  const found = [];
  for (const [dir, source] of dirs) {
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const meta = parseFrontmatter(
            await fsp.readFile(path.join(dir, entry.name), 'utf-8').catch(() => '')
          );
          found.push({
            name: entry.name.replace(/\.md$/, ''),
            description: meta.description || '',
            source,
          });
        } else if (entry.isDirectory()) {
          const skillFile = path.join(dir, entry.name, 'SKILL.md');
          if (fs.existsSync(skillFile)) {
            const meta = parseFrontmatter(await fsp.readFile(skillFile, 'utf-8').catch(() => ''));
            found.push({
              name: meta.name || entry.name,
              description: meta.description || '',
              source,
            });
          }
        }
      }
    } catch {
      // missing dir
    }
  }
  const seen = new Set();
  return [...builtins, ...found].filter((c) => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });
}

function execGit(args, cwd) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 5000 }, (error, stdout) =>
      resolve(error ? '' : String(stdout))
    );
  });
}

/**
 * Directories that can be targeted with `@<repo>`:
 * git repos one level below cwd, registered worktrees, and directories with existing sessions.
 */
export async function listRepos(cwd, sessions = []) {
  const repos = new Map();
  const add = (dir, source) => {
    if (!dir || /\s/.test(path.basename(dir))) return;
    const name = path.basename(dir);
    if (!repos.has(name)) repos.set(name, { name, path: dir, source });
  };
  if (cwd && fs.existsSync(cwd)) {
    try {
      const entries = await fsp.readdir(cwd, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && fs.existsSync(path.join(cwd, entry.name, '.git'))) {
          add(path.join(cwd, entry.name), 'repo');
        }
      }
    } catch {
      // unreadable
    }
    const porcelain = await execGit(['worktree', 'list', '--porcelain'], cwd);
    for (const line of porcelain.split('\n')) {
      if (line.startsWith('worktree ')) add(line.slice(9).trim(), 'worktree');
    }
  }
  for (const session of sessions) {
    if (session.cwd && session.cwd !== cwd) add(session.cwd, 'session');
  }
  return [...repos.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Past sessions for the /resume picker (newest first), read from transcripts.
 */
export async function listPastSessions(options = {}) {
  const limit = options.limit || 50;
  const query = (options.query || '').toLowerCase();
  const results = [];
  let projectDirs = [];
  try {
    projectDirs = (await fsp.readdir(PROJECTS_DIR, { withFileTypes: true })).filter((d) =>
      d.isDirectory()
    );
  } catch {
    return [];
  }
  const wantedSlug = options.cwd ? projectSlug(options.cwd) : null;
  const jobsBySession = new Map();
  try {
    for (const entry of await fsp.readdir(JOBS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const state = await readJson(path.join(JOBS_DIR, entry.name, 'state.json'), null);
      if (state?.sessionId)
        jobsBySession.set(state.sessionId, {
          id: entry.name,
          name: state.name || null,
          state: state.state,
        });
    }
  } catch {
    // no jobs
  }
  for (const dir of projectDirs) {
    if (wantedSlug && dir.name !== wantedSlug) continue;
    const dirPath = path.join(PROJECTS_DIR, dir.name);
    let files = [];
    try {
      files = (await fsp.readdir(dirPath)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const file of files) {
      const full = path.join(dirPath, file);
      let stat;
      try {
        stat = await fsp.stat(full);
      } catch {
        continue;
      }
      const sessionId = file.replace(/\.jsonl$/, '');
      const head = await readHead(full, 16 * 1024);
      let title = null;
      let cwd = null;
      let firstPrompt = null;
      for (const line of head.split('\n')) {
        if (!line.trim()) continue;
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }
        if (record.type === 'ai-title' && record.aiTitle) title = record.aiTitle;
        if (!cwd && record.cwd) cwd = record.cwd;
        if (!firstPrompt && record.type === 'user' && record.message) {
          const text = contentToText(record.message.content).trim();
          if (text) firstPrompt = text.slice(0, 200);
        }
        if (title && cwd && firstPrompt) break;
      }
      const job = jobsBySession.get(sessionId) || null;
      const entry = {
        sessionId,
        id: job?.id || null,
        name: job?.name || title || firstPrompt || sessionId.slice(0, 8),
        firstPrompt,
        cwd: cwd || null,
        projectSlug: dir.name,
        lastActivity: stat.mtimeMs,
        size: stat.size,
        state: job?.state || null,
      };
      if (
        query &&
        !`${entry.name} ${entry.firstPrompt || ''} ${entry.sessionId} ${entry.id || ''}`
          .toLowerCase()
          .includes(query)
      ) {
        continue;
      }
      results.push(entry);
    }
  }
  results.sort((a, b) => b.lastActivity - a.lastActivity);
  return results.slice(0, limit);
}

async function readHead(file, bytes) {
  const handle = await fsp.open(file, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf-8');
  } finally {
    await handle.close();
  }
}

// ---------------------------------------------------------------------------
// Watcher: polls sessions while clients are subscribed and emits diffs
// ---------------------------------------------------------------------------

let watcherTimer = null;
let subscriberCount = 0;
let lastSnapshot = new Map();
let pollInProgress = false;

function snapshotKey(session) {
  return `${session.state}|${session.status}|${session.detail}|${session.name}|${session.pinned}|${session.order}|${session.links.length}|${session.waitingFor}`;
}

async function poll() {
  if (pollInProgress) return;
  pollInProgress = true;
  try {
    const sessions = await listSessions({ all: true });
    const next = new Map(sessions.map((s) => [s.id, s]));
    const notifications = [];
    for (const session of sessions) {
      if (session.kind !== 'background') continue;
      const previous = lastSnapshot.get(session.id);
      if (!previous) continue; // brand-new sessions are not notified (they were just dispatched)
      if (previous.state !== session.state) {
        if (session.state === 'blocked') notifications.push({ type: 'agent_needs_input', session });
        else if (session.state === 'done' && previous.state === 'working' && !session.loop) {
          notifications.push({ type: 'agent_completed', session });
        } else if (session.state === 'failed')
          notifications.push({ type: 'agent_failed', session });
      }
    }
    const changed =
      next.size !== lastSnapshot.size ||
      sessions.some((s) => {
        const previous = lastSnapshot.get(s.id);
        return !previous || snapshotKey(previous) !== snapshotKey(s);
      });
    lastSnapshot = new Map(sessions.map((s) => [s.id, { ...s }]));
    if (changed) agentEvents.emit('sessions', sessions);
    for (const notification of notifications) agentEvents.emit('notify', notification);
  } catch (error) {
    agentEvents.emit('error', { message: error.message });
  } finally {
    pollInProgress = false;
  }
}

export function subscribe() {
  subscriberCount += 1;
  if (!watcherTimer) {
    poll();
    watcherTimer = setInterval(poll, POLL_INTERVAL);
  }
  return () => {
    subscriberCount = Math.max(0, subscriberCount - 1);
    if (subscriberCount === 0 && watcherTimer) {
      clearInterval(watcherTimer);
      watcherTimer = null;
    }
  };
}

/** Force a poll soon (after a mutating command). */
export function triggerRefresh() {
  if (watcherTimer) setTimeout(poll, 400);
}

export function getSubscriberCount() {
  return subscriberCount;
}

export const paths = { CLAUDE_HOME, JOBS_DIR, PINS_FILE, PROJECTS_DIR };
