/**
 * Quick window agents (#251): the quick window starts the default harness as an agent pane of
 * its own (`quick-<uuid>`), held like every agent pane (`openAgentPty`), and shows the agent's
 * transcript through a UI view (chatService). Follow-ups are typed into its terminal. "Open in
 * Orkumo" opens that pane in the main window, which reattaches to the same process; hiding the
 * quick window without it stops the pane.
 */
import crypto from 'crypto';

/** Harnesses whose session id the quick window can learn, so it can read their transcript */
export const QUICK_HARNESSES = Object.freeze(['claude', 'omp']);
const SESSION_WAIT_MS = 20_000;
const SESSION_POLL_MS = 400;

const httpError = (status, message) => Object.assign(new Error(message), { status });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * PTY command line of a quick agent: Claude Code with a known session id (its transcript name),
 * omp with the user's Claude skills; the prompt is the first message.
 */
export function quickAgentCommand({ harness, prompt, sessionId, model, permissionMode }, deps) {
  if (harness === 'claude') {
    return {
      command: 'claude',
      args: [
        '--session-id',
        sessionId,
        ...(model ? ['--model', model] : []),
        ...(permissionMode ? ['--permission-mode', permissionMode] : []),
        // `--` ends the options: a prompt like `--settings=…` stays the first message
        '--',
        prompt,
      ],
    };
  }
  const bin = deps.resolveBinary('omp');
  if (!bin) throw httpError(400, 'Oh My Pi is not installed on this machine');
  return { command: bin, args: [...deps.ompArgs(bin), '--', prompt] };
}

/**
 * Starts a quick agent and waits until its transcript has a session id.
 * @param {{ prompt: string, harness: string, cwd: string, model?: string|null, permissionMode?: string|null,
 *   paneId?: string, env?: object, pathPrefix?: string[] }} opts - paneId, env and pathPrefix: orchestrator
 *   panes (orchestratorService.js) name their pane and find the `orkumo` CLI on PATH
 * @param {{ openAgentPty: Function, killPanePtys: Function, findOmpSession: (paneId: string) => Promise<string|null>,
 *   resolveBinary: (id: string) => string|null, ompArgs: (bin: string) => string[] }} deps
 * @returns {Promise<{ paneId: string, harness: string, sessionId: string, cwd: string }>}
 */
export async function startQuickAgent(opts, deps) {
  if (!QUICK_HARNESSES.includes(opts.harness)) {
    throw httpError(400, 'The quick window answers with Claude Code or Oh My Pi');
  }
  const paneId = opts.paneId ?? `quick-${crypto.randomUUID()}`;
  const claudeSession = opts.harness === 'claude' ? crypto.randomUUID() : null;
  const { command, args } = quickAgentCommand({ ...opts, sessionId: claudeSession }, deps);
  const result = await deps.openAgentPty(`agent-${paneId}-${Date.now()}`, opts.cwd, 100, 30, {
    command,
    args,
    detachOnClose: true,
    ...(opts.env ? { env: opts.env } : {}),
    ...(opts.pathPrefix ? { pathPrefix: opts.pathPrefix } : {}),
  });
  if (!result.success) throw httpError(500, result.error || 'The agent did not start');
  if (claudeSession)
    return { paneId, harness: opts.harness, sessionId: claudeSession, cwd: opts.cwd };

  // omp names its session itself: the session store row that this pane's process holds
  const deadline = Date.now() + (deps.waitMs ?? SESSION_WAIT_MS);
  while (Date.now() < deadline) {
    const sessionId = await deps.findOmpSession(paneId).catch(() => null);
    if (sessionId) return { paneId, harness: opts.harness, sessionId, cwd: opts.cwd };
    await sleep(deps.pollMs ?? SESSION_POLL_MS);
  }
  deps.killPanePtys(paneId);
  throw httpError(504, 'The agent reported no session');
}
