#!/usr/bin/env node
/**
 * `orkumo`: CLI of Orkumo orchestrator sessions. The server copies this file to
 * `<data>/orchestrator-bin/orkumo.mjs` (orchestratorService.js, outside the orchestrator
 * workspace) next to a shell wrapper `orkumo` and `orkumo.json` (API address, token file).
 * Self-contained: no imports beyond node builtins.
 * Orchestrators hand out work only through it, so every agent stays visible in Orkumo's rail.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class CliError extends Error {
  /** @param {number} code - process exit code: 1 API/runtime error, 2 wrong usage */
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const usage = (message) => new CliError(`${message}\nRun "orkumo help" for usage.`, 2);

export const HELP = `orkumo: hand out and watch work of the agents running in Orkumo

  orkumo agents [--all] [--json]          agents with state, project, branch, PRs, last answer
  orkumo show <id> [--last N] [--json]    recent transcript turns of one agent
  orkumo send <id> <message…|->           message an agent (background job or Orkumo pane)
  orkumo start --project <path|name> [--harness claude|omp] [--name n] <prompt…|->
                                          start a new agent in a project
  orkumo stop <id>                        stop an agent
  orkumo projects [--json]                projects Orkumo knows

  "-" reads the message or prompt from stdin.
  ORKUMO_API_URL / ORKUMO_TOKEN override the API address and token; the token is only sent to
  a loopback address (127.0.0.1, localhost, [::1]).`;

/** Flags each command takes; true = boolean, false = takes a value */
const COMMANDS = {
  agents: { json: true, all: true },
  show: { last: false, json: true },
  send: {},
  start: { project: false, harness: false, name: false, json: true },
  stop: {},
  projects: { json: true },
  guard: {},
  help: {},
};
/** Positional arguments before free text starts: the rest is the message / prompt, verbatim */
const TEXT_AFTER = { send: 1, start: 0 };

/**
 * `argv` without node and script. Free text (send's message, start's prompt) is taken verbatim
 * once it starts, so a message may contain words like `--force`.
 * @returns {{ command: string, args: string[], flags: Record<string, string|boolean> }}
 */
export function parseArgs(argv) {
  const flags = {};
  const args = [];
  let command = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (command && command in TEXT_AFTER && args.length > TEXT_AFTER[command]) {
      args.push(arg);
      continue;
    }
    if (arg === '--') {
      args.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '-h' || arg === '--help') {
      flags.help = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = arg.slice(2, eq === -1 ? undefined : eq);
      const known = COMMANDS[command ?? 'help'] ?? {};
      if (!(name in known)) {
        throw usage(`Unknown option --${name}${command ? ` for "${command}"` : ''}.`);
      }
      if (known[name]) {
        if (eq !== -1) throw usage(`--${name} takes no value.`);
        flags[name] = true;
        continue;
      }
      const value = eq !== -1 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value === '') throw usage(`--${name} needs a value.`);
      flags[name] = value;
      continue;
    }
    if (command === null) {
      if (!(arg in COMMANDS)) throw usage(`Unknown command "${arg}".`);
      command = arg;
    } else {
      args.push(arg);
    }
  }
  return { command: command ?? 'help', args, flags };
}

/** API address and token: env first, then `orkumo.json` the server writes next to the script */
export function loadConfig({ env = process.env, scriptDir } = {}) {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(scriptDir, 'orkumo.json'), 'utf8')) || {};
  } catch {
    // no config file: defaults below
  }
  const apiUrl = String(env.ORKUMO_API_URL || file.apiUrl || 'http://127.0.0.1:3099/api').replace(
    /\/+$/,
    ''
  );
  let token = env.ORKUMO_TOKEN || null;
  // The server only asks for it with loopback trust off (DEVORBIT_TRUST_LOOPBACK=false)
  if (!token && file.tokenFile) {
    try {
      token = fs.readFileSync(file.tokenFile, 'utf8').trim() || null;
    } catch {
      token = null;
    }
  }
  return {
    apiUrl,
    token,
    workspace: file.workspace || path.join(path.dirname(scriptDir || '.'), 'orchestrator'),
  };
}

/** True for http(s) URLs on 127.0.0.0/8, localhost or [::1] */
export function isLoopbackUrl(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === 'localhost' || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host);
}

