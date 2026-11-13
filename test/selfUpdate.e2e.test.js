// macOS self-update end to end against a local fake GitHub (scripts/review/126/fake-github.mjs) via
// ORKUMO_UPDATE_FEED: release feed → *-mac.yml → zip download + sha512 → ditto staging → quarantine cleared
// → codesign check → swap helper (no relaunch) replaces a fake installed Orkumo.app.
import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { setupUpdater } from '../electron/updater.js';

const quiet = { log: () => {}, error: () => {} };
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

function sh(file, args) {
  const r = spawnSync(file, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${file} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A minimal, ad-hoc signed Orkumo.app at `version`. */
function makeApp(dir, version) {
  const app = path.join(dir, 'Orkumo.app');
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'Orkumo'), '#!/bin/sh\nexit 0\n', {
    mode: 0o755,
  });
  const plist = path.join(app, 'Contents', 'Info.plist');
  sh('/usr/bin/plutil', ['-create', 'xml1', plist]);
  for (const [key, value] of [
    ['CFBundleIdentifier', 'com.devorbit.dashboard'],
    ['CFBundleShortVersionString', version],
    ['CFBundleExecutable', 'Orkumo'],
  ]) {
    sh('/usr/bin/plutil', ['-insert', key, '-string', value, plist]);
  }
  sh('/usr/bin/codesign', ['-s', '-', '--force', app]);
  return app;
}

const plistVersion = (app) =>
  sh('/usr/bin/plutil', [
    '-extract',
    'CFBundleShortVersionString',
    'raw',
    '-o',
    '-',
    path.join(app, 'Contents', 'Info.plist'),
  ]);

/** Release dir as electron-builder + merge-mac-yml leave it: both zips and one latest-mac.yml. */
function publish(feedRoot, version, { corruptSha = false } = {}) {
  const build = fs.mkdtempSync(path.join(os.tmpdir(), 'orkumo-build-'));
  const app = makeApp(build, version);
  // like a browser download: the update must come out without it
  sh('/usr/bin/xattr', ['-w', 'com.apple.quarantine', '0081;00000000;Safari;', app]);
  const release = path.join(feedRoot, `v${version}`);
  fs.mkdirSync(release, { recursive: true });
  const files = [];
  for (const name of [`Orkumo-${version}-arm64-mac.zip`, `Orkumo-${version}-mac.zip`]) {
    const zip = path.join(release, name);
    sh('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
    const data = fs.readFileSync(zip);
    const sha512 = crypto
      .createHash('sha512')
      .update(corruptSha ? Buffer.concat([data, Buffer.from('x')]) : data)
      .digest('base64');
    files.push(`  - url: ${name}\n    sha512: ${sha512}\n    size: ${data.length}`);
  }
  fs.writeFileSync(
    path.join(release, 'latest-mac.yml'),
    `version: ${version}\nfiles:\n${files.join('\n')}\nreleaseDate: '2026-11-13T00:00:00.000Z'\n`
  );
  fs.rmSync(build, { recursive: true, force: true });
}

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

describe.runIf(process.platform === 'darwin')('macOS self-update against a local feed', () => {
  let work;
  let feedRoot;
  let server;
  let feed;

  beforeAll(async () => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'orkumo-e2e-'));
    feedRoot = path.join(work, 'feed');
    fs.mkdirSync(feedRoot);
    publish(feedRoot, '1.0.0-rc.8');
    publish(feedRoot, '1.0.0-rc.9');
    const port = await freePort();
    feed = `http://127.0.0.1:${port}`;
    server = spawn(
      process.execPath,
      ['scripts/review/126/fake-github.mjs', feedRoot, String(port)],
      {
        stdio: ['ignore', 'pipe', 'inherit'],
      }
    );
    await new Promise((resolve, reject) => {
      server.stdout.on('data', (d) => String(d).includes('fake github on') && resolve());
      server.once('exit', (code) => reject(new Error(`fake github exited ${code}`)));
    });
  }, 30000);

  afterAll(() => {
    server?.kill();
    if (work) fs.rmSync(work, { recursive: true, force: true });
  });

  function updater(currentVersion, dir) {
    const applications = path.join(dir, 'Applications');
    fs.mkdirSync(applications, { recursive: true });
    const bundlePath = makeApp(applications, currentVersion);
    const statuses = [];
    const u = setupUpdater({
      mode: 'swap',
      currentVersion,
      arch,
      env: { ORKUMO_UPDATE_FEED: feed },
      log: quiet,
      updatesDir: path.join(dir, 'updates'),
      bundlePath,
      // the "app" has already quit
      pid: spawnSync('/usr/bin/true').pid,
      onStatus: (s) => statuses.push(s),
    });
    return { u, statuses, bundlePath, applications, updatesDir: path.join(dir, 'updates') };
  }

  it('downloads, verifies, stages the newest rc and swaps it in', async () => {
    const dir = path.join(work, 'ok');
    const { u, statuses, bundlePath, applications, updatesDir } = updater('1.0.0-rc.7', dir);

    const status = await u.check({ manual: true });
    expect(status, status.error).toMatchObject({ state: 'ready', version: '1.0.0-rc.9' });
    expect(statuses.map((s) => s.state)).toContain('downloading');
    expect(statuses.filter((s) => s.state === 'downloading').at(-1).percent).toBe(100);

    const staged = path.join(updatesDir, 'staging', 'Orkumo.app');
    expect(plistVersion(staged)).toBe('1.0.0-rc.9');
    expect(sh('/usr/bin/xattr', [staged])).not.toContain('com.apple.quarantine');
    expect(fs.readdirSync(updatesDir).filter((n) => n.endsWith('.zip'))).toEqual([]);

    // plain quit with a ready update: swap without relaunch
    u.installOnQuit();
    await expect
      .poll(() => fs.readFileSync(path.join(updatesDir, 'swap.log'), 'utf8'), { timeout: 15000 })
      .toContain('updated');
    expect(plistVersion(bundlePath)).toBe('1.0.0-rc.9');
    expect(fs.readdirSync(applications)).toEqual(['Orkumo.app']);
    expect(fs.existsSync(staged)).toBe(false);
    sh('/usr/bin/codesign', ['--verify', '--deep', bundlePath]);
  }, 60000);

  it('refuses a zip whose sha512 does not match its *-mac.yml', async () => {
    publish(feedRoot, '1.0.0-rc.10', { corruptSha: true });
    const dir = path.join(work, 'corrupt');
    const { u, bundlePath, updatesDir } = updater('1.0.0-rc.9', dir);

    const status = await u.check({ manual: true });
    expect(status).toMatchObject({ state: 'error', manual: true });
    expect(status.error).toMatch(/sha512/);
    expect(fs.readdirSync(updatesDir)).toEqual([]);
    expect(u.install().success).toBe(false);
    expect(plistVersion(bundlePath)).toBe('1.0.0-rc.9');
  }, 60000);
});
