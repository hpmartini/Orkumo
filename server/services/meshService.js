/**
 * Mesh Service - Claude Code sessions of the other devices in the Tailscale tailnet.
 *
 * Devices come from `tailscale status --json`; sessions from `ssh <host> claude agents --json`
 * (system ssh, key auth only via BatchMode). Nothing runs on the remote devices besides the
 * unmodified `claude` CLI. All calls use execFile with argument arrays, never a shell.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { deriveDisplayState } from './agentService.js';
import {
  parseTailscaleStatus,
  isKnownHost,
  isSessionId,
  isAttachArgs,
  buildSshListArgs,
  buildSshLogsArgs,
  classifySshFailure,
} from './meshHosts.js';

const TAILSCALE_APP = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
const CACHE_MS = 12000;
// Above ssh's ConnectTimeout=5 so a slow remote `claude` still answers; one hanging device
// only delays the remote list, never the local /api/agents.
const SSH_TIMEOUT = 12000;

/** Last device list from Tailscale; the PTY route validates ssh attach hosts against it. */
let knownDevices = [];
let cache = null;

function resolveTailscale() {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const candidates = [...dirs.map((dir) => path.join(dir, 'tailscale')), TAILSCALE_APP];
  return (
    candidates.find((candidate) => {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }) || null
  );
}

function run(bin, args, timeout) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        code: error ? (typeof error.code === 'number' ? error.code : null) : 0,
        timedOut: !!error?.killed,
        stdout: String(stdout || ''),
        stderr:
          String(stderr || '') || (error && typeof error.code === 'string' ? error.message : ''),
      });
    });
  });
}

function toSession(entry, host) {
  const background = entry.kind === 'background' && entry.id;
  const session = {
    id: background ? entry.id : `interactive-${entry.pid || entry.sessionId}`,
    host,
    sessionId: entry.sessionId || null,
    kind: background ? 'background' : 'interactive',
    cwd: entry.cwd || '',
    startedAt: entry.startedAt || Date.now(),
    name: entry.name || path.posix.basename(entry.cwd || '') || entry.id || 'session',
    state: entry.state || null,
    status: entry.status || null,
    waitingFor: entry.waitingFor || null,
    pid: entry.pid || null,
    pinned: false,
    order: null,
    links: [],
  };
  session.displayState = deriveDisplayState(session);
  return session;
}

async function listDeviceSessions(device) {
  const base = { host: device.host, name: device.name, os: device.os, sessions: [] };
  if (!device.online) return { ...base, state: 'offline', reason: 'offline in Tailscale' };
  const result = await run('ssh', buildSshListArgs(device.host), SSH_TIMEOUT);
  if (result.code !== 0) {
    return { ...base, ...classifySshFailure(result.code, result.stderr, result.timedOut) };
  }
  try {
    const raw = JSON.parse(result.stdout.slice(result.stdout.indexOf('[')));
    // ids feed `claude attach <id>`/logs args; a malformed one from the device is dropped
    const sessions = raw
      .map((entry) => toSession(entry, device.host))
      .filter((s) => isSessionId(s.id));
    return { ...base, state: 'ok', sessions };
  } catch (error) {
    return { ...base, state: 'error', reason: `unreadable claude output: ${error.message}` };
  }
}

async function fetchRemote() {
  const bin = resolveTailscale();
  if (!bin) return { tailscale: false, devices: [] };
  const status = await run(bin, ['status', '--json'], 5000);
  let devices = [];
  try {
    devices = parseTailscaleStatus(JSON.parse(status.stdout));
  } catch {
    return {
      tailscale: true,
      error: status.stderr.trim() || 'tailscale status failed',
      devices: [],
    };
  }
  knownDevices = devices;
  return { tailscale: true, devices: await Promise.all(devices.map(listDeviceSessions)) };
}

/** Devices of the tailnet with their sessions (or why they are unreachable), cached briefly. */
export function listRemote() {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    cache = { at: Date.now(), promise: fetchRemote() };
    // a failed lookup must not stick for the whole cache window
    cache.promise.catch(() => (cache = null));
  }
  return cache.promise;
}

export function isKnownRemoteHost(host) {
  return isKnownHost(host, knownDevices);
}

/** PTY allowlist for `ssh -t <host> claude attach <id>`. */
export function isRemoteAttachArgs(args) {
  return isAttachArgs(args, knownDevices);
}

const logsInFlight = new Map();

/** `claude logs <id>` on the remote device; concurrent polls share one ssh call. */
export function getRemoteLogs(host, id) {
  const key = `${host}/${id}`;
  if (!logsInFlight.has(key)) {
    logsInFlight.set(
      key,
      fetchRemoteLogs(host, id).finally(() => logsInFlight.delete(key))
    );
  }
  return logsInFlight.get(key);
}

async function fetchRemoteLogs(host, id) {
  const result = await run('ssh', buildSshLogsArgs(host, id), SSH_TIMEOUT);
  if (result.code !== 0) {
    const { reason } = classifySshFailure(result.code, result.stderr, result.timedOut);
    return { source: 'logs', text: result.stdout, entries: [], note: reason || null };
  }
  return { source: 'logs', text: result.stdout, entries: [] };
}