/** `api(method, route, body?)` against the local Orkumo API; errors become CliErrors */
export function createApi({ apiUrl, token, fetch = globalThis.fetch }) {
  // The pairing token unlocks the whole Orkumo API: never hand it to another host
  if (token && !isLoopbackUrl(apiUrl)) {
    throw new CliError(
      `Refusing to send the Orkumo token to ${apiUrl}: only loopback addresses (127.0.0.1, localhost, [::1]) are allowed. Fix ORKUMO_API_URL or orkumo.json.`
    );
  }
  return async function api(method, route, body) {
    let res;
    try {
      res = await fetch(`${apiUrl}${route}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'X-DevOrbit-Token': token } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new CliError(
        `Orkumo is not reachable at ${apiUrl} (${error.message}). Start the Orkumo app, or set ORKUMO_API_URL.`
      );
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      let message = (data && data.error) || text || res.statusText;
      if (res.status === 401)
        message += ' (the API wants the pairing token: set ORKUMO_TOKEN or restart Orkumo)';
      throw new CliError(`${method} ${route} failed (${res.status}): ${message}`);
    }
    return data;
  };
}

const enc = encodeURIComponent;

/** The agent `ref` names: id, session uuid, pane id, exact name, or a unique id prefix */
export function findAgent(agents, ref) {
  const exact = agents.find((a) => a.id === ref || a.sessionId === ref || a.paneId === ref);
  if (exact) return exact;
  for (const match of [
    (a) => a.name === ref,
    (a) => a.id.startsWith(ref) || (a.sessionId || '').startsWith(ref),
  ]) {
    const hits = agents.filter(match);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      throw new CliError(
        `"${ref}" matches ${hits.length} agents: ${hits.map((a) => a.id).join(', ')}. Use the full id.`
      );
    }
  }
  throw new CliError(`No agent "${ref}". Run "orkumo agents --all" to list them.`);
}

/** Where a message to `agent` goes: a background job's reply, else the pane it runs in */
export function sendRoute(agent) {
  if (agent.kind === 'background') return `/agents/${enc(agent.id)}/reply`;
  if (agent.paneId) return `/agents/panes/${enc(agent.paneId)}/message`;
  return null;
}

/** How `agent` is stopped: jobs and omp sessions by id, other pane agents by their pane */
export function stopRoute(agent) {
  if (agent.kind === 'background' || agent.id.startsWith('omp-'))
    return `/agents/${enc(agent.id)}/stop`;
  if (agent.paneId) return `/agents/panes/${enc(agent.paneId)}/stop`;
  return null;
}

const looksLikePath = (ref) => /^(\/|~(\/|$)|\.\.?(\/|$))/.test(ref);

/** Absolute directory of `--project`: a path, or a project name (case-insensitive, unique prefix) */
export function resolveProject(projects, ref, { cwd = process.cwd(), home = os.homedir() } = {}) {
  if (looksLikePath(ref)) return path.resolve(cwd, ref.replace(/^~(?=$|\/)/, home));
  const lower = ref.toLowerCase();
  for (const match of [
    (p) => p.name.toLowerCase() === lower || path.basename(p.path).toLowerCase() === lower,
    (p) => p.name.toLowerCase().startsWith(lower),
  ]) {
    const hits = projects.filter(match);
    if (hits.length === 1) return hits[0].path;
    if (hits.length > 1) {
      throw new CliError(
        `"${ref}" matches several projects: ${hits.map((p) => `${p.name} (${p.path})`).join(', ')}. Pass the path.`
      );
    }
  }
  throw new CliError(`No project "${ref}". Run "orkumo projects", or pass an absolute path.`);
}

export function ago(iso, now) {
  const at = Date.parse(iso || '');
  if (!Number.isFinite(at)) return null;
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const STATE_LABELS = { 'needs-input': 'needs input', blocked: 'needs input' };
/** PR lines per agent block; jobs that coordinate others can carry dozens */
const MAX_PR_LINES = 3;

/** One agent as a short block for `orkumo agents` */
export function formatAgent(a, now = Date.now()) {
  const state = a.displayState || a.state || 'unknown';
  const where = [a.project, a.branch].filter(Boolean).join('@') || a.cwd || '';
  const lines = [
    [
      a.id,
      STATE_LABELS[state] || state,
      a.harness,
      where,
      JSON.stringify(a.name || ''),
      a.orchestrator ? '[orchestrator]' : '',
    ]
      .filter(Boolean)
      .join('  '),
  ];
  if (a.waitingFor) lines.push(`  waiting for: ${a.waitingFor}`);
  const prs = a.prs || [];
  for (const pr of prs.slice(0, MAX_PR_LINES)) {
    lines.push(`  PR ${pr.number ? `#${pr.number} ` : ''}${pr.state || 'open'}: ${pr.url}`);
  }
  if (prs.length > MAX_PR_LINES)
    lines.push(`  … ${prs.length - MAX_PR_LINES} more PRs ("orkumo agents --json" lists all)`);
  if (a.lastText) lines.push(`  last: ${a.lastText}`);
  const active = ago(a.lastActivity, now);
  lines.push(
    `  ${active ? `active ${active}` : 'no activity yet'}${a.paneId ? ' · Orkumo pane' : ''}`
  );
  return lines.join('\n');
}

/** Free text of send/start; "-" reads it from stdin */
async function textArg(parts, readStdin, what) {
  const text = parts.length === 1 && parts[0] === '-' ? await readStdin() : parts.join(' ');
  if (!text.trim()) throw usage(`The ${what} is empty.`);
  return text.trim();
}

const readAllStdin = async () => {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
};

/** Resolves an agent ref against every listed agent (no transcript reads) */
async function agentByRef(api, ref) {
  if (!ref) throw usage('Which agent? Pass its id from "orkumo agents".');
  const { agents } = await api('GET', '/orchestrator/overview?all=1&text=0');
  return findAgent(agents, ref);
}

/** Realpath of `target`, also when its last parts do not exist yet (a file about to be written) */
function realpathNearest(target) {
  let dir = target;
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(dir), ...rest);
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return target;
      rest.unshift(path.basename(dir));
      dir = parent;
    }
  }
}

/** Workspace entries an orchestrator must not change: its instructions, settings and skills */
const PROTECTED = ['.claude', '.omp', 'AGENTS.md', 'CLAUDE.md'];
/** Names that point at protected files in a Bash command (also the CLI next to the workspace) */
const PROTECTED_WORDS = /(^|[\s'"=/])(\.claude|\.omp|AGENTS\.md|CLAUDE\.md|orchestrator-bin|orkumo\.json|orkumo\.mjs)([\s'"/;|&)>]|$)/;
/** Bash that writes or moves files: redirects, tee, mv/cp/rm/ln/install/chmod, sed -i, dd, truncate */
const BASH_WRITES = /(>|\btee\b|\b(mv|cp|rm|ln|install|chmod|chown|truncate|dd|rsync|touch|mkdir|patch)\b|\b(sed|perl)\b[^|;&]*\s-[a-zA-Z]*i)/;

const blocked = (workspace, target) =>
  `Orchestrators only edit NOTES.md and plain files in their workspace (${workspace}), never its .claude, .omp, AGENTS.md or CLAUDE.md, nor anything outside; blocked: ${target}. Delegate the change to an agent with "orkumo send" or "orkumo start".`;

/**
 * PreToolUse hook of Claude Code orchestrators (`orkumo guard`, wired in .claude/settings.json):
 * a message when the call may not pass, null when it may. Edits must target a plain file inside
 * the workspace (not .claude/.omp/AGENTS.md/CLAUDE.md). Bash commands that look like they write
 * to those names are denied too: best effort only, a shell can always obfuscate; the hard
 * boundary is that the CLI and its config live outside the workspace, read-only.
 */
export function guardDecision(input, workspace) {
  const toolInput = (input && input.tool_input) || {};
  if (input && input.tool_name === 'Bash') {
    const command = typeof toolInput.command === 'string' ? toolInput.command : '';
    return BASH_WRITES.test(command) && PROTECTED_WORDS.test(command)
      ? blocked(workspace, command)
      : null;
  }
  const target = toolInput.file_path || toolInput.notebook_path || toolInput.path;
  if (typeof target !== 'string' || !target) return null;
  const root = realpathNearest(path.resolve(workspace));
  const real = realpathNearest(path.resolve((input && input.cwd) || workspace, target));
  if (!real.startsWith(root + path.sep)) return blocked(workspace, target);
  const first = path.relative(root, real).split(path.sep)[0];
  return PROTECTED.includes(first) ? blocked(workspace, target) : null;
}

/**
 * Runs one CLI invocation.
 * @param {string[]} argv
 * @param {{ fetch?: Function, env?: object, out?: (s: string) => void, err?: (s: string) => void,
 *   readStdin?: () => Promise<string>, cwd?: string, now?: number, scriptDir?: string }} deps
 * @returns {Promise<number>} exit code
 */
export async function run(argv, deps = {}) {
  const out = deps.out ?? ((s) => process.stdout.write(`${s}\n`));
  const err = deps.err ?? ((s) => process.stderr.write(`${s}\n`));
  const readStdin = deps.readStdin ?? readAllStdin;
  const now = deps.now ?? Date.now();
  try {
    const { command, args, flags } = parseArgs(argv);
    if (command === 'help' || flags.help) {
      out(HELP);
      return 0;
    }
    const config = loadConfig({ env: deps.env ?? process.env, scriptDir: deps.scriptDir });
    if (command === 'guard') {
      const raw = await readStdin();
      let input = null;
      try {
        input = JSON.parse(raw);
      } catch {
        input = null;
      }
      const message = guardDecision(input, config.workspace);
      if (!message) return 0;
      err(message);
      return 2; // Claude Code: exit 2 blocks the tool call and shows stderr to the model
    }
    const api = createApi({ ...config, fetch: deps.fetch });
    /** Prints `data` as JSON; the exit code */
    const json = (data) => {
      out(JSON.stringify(data, null, 2));
      return 0;
    };

    switch (command) {
      case 'agents': {
        const data = await api('GET', `/orchestrator/overview${flags.all ? '?all=1' : ''}`);
        if (flags.json) return json(data);
        if (!data.agents.length) {
          out(
            flags.all
              ? 'No agents.'
              : 'No running agents. "orkumo agents --all" lists finished ones.'
          );
          return 0;
        }
        out(data.agents.map((a) => formatAgent(a, now)).join('\n\n'));
        return 0;
      }
      case 'show': {
        const last = flags.last === undefined ? 10 : Number(flags.last);
        if (!Number.isInteger(last) || last < 1 || last > 100)
          throw usage('--last takes a number from 1 to 100.');
        const agent = await agentByRef(api, args[0]);
        const data = await api(
          'GET',
          `/orchestrator/agents/${enc(agent.id)}/transcript?last=${last}`
        );
        if (flags.json) return json(data);
        out(`${agent.id}  ${JSON.stringify(agent.name || '')}  (${agent.harness}, ${agent.cwd})`);
        if (!data.entries.length) out('No transcript turns yet.');
        for (const e of data.entries) {
          out(`\n── ${e.role}${e.timestamp ? ` · ${ago(e.timestamp, now)}` : ''}\n${e.text}`);
        }
        return 0;
      }
      case 'send': {
        const agent = await agentByRef(api, args[0]);
        const text = await textArg(args.slice(1), readStdin, 'message');
        const route = sendRoute(agent);
        if (!route) {
          throw new CliError(
            `${agent.id} runs outside Orkumo (no pane, no background job) and cannot be reached. Start a new agent with "orkumo start".`
          );
        }
        await api('POST', route, { text });
        out(`Sent to ${agent.id} (${agent.name || agent.harness}).`);
        return 0;
      }
      case 'start': {
        if (!flags.project) throw usage('start needs --project <path|name>.');
        const { projects, defaultHarness } = await api('GET', '/orchestrator/projects');
        const cwd = resolveProject(projects, String(flags.project), { cwd: deps.cwd });
        const harness = String(flags.harness || defaultHarness || 'claude');
        if (harness !== 'claude' && harness !== 'omp')
          throw usage(`start runs --harness claude or omp, not "${harness}".`);
        const prompt = await textArg(args, readStdin, 'prompt');
        if (prompt.length < 4)
          throw usage('The prompt is too short: say what the agent should do.');
        if (prompt.startsWith('-')) throw usage('The prompt must not start with "-".');
        if (harness === 'claude') {
          const result = await api('POST', '/agents/dispatch', {
            prompt,
            cwd,
            ...(flags.name ? { name: String(flags.name) } : {}),
          });
          if (flags.json) return json(result);
          out(
            `${result.alreadyRunning ? 'Already running' : 'Started'} ${result.id}${result.name ? ` (${result.name})` : ''}: background Claude Code session in ${cwd}.`
          );
          return 0;
        }
        if (flags.name) err('Note: Oh My Pi names its sessions itself; --name is ignored.');
        const result = await api('POST', '/orchestrator/panes', { harness, cwd, prompt });
        if (flags.json) return json(result);
        out(`Started omp-${result.sessionId} in Orkumo pane ${result.paneId} (${cwd}).`);
        return 0;
      }
      case 'stop': {
        const agent = await agentByRef(api, args[0]);
        const route = stopRoute(agent);
        if (!route) {
          throw new CliError(
            `${agent.id} runs outside Orkumo; stop it where it runs (PID ${agent.pid ?? 'unknown'}).`
          );
        }
        await api('POST', route);
        out(`Stopped ${agent.id} (${agent.name || agent.harness}).`);
        return 0;
      }
      case 'projects': {
        const data = await api('GET', '/orchestrator/projects');
        if (flags.json) return json(data);
        if (!data.projects.length) {
          out("No projects. Hape adds project directories in Orkumo's settings.");
          return 0;
        }
        out(
          data.projects
            .map(
              (p) =>
                `${p.name}  ${p.path}${p.agents ? `  (${p.agents} agent${p.agents === 1 ? '' : 's'})` : ''}`
            )
            .join('\n')
        );
        return 0;
      }
      default:
        throw usage(`Unknown command "${command}".`);
    }
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    err(`orkumo: ${error.message}`);
    return error.code;
  }
}

const self = fileURLToPath(import.meta.url);
const invoked = (() => {
  try {
    return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(self);
  } catch {
    return false;
  }
})();
if (invoked) {
  run(process.argv.slice(2), { scriptDir: path.dirname(self) }).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`orkumo: ${error.stack || error.message}\n`);
      process.exitCode = 1;
    }
  );
}
