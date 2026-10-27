/**
 * Mesh (Tailscale + SSH) pure helpers. Mirrors utils/meshHosts.ts - keep in sync
 * (utils/meshHosts.test.ts runs both against the same cases). Not imported directly from
 * the server because the Docker images run `node server/index.js` on Node 20 (no TS type
 * stripping) and copy only server/.
 */

const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,62})(?:\.[a-z0-9](?:[a-z0-9-]{0,62}))*$/i;
const SESSION_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;
// No agent or port forwarding to tailnet devices, whatever ~/.ssh/config says
const SSH_OPTS = [
  '-o',
  'BatchMode=yes',
  '-o',
  'ConnectTimeout=5',
  '-o',
  'ForwardAgent=no',
  '-o',
  'ClearAllForwardings=yes',
];
const SUPPORTED_OS = new Set(['macOS', 'linux']);

export function parseTailscaleStatus(status) {
  const peers = status?.Peer || {};
  const devices = [];
  for (const peer of Object.values(peers)) {
    if (!peer || !SUPPORTED_OS.has(peer.OS || '')) continue;
    const host = (peer.DNSName || '').replace(/\.$/, '') || peer.TailscaleIPs?.[0] || '';
    if (!HOST_RE.test(host)) continue;
    devices.push({
      host,
      name: peer.HostName || host.split('.')[0],
      os: peer.OS,
      online: peer.Online === true,
    });
  }
  return devices.sort((a, b) => a.name.localeCompare(b.name));
}

export function isSessionId(id) {
  return typeof id === 'string' && SESSION_ID_RE.test(id);
}

export function isKnownHost(host, devices) {
  return (
    typeof host === 'string' &&
    HOST_RE.test(host) &&
    devices.some((d) => d.online && d.host === host)
  );
}

function assertTarget(host, id) {
  if (!HOST_RE.test(host)) throw new Error('Invalid host');
  if (id !== undefined && !SESSION_ID_RE.test(id)) throw new Error('Invalid session id');
}

export function buildSshListArgs(host) {
  assertTarget(host);
  return ['-n', ...SSH_OPTS, host, 'claude agents --json'];
}

export function buildSshLogsArgs(host, id) {
  assertTarget(host, id);
  return ['-n', ...SSH_OPTS, host, `claude logs ${id}`];
}

export function buildSshAttachArgs(host, id) {
  assertTarget(host, id);
  return ['-t', ...SSH_OPTS, host, `claude attach ${id}`];
}

export function isAttachArgs(args, devices) {
  if (!Array.isArray(args)) return false;
  const host = args[args.length - 2];
  const id = /^claude attach (\S+)$/.exec(String(args[args.length - 1]))?.[1];
  if (!isKnownHost(host, devices) || !id || !SESSION_ID_RE.test(id)) return false;
  return JSON.stringify(args) === JSON.stringify(buildSshAttachArgs(host, id));
}

export function classifySshFailure(code, stderr, timedOut = false) {
  const reason = stderr.trim().split('\n').filter(Boolean).pop() || '';
  if (timedOut) return { state: 'offline', reason: reason || 'timed out' };
  if (code === 255) {
    if (/permission denied|host key verification failed|too many authentication/i.test(stderr)) {
      return { state: 'ssh-denied', reason };
    }
    return { state: 'offline', reason };
  }
  if (code === 127 || /command not found|claude: not found/i.test(stderr)) {
    return { state: 'claude-missing', reason: reason || 'claude not in PATH' };
  }
  return { state: 'error', reason: reason || `exit code ${code}` };
}
