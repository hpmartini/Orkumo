/**
 * macOS self-update without a Developer ID. Squirrel.Mac only installs an update whose signature matches the
 * running app's designated requirement, which ad-hoc (CI) and self-signed (local) builds never satisfy across
 * builds. So the update is found on GitHub Releases, its zip is checked against the sha512 of the release's
 * *-mac.yml, unpacked to a staging dir, and swapped in by rename from a detached helper once the app has quit.
 * Nothing here depends on how either bundle is signed.
 */
import { execFile } from 'child_process';
import crypto from 'crypto';
import { once } from 'events';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import yaml from 'js-yaml';

export const BUNDLE_ID = 'com.devorbit.dashboard';

const execFileP = promisify(execFile);
/** @returns {Promise<{ stdout: string }>} */
export const runFile = (file, args) => execFileP(file, args, { encoding: 'utf8', timeout: 120000 });

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** @returns {{ major: number, minor: number, patch: number, pre: string[] } | null} */
export function parseVersion(raw) {
  const m = VERSION_RE.exec(String(raw ?? '').trim());
  if (!m) return null;
  const pre = m[4] ? m[4].split('.') : [];
  if (pre.includes('')) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre };
}

const numeric = (s) => /^\d+$/.test(s);

function compareIdentifiers(a, b) {
  if (numeric(a) && numeric(b)) return Math.sign(Number(a) - Number(b));
  if (numeric(a)) return -1; // semver: numeric identifiers rank below alphanumeric ones
  if (numeric(b)) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Semver precedence: 1.0.0-dev.x < 1.0.0-rc.2 < 1.0.0-rc.10 < 1.0.0. Unparsable versions throw. */
export function compareVersions(a, b) {
  const x = typeof a === 'string' ? parseVersion(a) : a;
  const y = typeof b === 'string' ? parseVersion(b) : b;
  if (!x || !y) throw new Error(`Not a version: ${!x ? a : b}`);
  for (const key of ['major', 'minor', 'patch']) {
    if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1;
  }
  if (!x.pre.length || !y.pre.length) return Math.sign(y.pre.length - x.pre.length);
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const c = compareIdentifiers(x.pre[i], y.pre[i]);
    if (c) return c;
  }
  return Math.sign(x.pre.length - y.pre.length);
}

/** 'stable' for final versions, else the first prerelease identifier ('rc', 'dev'). */
export function channelOf(version) {
  const v = parseVersion(version);
  if (!v) return 'unknown';
  return v.pre.length ? v.pre[0].toLowerCase() : 'stable';
}

/**
 * Whether `candidate` is an update for `current`: final releases for everyone, `-rc.N` only for prerelease
 * installs (rc and local dev builds). Other prerelease forms are ignored: the old `v1.0.0-rc7` tags would
 * otherwise outrank every `-rc.N` (`rc7` > `rc` as identifiers).
 */
export function isUpdateFor(current, candidate) {
  const cur = parseVersion(current);
  const cand = parseVersion(candidate);
  if (!cur || !cand) return false;
  const isFinal = cand.pre.length === 0;
  const isRc = cand.pre.length === 2 && cand.pre[0] === 'rc' && numeric(cand.pre[1]);
  if (!isFinal && !isRc) return false;
  if (!isFinal && cur.pre.length === 0) return false;
  return compareVersions(cand, cur) > 0;
}

