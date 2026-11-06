/**
 * Which commands the HTTP /exec endpoint runs on the host for the API container (a trust boundary).
 * `claude` with any arguments; everything else only as an argv list from the owner-written rules
 * file (docs/WORKFLOW_PROVIDER.md, "pty-host allowlist").
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

/** mirrors ISSUE_URL_RE in utils/issueUrl.js (pty-host ships without the app's utils) */
const ISSUE_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/;

export const rulesPath = () =>
  process.env.PTY_HOST_EXEC_RULES ||
  path.join(os.homedir(), '.config', 'orkumo', 'exec-rules.json');

/**
 * `[{ command, args }]` from the rules file; missing or broken file: no rules. Read per call, so an
 * edited file applies without a restart (/exec is rare).
 */
export function loadRules(file = rulesPath()) {
  let rules;
  try {
    rules = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`[exec] ignoring ${file}:`, error.message);
    return [];
  }
  const valid = (r) =>
    r &&
    typeof r.command === 'string' &&
    r.command &&
    Array.isArray(r.args) &&
    r.args.every((a) => typeof a === 'string');
  return Array.isArray(rules) ? rules.filter(valid) : [];
}

/** One argument against its template: `{issue}` an issue URL, `{uid}` the host uid, else exact */
function argMatches(template, arg, uid) {
  if (template === '{issue}') return ISSUE_URL_RE.test(arg);
  return template.replaceAll('{uid}', String(uid)) === arg;
}

/**
 * @param {unknown} command
 * @param {unknown} args
 * @param {number} [uid] the host user pty-host runs as
 * @param {{ command: string, args: string[] }[]} [rules]
 */
export function isAllowedExec(command, args, uid = process.getuid(), rules = loadRules()) {
  if (command === 'claude') return true;
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) return false;
  return rules.some(
    (r) =>
      r.command === command &&
      r.args.length === args.length &&
      r.args.every((t, i) => argMatches(t, args[i], uid))
  );
}
