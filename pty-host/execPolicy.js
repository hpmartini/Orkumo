/** Which commands the HTTP /exec endpoint runs on the host for the API container (a trust boundary). */

/** launchd job of `mw board install` (mirrors MW_BOARD_JOB in server/services/workflowGo.js) */
const MW_BOARD_JOB = 'de.martini-labs.mw-board';
/** mirrors ISSUE_URL_RE in utils/workflowStage.js */
const ISSUE_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/;

/**
 * `claude` with any arguments; `launchctl` only to start the mw-board poll of this host user (#145);
 * `mw` only as `mw board go <issue-url> --json`.
 * @param {unknown} command
 * @param {unknown} args
 * @param {number} [uid] the host user pty-host runs as
 */
export function isAllowedExec(command, args, uid = process.getuid()) {
  if (command === 'claude') return true;
  if (command === 'mw') {
    return (
      Array.isArray(args) &&
      args.length === 4 &&
      args[0] === 'board' &&
      args[1] === 'go' &&
      typeof args[2] === 'string' &&
      ISSUE_URL_RE.test(args[2]) &&
      args[3] === '--json'
    );
  }
  return (
    command === 'launchctl' &&
    Array.isArray(args) &&
    args.length === 2 &&
    args[0] === 'kickstart' &&
    args[1] === `gui/${uid}/${MW_BOARD_JOB}`
  );
}
