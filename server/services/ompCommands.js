/**
 * The `/` picker list of an Oh My Pi (omp) agent's UI view.
 *
 * omp answers `{"type":"get_available_commands"}` in `--mode rpc` with every command it can run
 * without its terminal UI: text-mode built-ins, `/skill:<name>`, custom, extension and file
 * commands. The TUI-only built-ins (`/goal`, `/plan`, `/new`, ...) are missing from that answer by
 * design, so OMP_TUI_BUILTINS adds them. The probe runs with `--no-session` (no session file) and
 * the same skills overlay Orkumo's omp panes get (ompSkills.js), so the list matches the pane.
 *
 * pi: not probed. Its RPC mode serves a different request (`get_commands`) that could not be
 * verified on this machine (pi not installed), so pi views get no list.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import { ompSkillsArgs } from './ompSkills.js';
import { listClaudeSkills } from './agentService.js';

/**
 * TUI-only built-ins of omp v18.18.6: the `builtin-*.ts` registry entries of
 * can1357/oh-my-pi@v18.18.6 (packages/coding-agent/src/slash-commands) without a text-mode
 * `handle`, so the RPC answer leaves them out. Descriptions and hints as in the source.
 * shortcut: a snapshot, regenerate per omp version
 */
export const OMP_TUI_BUILTINS = [
  {
    name: 'collab',
    description: 'Share this session live via a relay',
    argumentHint: '[start|view|list|stop|status] [relayUrl]',
    subcommands: ['view', 'list', 'status', 'stop'],
  },
  { name: 'join', description: 'Join a shared collab session', argumentHint: '<link>' },
  { name: 'leave', description: 'Leave the collab session' },
  { name: 'copy', description: 'Pick text or code from the conversation to copy' },
  {
    name: 'open',
    description:
      'Open the last link from the conversation in your browser (or pick one with /copy)',
  },
  { name: 'live', description: 'Start Codex-backed realtime voice mode' },
  {
    name: 'record',
    description: 'Start or stop recording this screen to a replayable file (omp play)',
  },
  { name: 'pause', description: 'Freeze all agents (main, subagents, advisor) until resumed' },
  { name: 'quit', aliases: ['q'], description: 'Quit the application' },
  { name: 'new', description: 'Start a new session' },
  { name: 'clear', description: 'Clear the conversation context in place, keeping the session' },
  { name: 'delete', description: 'Delete the current session and start a new one' },
  {
    name: 'resume',
    description: 'Resume a different session',
    argumentHint: '[session id|@claude|@codex]',
  },
  {
    name: 'btw',
    description: "Ask a side question, or browse this session's BTW history",
    argumentHint: '[question]',
  },
  {
    name: 'tan',
    description: 'Run a full background agent on tangential work',
    argumentHint: '<work>',
  },
  {
    name: 'omfg',
    description: 'Forge a TTSR rule from a complaint to stop a recurring behavior',
    argumentHint: '<complaint>',
  },
  {
    name: 'cleanse',
    description: 'Detect and fix project diagnostics with weighted parallel subagents',
    argumentHint: '[request] [--all]',
  },
  { name: 'debug', description: 'Open debug tools selector' },
  { name: 'exit', description: 'Exit the application' },
  {
    name: 'restart',
    description:
      'Restart omp with the same launch flags, resuming this session and its running subagents',
  },
  { name: 'settings', description: 'Open settings menu' },
  { name: 'setup', aliases: ['providers'], description: 'Open provider setup' },
  {
    name: 'plan',
    description: 'Toggle plan mode (agent plans before executing)',
    argumentHint: '[prompt]',
  },
  {
    name: 'plan-review',
    description: 'Re-open the plan review for the latest plan (plan mode only)',
  },
  {
    name: 'vibe',
    description:
      'Toggle vibe mode (direct persistent fast/good worker sessions; read-only toolset)',
    argumentHint: '[prompt]',
  },
  {
    name: 'goal',
    description: 'Toggle goal mode (persistent autonomous objective for this session)',
    argumentHint: '[objective]',
    subcommands: ['set', 'show', 'pause', 'resume', 'drop', 'budget'],
  },
  {
    name: 'guided-goal',
    description: 'Have the agent interview you in chat, then set up goal mode',
    argumentHint: '[rough objective]',
  },
  {
    name: 'loop',
    description:
      "Toggle loop mode. While enabled, the next prompt you send re-submits after every yield. Bound it with a count/duration, or gate it with `--until '<cmd>'` / `--while '<cmd>'`; /loop again to disable.",
    argumentHint: "[count|duration] [--while|--until '<cmd>'] [prompt]",
  },
  {
    name: 'queue',
    description: 'Queue a message for after the agent yields',
    argumentHint: '<message>',
  },
  { name: 'hotkeys', description: 'Show all keyboard shortcuts' },
  {
    name: 'extensions',
    aliases: ['status'],
    description: 'Open Extension Control Center dashboard',
  },
  { name: 'agents', description: 'Open the agents hub (per-agent model, prewalk, and advisor)' },
  {
    name: 'git',
    description: 'Open the git UI (split diff viewer, staging, commit composer)',
    argumentHint: '[revision]',
  },
  {
    name: 'local',
    description: 'Open a session local:// file in $EDITOR (picker when no name given)',
    argumentHint: '[name]',
  },
  {
    name: 'hub',
    aliases: ['subagents'],
    description: 'Open the live Agent Hub (subagents, including finished ones)',
  },
  {
    name: 'branch',
    aliases: ['rewind'],
    description: 'Rewind to a previous message, keeping the old path as a branch',
  },
  {
    name: 'fork',
    description: 'Fork this session, or open it in a multiplexer pane or window',
    subcommands: ['pane', 'window', 'tab'],
  },
  { name: 'tree', description: 'Navigate session tree (switch branches)' },
  {
    name: 'login',
    description: 'Login with OAuth provider',
    argumentHint: '[provider|redirect URL]',
  },
  { name: 'logout', description: 'Logout from OAuth provider', argumentHint: '[provider]' },
  {
    name: 'skills',
    description: 'Search, install, and update skills from the skills.omp.sh registry',
    subcommands: ['search', 'install', 'installed'],
  },
];

