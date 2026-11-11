/**
 * Main agent (#252): the background session the "Main Agent" dialog talks to, by default the
 * martini-workflow main orchestrator (`main-orchestrator`). Keep-alive: when that session is
 * stopped, it is restarted with `claude respawn`. No prompt is sent, so a ping costs no tokens.
 */
export const MAIN_AGENT_DEFAULTS = { name: 'main-orchestrator', keepAlive: true };

/** A failed or pointless respawn is not repeated sooner than this */
export const KEEP_ALIVE_GAP_MS = 5 * 60_000;

/** The main agent among `sessions`: the newest background session with the configured name */
export function findMainAgent(sessions, name = MAIN_AGENT_DEFAULTS.name) {
  return (
    sessions
      .filter((s) => s.kind === 'background' && s.name === name)
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0] ?? null
  );
}

let lastAttempt = -Infinity;

/**
 * Restart the main agent if it is stopped. Called with every fresh session list.
 * @param {object[]} sessions
 * @param {{ config?: { name?: string, keepAlive?: boolean }, respawn: (id: string) => Promise<unknown>, now?: number }} options
 * @returns {Promise<string|null>} id of the respawned session
 */
export async function keepMainAgentAlive(sessions, { config, respawn, now = Date.now() }) {
  const { name, keepAlive } = { ...MAIN_AGENT_DEFAULTS, ...config };
  if (!keepAlive || now - lastAttempt < KEEP_ALIVE_GAP_MS) return null;
  const main = findMainAgent(sessions, name);
  if (!main || main.state !== 'stopped') return null;
  lastAttempt = now;
  await respawn(main.id);
  return main.id;
}

/** Tests only */
export const resetKeepAlive = () => {
  lastAttempt = -Infinity;
};
