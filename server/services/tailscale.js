/**
 * This machine's Tailscale identity (MagicDNS name) for the iOS pairing link (#120).
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

/** MagicDNS name of this machine (e.g. `mac.tail1234.ts.net`), or null without Tailscale. */
export function getSelfDnsName() {
  const bin = resolveTailscale();
  if (!bin) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      bin,
      ['status', '--json'],
      { timeout: 5000, maxBuffer: 8 * 1024 * 1024 },
      (_e, out) => {
        try {
          resolve(JSON.parse(String(out)).Self?.DNSName?.replace(/\.$/, '') || null);
        } catch {
          resolve(null);
        }
      }
    );
  });
}
