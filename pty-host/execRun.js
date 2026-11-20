/**
 * The HTTP /exec request of pty-host: checks the body against the allowlist (execPolicy.js) and runs
 * the command, with optional stdin. The allowlist sees argv only; `input` never becomes an argument.
 */
import { execFile } from 'child_process';
import { isAllowedExec } from './execPolicy.js';

/** Most stdin /exec passes on (docs/WORKFLOW_PROVIDER.md, "control") */
export const MAX_EXEC_INPUT = 16 * 1024;

/**
 * Checked /exec body: `{ command, args, cwd, timeout, input }` or `{ status, error }` to answer with.
 * @param {unknown} body parsed JSON body
 * @param {(command: unknown, args: unknown) => boolean} [allowed]
 */
export function parseExecRequest(body, allowed = isAllowedExec) {
  const { command, args = [], cwd, timeout = 60000, input } = body || {};
  if (!allowed(command, args)) return { status: 403, error: 'Command not allowed' };
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
    return { status: 400, error: '`args` must be a string array' };
  }
  if (input !== undefined) {
    if (typeof input !== 'string') return { status: 400, error: '`input` must be a string' };
    if (Buffer.byteLength(input) > MAX_EXEC_INPUT) {
      return { status: 400, error: `\`input\` exceeds ${MAX_EXEC_INPUT} bytes` };
    }
  }
  return { command, args, cwd, timeout, input };
}

/**
 * Runs `bin` and resolves with `{ code, stdout, stderr }`; never rejects. With `input` the child
 * reads it on stdin, which is then closed.
 */
export const runExec = (bin, args, options) =>
  new Promise((resolve) => {
    const child = execFile(
      bin,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeout,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, ...(options.env || {}) },
      },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          stdout: String(stdout || ''),
          // a missing binary (ENOENT) has no stderr; the API falls back on its message
          stderr:
            (String(stderr || '') || (error?.code === 'ENOENT' ? error.message : '')) +
            (error && error.killed ? '\n(timed out)' : ''),
        });
      }
    );
    if (options.input !== undefined && child.stdin) {
      // a child that exits without reading stdin makes the write fail with EPIPE; its exit code tells
      child.stdin.on('error', () => {});
      child.stdin.end(options.input);
    }
  });
