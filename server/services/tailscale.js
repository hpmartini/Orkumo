/**
 * This machine's Tailscale identity (MagicDNS name, serve share) for the pairing links (#120).
 * Uses the `tailscale` CLI from PATH, else the macOS app binary; null without Tailscale.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

const TAILSCALE_APP = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';

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

/** `tailscale <args>` output as JSON, or null without Tailscale or on any error. */
function tailscaleJson(args) {
  const bin = resolveTailscale();
  if (!bin) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (_e, out) => {
      try {
        resolve(JSON.parse(String(out)));
      } catch {
        resolve(null);
      }
    });
  });
}

/** MagicDNS name of this machine (e.g. `mac.tail1234.ts.net`), or null without Tailscale. */
export async function getSelfDnsName() {
  return (await tailscaleJson(['status', '--json']))?.Self?.DNSName?.replace(/\.$/, '') || null;
}

const proxiesTo = (proxy, port) => {
  try {
    const url = new URL(proxy);
    return ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === String(port);
  } catch {
    return false;
  }
};

/**
 * Address of the `tailscale serve` share that relays to `port` (`serve status --json`: `Web` keys
 * are `host:port`, handlers carry the `Proxy` target), e.g. `https://mac.tail1.ts.net:3443`; null if none.
 */
export function serveUrlFrom(status, port) {
  for (const [hostPort, web] of Object.entries(status?.Web ?? {})) {
    if (Object.values(web?.Handlers ?? {}).some((h) => proxiesTo(h?.Proxy, port)))
      return `https://${hostPort.replace(/:443$/, '')}`;
  }
  return null;
}

/** Address of the `tailscale serve` share for this server's port, or null. */
export async function getServeUrl(port) {
  return serveUrlFrom(await tailscaleJson(['serve', 'status', '--json']), port);
}