/** Release tags from GitHub's releases.atom (published releases only, drafts never appear). */
export function parseReleaseTags(atom) {
  const tags = [];
  for (const m of String(atom).matchAll(/href="[^"]*\/releases\/tag\/([^"/?#]+)"/g)) {
    let tag;
    try {
      tag = decodeURIComponent(m[1]);
    } catch {
      continue;
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/** Newest fitting release among `tags`, or null. */
export function pickRelease(tags, current) {
  let best = null;
  for (const tag of tags) {
    const version = tag.replace(/^v/, '');
    if (!isUpdateFor(current, version)) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { tag, version };
  }
  return best;
}

const SHA512_B64 = /^[A-Za-z0-9+/]{86}==$/;

/** Validated `{ version, files: [{ url, sha512, size }] }` from a *-mac.yml written by electron-builder. */
export function parseMacYml(text) {
  const doc = yaml.load(String(text));
  if (!doc || typeof doc !== 'object') throw new Error('Update metadata is empty');
  const version = String(doc.version ?? '');
  if (!parseVersion(version)) throw new Error(`Update metadata has no valid version: "${version}"`);
  if (!Array.isArray(doc.files) || doc.files.length === 0) {
    throw new Error('Update metadata lists no files');
  }
  const files = doc.files.map((f) => {
    const url = String(f?.url ?? '');
    const sha512 = String(f?.sha512 ?? '');
    // a bare asset name of the same release: nothing absolute, no path segments
    if (!url || url.includes('/') || url.includes('\\') || url.startsWith('.')) {
      throw new Error(`Update metadata has an invalid file name: "${url}"`);
    }
    if (!SHA512_B64.test(sha512)) throw new Error(`Update metadata has no valid sha512 for ${url}`);
    const size = Number(f.size);
    return { url, sha512, size: Number.isSafeInteger(size) && size > 0 ? size : null };
  });
  return { version, files };
}

/** The zip for this machine; same arch rule as electron-updater and scripts/release/merge-mac-yml.mjs. */
export function pickMacZip(files, arch) {
  const zips = files.filter((f) => f.url.endsWith('.zip'));
  return (
    zips.find((f) => (arch === 'arm64' ? f.url.includes('arm64') : !f.url.includes('arm64'))) ??
    null
  );
}

export function assetUrl(releasesBase, tag, name) {
  return `${releasesBase}/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}

async function getText(fetch, url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const error = new Error(`HTTP ${res.status} for ${url}`);
    error.status = res.status;
    throw error;
  }
  return res.text();
}

/**
 * Newest fitting release on the feed. `releasesBase` is https://github.com/<owner>/<repo>/releases or the
 * ORKUMO_UPDATE_FEED test server.
 * @returns {Promise<{ tag: string, version: string } | null>}
 */
export async function findRelease({ releasesBase, currentVersion, fetch }) {
  return pickRelease(
    parseReleaseTags(await getText(fetch, `${releasesBase}.atom`)),
    currentVersion
  );
}

/**
 * The mac zip of a release with its expected sha512/size, from the release's own *-mac.yml.
 * electron-builder names it latest-mac.yml unless a channel is configured, so that one goes first.
 */
export async function findMacZip({ releasesBase, release, arch, fetch }) {
  const names = ['latest-mac.yml', `${channelOf(release.version)}-mac.yml`];
  let lastError = null;
  for (const name of [...new Set(names)]) {
    let meta;
    try {
      meta = parseMacYml(await getText(fetch, assetUrl(releasesBase, release.tag, name)));
    } catch (error) {
      lastError = error;
      if (error.status === 404) continue;
      throw error;
    }
    if (meta.version !== release.version) {
      throw new Error(
        `${name} of ${release.tag} describes ${meta.version}, not ${release.version}`
      );
    }
    const file = pickMacZip(meta.files, arch);
    if (!file) throw new Error(`${release.tag} has no ${arch} zip`);
    return { ...file, downloadUrl: assetUrl(releasesBase, release.tag, file.url) };
  }
  throw new Error(`${release.tag} has no *-mac.yml (${lastError?.message ?? 'not found'})`);
}

/**
 * Streams `url` to `dest` while hashing it; the file only appears under `dest` when size and sha512 match.
 * @param {{ url: string, dest: string, sha512: string, size?: number|null, fetch: Function,
 *   onProgress?: (received: number, total: number) => void }} options
 */
export async function downloadVerified({ url, dest, sha512, size, fetch, onProgress }) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  const total = size || Number(res.headers.get('content-length')) || 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const hash = crypto.createHash('sha512');
  const out = fs.createWriteStream(part);
  let writeError = null;
  out.on('error', (error) => (writeError = error)); // disk full etc.: surfaces in the loop
  let received = 0;
  try {
    for await (const chunk of res.body) {
      if (writeError) throw writeError;
      const buf = Buffer.from(chunk);
      hash.update(buf);
      received += buf.length;
      if (size && received > size)
        throw new Error(`Download is larger than the expected ${size} bytes`);
      if (!out.write(buf)) await once(out, 'drain');
      onProgress?.(received, total);
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    if (size && received !== size) {
      throw new Error(`Download is incomplete: ${received} of ${size} bytes`);
    }
    if (hash.digest('base64') !== sha512) {
      throw new Error('Download does not match its sha512: corrupt or tampered with');
    }
    fs.renameSync(part, dest);
  } catch (error) {
    // a stream destroyed before its file opened still opens it: remove the file only once it is closed
    if (!out.closed) {
      const closed = once(out, 'close').catch(() => {});
      out.destroy();
      await closed;
    }
    fs.rmSync(part, { force: true });
    throw writeError ?? error;
  }
  return dest;
}

async function plistValue(run, plist, key) {
  const { stdout } = await run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist]);
  return String(stdout).trim();
}

/**
 * Unpacks the verified zip into `dir` and checks that it is Orkumo at `version` and intact.
 * @returns {Promise<string>} path of the staged .app
 */
export async function stageBundle({ zip, dir, version, bundleId = BUNDLE_ID, run = runFile }) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // ditto keeps the bundle's symlinks, modes and signature resources intact (unzip does not reliably)
  await run('/usr/bin/ditto', ['-x', '-k', zip, dir]);
  const apps = fs.readdirSync(dir).filter((name) => name.endsWith('.app'));
  if (apps.length !== 1) throw new Error(`Expected one .app in the update, found ${apps.length}`);
  const app = path.join(dir, apps[0]);
  const plist = path.join(app, 'Contents', 'Info.plist');
  const id = await plistValue(run, plist, 'CFBundleIdentifier');
  if (id !== bundleId) throw new Error(`The update is not Orkumo (bundle id ${id})`);
  const staged = await plistValue(run, plist, 'CFBundleShortVersionString');
  if (staged !== version) throw new Error(`The update is version ${staged}, expected ${version}`);
  await run('/usr/bin/xattr', ['-cr', app]);
  // any valid signature (ad-hoc, self-signed, Developer ID): only proves the bundle is complete, which
  // Apple Silicon needs to launch it at all
  await run('/usr/bin/codesign', ['--verify', '--deep', app]);
  return app;
}

/** POSIX single-quoting: safe for any path, including spaces, quotes and `$`. */
export function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Helper script that swaps `bundle` for `staged` once process `pid` is gone. Swaps by rename, never by copying
 * over the old bundle: detached PTY holders (server/services/heldPty.js) keep running the old binary, and
 * rewriting files a running process has mapped gets it killed by the code-signing checks. Every failure puts
 * the old bundle back and starts it again.
 */
export function swapScript({ pid, bundle, staged, relaunch = true }) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Invalid pid: ${pid}`);
  for (const p of [bundle, staged]) {
    if (!path.isAbsolute(p) || !p.endsWith('.app'))
      throw new Error(`Not an absolute .app path: ${p}`);
  }
  const parent = path.dirname(bundle);
  const name = path.basename(bundle);
  // siblings of the bundle (same volume: the swap itself is two renames), without the .app suffix so
  // LaunchServices never registers them
  const incoming = path.join(parent, `.${name}.update-incoming`);
  const backup = path.join(parent, `.${name}.update-backup`);
  return `#!/bin/sh
# Orkumo self-update (electron/selfUpdate.js): swaps the app bundle by rename once the app has quit
pid=${pid}
bundle=${shQuote(bundle)}
staged=${shQuote(staged)}
incoming=${shQuote(incoming)}
backup=${shQuote(backup)}
relaunch=${relaunch ? 1 : 0}
say() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }
start() { if [ "$relaunch" = 1 ]; then open "$bundle"; fi; }
n=0
while kill -0 "$pid" 2>/dev/null; do
  n=$((n + 1))
  if [ "$n" -ge 600 ]; then say "Orkumo (pid $pid) did not quit within 60 s, update not installed"; exit 1; fi
  sleep 0.1
done
rm -rf "$incoming" "$backup"
# a copy if the update sits on another volume; the installed app is untouched until it is complete
if ! mv "$staged" "$incoming"; then
  say "cannot move the update next to $bundle"; rm -rf "$incoming"; start; exit 1
fi
if ! mv "$bundle" "$backup"; then
  say "cannot move $bundle aside"; rm -rf "$incoming"; start; exit 1
fi
if ! mv "$incoming" "$bundle"; then
  say "cannot move the update into place, rolling back"
  mv "$backup" "$bundle" || say "ROLLBACK FAILED, the previous app is at $backup"
  rm -rf "$incoming"; start; exit 1
fi
xattr -dr com.apple.quarantine "$bundle" 2>/dev/null
if [ "$relaunch" = 1 ] && ! open "$bundle"; then
  say "the update does not start, rolling back"
  mv "$bundle" "$incoming" && mv "$backup" "$bundle" || say "ROLLBACK FAILED, the previous app is at $backup"
  rm -rf "$incoming"; open "$bundle"; exit 1
fi
rm -rf "$backup"
say "updated $bundle"
`;
}

/**
 * Writes the swap script to `<updatesDir>/swap.sh` and starts it detached, logging to swap.log; the caller
 * quits the app right after.
 */
export function launchSwap({ updatesDir, spawn, ...options }) {
  const script = swapScript(options);
  fs.mkdirSync(updatesDir, { recursive: true });
  const file = path.join(updatesDir, 'swap.sh');
  fs.writeFileSync(file, script, { mode: 0o700 });
  const log = fs.openSync(path.join(updatesDir, 'swap.log'), 'a');
  try {
    spawn('/bin/sh', [file], { detached: true, stdio: ['ignore', log, log] }).unref();
  } finally {
    fs.closeSync(log);
  }
  return file;
}

/**
 * The bundle can be swapped in place: a real .app (not App Translocation's read-only copy of an app started
 * from Downloads or a dmg) in a folder this user may write to.
 */
export function canSwapBundle(bundle, access = fs.accessSync) {
  if (!bundle.endsWith('.app') || bundle.includes('/AppTranslocation/')) return false;
  try {
    access(path.dirname(bundle), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
