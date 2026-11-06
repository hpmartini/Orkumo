/**
 * Non-Claude agent harnesses (#195): which binaries the agents view may start in a PTY and
 * with which arguments. Shared by the API (`/api/pty`) and pty-host (Docker proxy), so both
 * sides enforce the same trust boundary.
 *
 * v1 starts each harness interactively without options; the only argument is the task prompt,
 * passed after `--` as the first message. `opencode` (installed 0.0.55, the Go version) has no
 * interactive prompt parameter, so it takes no arguments at all.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

/** id → whether the CLI accepts `-- <prompt>` as the first interactive message */
export const HARNESS_PROMPT_SUPPORT = Object.freeze({
  omp: true,
  opencode: false,
  codex: true,
  pi: true,
});

export const HARNESS_COMMANDS = Object.freeze(Object.keys(HARNESS_PROMPT_SUPPORT));

// the prompt travels in the ws URL: 1500 chars of 3-byte UTF-8 percent-encode to ~13.5 KB,
// below Node's 16 KB header limit, so a too-long prompt gets this error instead of a 431
export const MAX_HARNESS_PROMPT = 1500;

export function isHarnessCommand(command) {
  return Object.hasOwn(HARNESS_PROMPT_SUPPORT, command);
}

/**
 * Allowed argument shapes: `[]` or `['--', prompt]` (prompt only where supported).
 * Anything else, including any flag, is rejected: a flag like `--config` or `--api-key`
 * would let a client reconfigure the harness.
 * @returns {string|null} error message, null when allowed
 */
export function harnessArgsError(command, args) {
  if (!isHarnessCommand(command)) return 'Unknown harness';
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) {
    return 'Invalid args format';
  }
  if (args.length === 0) return null;
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