/** How long a probed list stays fresh */
const TTL_MS = 5 * 60 * 1000;
/** A probe that has not answered by then is killed */
const PROBE_TIMEOUT_MS = 15_000;

const cache = new Map();

/** omp RPC entry → picker entry */
function fromRpc(c) {
  return {
    name: c.name,
    aliases: Array.isArray(c.aliases) ? c.aliases : [],
    description: c.description || '',
    argumentHint: c.input?.hint || '',
    builtin: c.source === 'builtin',
  };
}

/** Snapshot first, then the probed list; a later name or alias already taken is dropped */
export function mergeOmpCommands(...lists) {
  const taken = new Set();
  const out = [];
  for (const list of lists)
    for (const c of list) {
      const names = [c.name, ...(c.aliases ?? [])];
      if (names.some((n) => taken.has(n))) continue;
      for (const n of names) taken.add(n);
      out.push({ builtin: true, ...c });
    }
  return out;
}

/** Ask `omp --mode rpc` for its commands; rejects when it fails or does not answer in time */
export function probeOmpCommands(bin, cwd, { extraArgs = [], timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['--mode', 'rpc', '--no-session', ...extraArgs], {
      cwd,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let buf = '';
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill('SIGTERM');
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('omp command probe timed out')), timeoutMs);
    child.on('error', (error) => finish(error));
    child.on('exit', () => finish(new Error('omp exited without a command list')));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg?.type !== 'response' || msg.id !== 'devorbit-commands') continue;
        if (!msg.success || !Array.isArray(msg.data?.commands))
          finish(new Error(msg.error || 'omp refused the command list'));
        else
          finish(
            null,
            msg.data.commands.filter((c) => c && typeof c.name === 'string')
          );
      }
    });
    child.stdin.on('error', () => {});
    // omp queues the request until it has started
    child.stdin.write(
      `${JSON.stringify({ id: 'devorbit-commands', type: 'get_available_commands' })}\n`
    );
  });
}

/** Without RPC: the snapshot plus the Claude skills the overlay hands omp, as `/skill:<name>` */
async function fallbackCommands(cwd, listSkills) {
  const skills = await listSkills(cwd).catch(() => []);
  return skills.map((s) => ({
    name: `skill:${s.name}`,
    description: s.description || '',
    builtin: false,
  }));
}

/** The TUI snapshot as picker entries (sent before the probe answers) */
export function ompSnapshot() {
  return mergeOmpCommands(OMP_TUI_BUILTINS);
}

/**
 * Full `/` list for an omp view in `cwd`: TUI snapshot + probed RPC list. Cached per
 * realpath(bin) + cwd for TTL_MS; parallel callers share one probe. Never rejects.
 * Deps (tests): `bin`, `extraArgs` (default: the skills overlay), `timeoutMs`, `listSkills`, `now`.
 * @returns {Promise<Array<{name, description, argumentHint?, builtin}>>}
 */
export function listOmpCommands(cwd, deps = {}) {
  const bin = deps.bin;
  if (!bin) return Promise.resolve(ompSnapshot());
  let real = bin;
  try {
    real = fs.realpathSync(bin);
  } catch {
    // keep the given path
  }
  const now = deps.now ?? Date.now;
  const key = `${real}\0${cwd}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < TTL_MS) return hit.promise;
  const extraArgs = deps.extraArgs ?? ompSkillsArgs(bin, cwd);
  const promise = probeOmpCommands(bin, cwd, { extraArgs, timeoutMs: deps.timeoutMs })
    .then((commands) => mergeOmpCommands(OMP_TUI_BUILTINS, commands.map(fromRpc)))
    .catch(async () => {
      // a failed probe is retried by the next view
      cache.delete(key);
      return mergeOmpCommands(
        OMP_TUI_BUILTINS,
        await fallbackCommands(cwd, deps.listSkills ?? listClaudeSkills)
      );
    });
  cache.set(key, { at: now(), promise });
  return promise;
}

/** Tests: forget cached lists */
export function clearOmpCommandsCache() {
  cache.clear();
}
