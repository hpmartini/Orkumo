/** Which commands the HTTP /exec endpoint runs on the host for the API container (a trust boundary). */

/** launchd job of `mw board install` (mirrors MW_BOARD_JOB in server/services/workflowGo.js) */
const MW_BOARD_JOB = 'de.martini-labs.mw-board';

/**
 * `claude` with any arguments; `launchctl` only to start the mw-board poll of this host user (#145).
 * @param {unknown} command
 * @param {unknown} args
 * @param {number} [uid] the host user pty-host runs as
 */
export function isAllowedExec(command, args, uid = process.getuid()) {
  if (command === 'claude') return true;
  return (
    command === 'launchctl' &&
    Array.isArray(args) &&
    args.length === 2 &&
    args[0] === 'kickstart' &&
    args[1] === `gui/${uid}/${MW_BOARD_JOB}`
  );
}
