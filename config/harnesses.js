/**
 * Non-Claude agent harnesses (#195): which binaries the agents view may start in a PTY and
 * with which arguments. Shared by the API (`/api/pty`) and pty-host (Docker proxy), so both
 * sides enforce the same trust boundary.
 *
 * Each harness starts interactively without options; the only arguments are the task prompt,
 * passed after `--` as the first message, or the harness's resume form with a session id
 * (`omp -r <id>`, `pi --session <id>`, `opencode --session <id>`, `codex resume <id>`), so a
 * Chat pane can hand its session to the terminal. `opencode` takes no start prompt this way.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MAX_HARNESS_PROMPT } from './limits.js';

/** id → whether the CLI accepts `-- <prompt>` as the first interactive message */
export const HARNESS_PROMPT_SUPPORT = Object.freeze({
  omp: true,
  opencode: false,
  codex: true,
  pi: true,
});

export const HARNESS_COMMANDS = Object.freeze(Object.keys(HARNESS_PROMPT_SUPPORT));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** id → how its terminal UI resumes a session: the flag (or subcommand) and the id format */
export const HARNESS_RESUME = Object.freeze({
  omp: { flag: '-r', id: UUID_RE },
  pi: { flag: '--session', id: UUID_RE },
  opencode: { flag: '--session', id: /^ses_[A-Za-z0-9]{10,60}$/ },
  codex: { flag: 'resume', id: UUID_RE },
});

export function isHarnessCommand(command) {
  return Object.hasOwn(HARNESS_PROMPT_SUPPORT, command);
}

/**
 * Allowed argument shapes: `[]`, `['--', prompt]` (prompt only where supported) or
 * `[resumeFlag, sessionId]` (a session UUID only, where the harness can resume).
 * Anything else, including any other flag, is rejected: a flag like `--config` or `--api-key`
 * would let a client reconfigure the harness.
 * @returns {string|null} error message, null when allowed
 */
export function harnessArgsError(command, args) {
  if (!isHarnessCommand(command)) return 'Unknown harness';
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) {
    return 'Invalid args format';
  }
  if (args.length === 0) return null;
  const resume = HARNESS_RESUME[command];
  if (resume && args[0] === resume.flag) {
    return args.length === 2 && resume.id.test(args[1]) ? null : 'Invalid session id';
  }
  if (!HARNESS_PROMPT_SUPPORT[command]) return `${command} takes no arguments`;
  if (args.length !== 2 || args[0] !== '--') return 'Only a prompt after -- is allowed';
  const prompt = args[1];
  if (!prompt.trim() || prompt.length > MAX_HARNESS_PROMPT || prompt.includes('\0')) {
    return 'Invalid prompt';
  }
  return null;
}

/**
 * Absolute path of a harness binary, or null when it is not installed.
 * Same lookup places as the claude binary; never a path from the client.
 */
export function resolveHarnessBinary(command, env = process.env) {
  if (!isHarnessCommand(command)) return null;
  const home = env.HOME || os.homedir();
  const dirs = [
    `${home}/.bun/bin`,
    `${home}/.local/bin`,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    ...(env.PATH || '').split(path.delimiter).filter(Boolean),
  ];
  for (const dir of dirs) {
    const candidate = path.join(dir, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // try next
    }
  }
  return null;
}
