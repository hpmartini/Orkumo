/**
 * Mesh (Tailscale + SSH) helpers for remote agents: device list from `tailscale status --json`,
 * host validation and the ssh argument arrays for list, logs and attach.
 *
 * The remote command is always ONE fixed argument built from a validated session id, never
 * user text. Mirrored in server/services/meshHosts.js - keep both in sync (the parity test in
 * meshHosts.test.ts fails otherwise).
 */

/** DNS name or IPv4 as reported by Tailscale; no leading '-' so it can never become an ssh option. */
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,62})(?:\.[a-z0-9](?:[a-z0-9-]{0,62}))*$/i;
/** Same as SHORT_ID_RE in server/services/agentService.js (`claude attach <id>`). */
const SESSION_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5'];
const SUPPORTED_OS = new Set(['macOS', 'linux']);

export type MeshOs = 'macOS' | 'linux';

export interface MeshDevice {
  /** ssh target: MagicDNS name without trailing dot (Tailscale IP when DNS is off) */
  host: string;
  name: string;
  os: MeshOs;
  online: boolean;
}

export type MeshDeviceState = 'ok' | 'offline' | 'ssh-denied' | 'claude-missing' | 'error';

interface TailscalePeer {
  HostName?: string;
  DNSName?: string;
  OS?: string;
  Online?: boolean;
  TailscaleIPs?: string[];
}

/** Peers that can run Claude Code (macOS/Linux), excluding this machine (`Self`). */
export function parseTailscaleStatus(status: unknown): MeshDevice[] {
  const peers = (status as { Peer?: Record<string, TailscalePeer> } | null)?.Peer || {};
  const devices: MeshDevice[] = [];
  for (const peer of Object.values(peers)) {
    if (!peer || !SUPPORTED_OS.has(peer.OS || '')) continue;
    const host = (peer.DNSName || '').replace(/\.$/, '') || peer.TailscaleIPs?.[0] || '';
    if (!HOST_RE.test(host)) continue;
    devices.push({
      host,
      name: peer.HostName || host.split('.')[0],
      os: peer.OS as MeshOs,
      online: peer.Online === true,
    });
  }
  return devices.sort((a, b) => a.name.localeCompare(b.name));
}

/** Session ids from a remote device are untrusted; anything else is dropped from the list. */
export function isSessionId(id: unknown): id is string {
  return typeof id === 'string' && SESSION_ID_RE.test(id);
}

/** A host is usable only when it is well-formed AND an online device of the current list. */
export function isKnownHost(host: unknown, devices: MeshDevice[]): host is string {
  return (
    typeof host === 'string' &&
    HOST_RE.test(host) &&
    devices.some((d) => d.online && d.host === host)
  );
}

function assertTarget(host: string, id?: string): void {
  if (!HOST_RE.test(host)) throw new Error('Invalid host');
  if (id !== undefined && !SESSION_ID_RE.test(id)) throw new Error('Invalid session id');
}

/** `ssh <host> claude agents --json` (stdin closed: -n) */
export function buildSshListArgs(host: string): string[] {
  assertTarget(host);
  return ['-n', ...SSH_OPTS, host, 'claude agents --json'];
}

/** `ssh <host> claude logs <id>` */
export function buildSshLogsArgs(host: string, id: string): string[] {
  assertTarget(host, id);
  return ['-n', ...SSH_OPTS, host, `claude logs ${id}`];
}

/** `ssh -t <host> claude attach <id>` for a PTY tab */
export function buildSshAttachArgs(host: string, id: string): string[] {
  assertTarget(host, id);
  return ['-t', ...SSH_OPTS, host, `claude attach ${id}`];
}

/** PTY allowlist: args must be exactly what buildSshAttachArgs makes for a known host. */
export function isAttachArgs(args: unknown, devices: MeshDevice[]): boolean {
  if (!Array.isArray(args)) return false;
  const host = args[args.length - 2];
  const id = /^claude attach (\S+)$/.exec(String(args[args.length - 1]))?.[1];
  if (!isKnownHost(host, devices) || !id || !SESSION_ID_RE.test(id)) return false;
  return JSON.stringify(args) === JSON.stringify(buildSshAttachArgs(host, id));
}

/**
 * Device state from a failed ssh call. ssh exits 255 for its own (connection/auth) errors,
 * otherwise with the remote command's code (127: command not found).
 */
export function classifySshFailure(
  code: number | null,
  stderr: string,
  timedOut = false
): { state: MeshDeviceState; reason: string } {
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
