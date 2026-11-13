import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  resolveUpdateMode,
  setupUpdater,
  checkWithFinalFallback,
  feedOverride,
  isDeveloperIdSigned,
  readAutoUpdateSetting,
  releasePageUrl,
  releasesBase,
  GITHUB_FEED,
  RELEASES_URL,
  CHECK_INTERVAL_MS,
} from '../electron/updater.js';

const quiet = { log: () => {}, error: () => {} };
const SHA = 'A'.repeat(86) + '==';

function fakeUpdater(currentVersion = '1.0.0-rc.1') {
  const u = new EventEmitter();
  Object.assign(u, {
    currentVersion,
    allowPrerelease: true,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => ({ isUpdateAvailable: false })),
    downloadUpdate: vi.fn(async () => {}),
    quitAndInstall: vi.fn(),
  });
  return u;
}

/** fetch answering from a { url: body | status } map */
function fakeFetch(routes) {
  return vi.fn(async (url) => {
    const hit = routes[url];
    if (hit === undefined || typeof hit === 'number') {
      return { ok: false, status: hit ?? 404, text: async () => '' };
    }
    return { ok: true, status: 200, text: async () => hit };
  });
}

const atom = (...tags) =>
  `<feed>${tags.map((t) => `<entry><link rel="alternate" href="https://github.com/hpmartini/Orkumo/releases/tag/${t}"/></entry>`).join('')}</feed>`;

const tmpDirs = [];
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orkumo-updater-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

function wire(mode, overrides = {}) {
  const autoUpdater = fakeUpdater(overrides.currentVersion);
  const statuses = [];
  const updater = setupUpdater({
    mode,
    autoUpdater,
    currentVersion: '1.0.0-rc.1',
    env: {},
    log: quiet,
    fetch: fakeFetch({}),
    updatesDir: tmp(),
    bundlePath: '/Applications/Orkumo.app',
    onStatus: (s) => statuses.push(s),
    now: () => 1000,
    ...overrides,
  });
  return { autoUpdater, updater, statuses };
}

describe('resolveUpdateMode', () => {
  const base = {
    isDev: false,
    env: {},
    hasUpdateConfig: true,
    macSigned: () => true,
    canSwap: () => true,
  };
  it.each([
    ['dev build', { isDev: true, platform: 'darwin' }, 'off'],
    [
      'disabled by env',
      { platform: 'linux', env: { ORKUMO_DISABLE_UPDATES: '1', APPIMAGE: '/a' } },
      'off',
    ],
    ['linux AppImage', { platform: 'linux', env: { APPIMAGE: '/x/Orkumo.AppImage' } }, 'install'],
    ['linux .deb/.rpm (no APPIMAGE)', { platform: 'linux' }, 'notify'],
    ['mac Developer ID', { platform: 'darwin' }, 'install'],
    [
      'mac ad-hoc / self-signed, writable folder',
      { platform: 'darwin', macSigned: () => false },
      'swap',
    ],
    [
      'mac without app-update.yml (local build)',
      { platform: 'darwin', hasUpdateConfig: false },
      'swap',
    ],
    [
      'mac ad-hoc, read-only folder or translocated',
      { platform: 'darwin', macSigned: () => false, canSwap: () => false },
      'notify',
    ],
    ['other platform', { platform: 'win32' }, 'notify'],
  ])('%s → %s', (_name, over, expected) => {
    expect(resolveUpdateMode({ ...base, ...over })).toBe(expected);
  });

  it('does not run codesign without app-update.yml', () => {
    const macSigned = vi.fn(() => true);
    resolveUpdateMode({ ...base, platform: 'darwin', hasUpdateConfig: false, macSigned });
    expect(macSigned).not.toHaveBeenCalled();
  });
});

describe('isDeveloperIdSigned', () => {
  const devId =
    'Executable=/x\nAuthority=Developer ID Application: Martini Labs (ABC123)\nAuthority=Apple Root CA';
  const spawn = (stderr) => () => ({ status: 0, stdout: '', stderr });
  it('accepts a Developer ID authority (codesign prints to stderr)', () => {
    expect(isDeveloperIdSigned('/A.app', spawn(devId))).toBe(true);
  });
  it('ignores stdout', () => {
    expect(isDeveloperIdSigned('/A.app', () => ({ stdout: devId, stderr: '' }))).toBe(false);
  });
  it('rejects ad-hoc, self-signed and unsigned', () => {
    expect(isDeveloperIdSigned('/A.app', spawn('Signature=adhoc\nTeamIdentifier=not set'))).toBe(
      false
    );
    expect(isDeveloperIdSigned('/A.app', spawn('Authority=BoxSync Local Signing'))).toBe(false);
    expect(
      isDeveloperIdSigned('/A.app', () => ({
        status: 1,
        stderr: 'code object is not signed at all',
      }))
    ).toBe(false);
  });
  it.runIf(process.platform === 'darwin')(
    'real codesign: a system app is not Developer ID signed',
    () => {
      expect(isDeveloperIdSigned('/System/Applications/Calculator.app')).toBe(false);
    }
  );
});

describe('feedOverride / releasesBase', () => {
  it('maps an http(s) URL to a GitHub-compatible host', () => {
    expect(feedOverride({ ORKUMO_UPDATE_FEED: 'http://127.0.0.1:18126' })).toEqual({
      ...GITHUB_FEED,
      host: '127.0.0.1:18126',
      protocol: 'http',
    });
    expect(releasesBase({ ORKUMO_UPDATE_FEED: 'http://127.0.0.1:18126' })).toBe(
      'http://127.0.0.1:18126/hpmartini/Orkumo/releases'
    );
    expect(releasesBase({})).toBe(RELEASES_URL);
  });
  it.each([
    'file:///etc',
    'javascript:alert(1)',
    'not a url',
    '',
    'https://evil.example',
    'http://10.0.0.1:80',
  ])('ignores %s', (value) => {
    expect(feedOverride({ ORKUMO_UPDATE_FEED: value })).toBeNull();
    expect(releasesBase({ ORKUMO_UPDATE_FEED: value })).toBe(RELEASES_URL);
  });
});

describe('readAutoUpdateSetting', () => {
  it('defaults to on; only an explicit false turns it off', () => {
    const dir = tmp();
    expect(readAutoUpdateSetting(dir)).toBe(true);
    fs.writeFileSync(path.join(dir, 'settings.json'), '{"linkTarget":"builtin"}');
    expect(readAutoUpdateSetting(dir)).toBe(true);
    fs.writeFileSync(path.join(dir, 'settings.json'), '{"autoUpdate":false}');
    expect(readAutoUpdateSetting(dir)).toBe(false);
    fs.writeFileSync(path.join(dir, 'settings.json'), '{broken');
    expect(readAutoUpdateSetting(dir)).toBe(true);
  });
});

describe('setupUpdater', () => {
  it('off mode: no listeners, checks are no-ops', async () => {
    const { autoUpdater, updater, statuses } = wire('off');
    expect(autoUpdater.listenerCount('error')).toBe(0);
    expect((await updater.check()).state).toBe('idle');
    expect(statuses).toEqual([]);
  });

  it('reports version and channel before any check', () => {
    const { updater } = wire('swap', { currentVersion: '1.0.0-dev.abc1234' });
    expect(updater.getStatus()).toMatchObject({
      state: 'idle',
      currentVersion: '1.0.0-dev.abc1234',
      channel: 'dev',
      lastCheck: null,
    });
  });

  it('install mode: downloads a found update, then Restart installs via Squirrel', async () => {
    const { autoUpdater, updater, statuses } = wire('install');
    autoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '1.0.0-rc.2' },
    });
    const status = await updater.check();
    expect(autoUpdater.downloadUpdate).toHaveBeenCalled();
    expect(status).toMatchObject({ state: 'ready', version: '1.0.0-rc.2' });
    expect(statuses.map((s) => s.state)).toEqual(['checking', 'downloading', 'ready']);
    expect(updater.install()).toEqual({ success: true });
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
  });

  it('install mode keeps app-update.yml unless a test feed is set', () => {
    expect(wire('install').autoUpdater.setFeedURL).not.toHaveBeenCalled();
    const { autoUpdater } = wire('install', { env: { ORKUMO_UPDATE_FEED: 'http://127.0.0.1:1' } });
    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith(
      expect.objectContaining({ host: '127.0.0.1:1' })
    );
  });

  it('a failed check becomes an error status with only the first line (no dialog exists)', async () => {
    const { updater } = wire('swap', {
      fetch: vi.fn(async () => {
        throw new Error('net::ERR_INTERNET_DISCONNECTED\nstack line');
      }),
    });
    const status = await updater.check();
    expect(status).toMatchObject({
      state: 'error',
      error: 'net::ERR_INTERNET_DISCONNECTED',
      manual: false,
    });
  });

  it('notify mode: reports the release page, downloads nothing', async () => {
    const fetch = fakeFetch({ [`${RELEASES_URL}.atom`]: atom('v1.0.0-rc.2', 'v1.0.0-rc.1') });
    const { updater } = wire('notify', { fetch });
    const status = await updater.check({ manual: true });
    expect(status).toMatchObject({
      state: 'available',
      version: '1.0.0-rc.2',
      manual: true,
      releaseUrl: 'https://github.com/hpmartini/Orkumo/releases/tag/v1.0.0-rc.2',
      lastCheck: 1000,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(updater.install().success).toBe(false);
  });

  it('no newer release → none', async () => {
    const fetch = fakeFetch({ [`${RELEASES_URL}.atom`]: atom('v1.0.0-rc.1', 'v1.0.0-rc7') });
    const { updater } = wire('swap', { fetch });
    expect((await updater.check()).state).toBe('none');
  });

  it('swap mode: a release without its *-mac.yml is an error, not a download', async () => {
    const fetch = fakeFetch({ [`${RELEASES_URL}.atom`]: atom('v1.0.0-rc.2') });
    const { updater } = wire('swap', { fetch });
    const status = await updater.check({ manual: true });
    expect(status.state).toBe('error');
    expect(status.error).toMatch(/v1\.0\.0-rc\.2 has no \*-mac\.yml/);
  });

  it('swap mode: a yml for another version is refused', async () => {
    const fetch = fakeFetch({
      [`${RELEASES_URL}.atom`]: atom('v1.0.0-rc.2'),
      [`${RELEASES_URL}/download/v1.0.0-rc.2/latest-mac.yml`]: `version: 1.0.0-rc.3\nfiles:\n  - url: O-arm64-mac.zip\n    sha512: ${SHA}\n    size: 3\n`,
    });
    const { updater } = wire('swap', { fetch });
    expect((await updater.check()).error).toMatch(/describes 1\.0\.0-rc\.3/);
  });

  it('only one check runs at a time', async () => {
    let release;
    const fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, status: 200, text: async () => atom() });
        })
    );
    const { updater } = wire('swap', { fetch });
    const a = updater.check();
    const b = updater.check({ manual: true });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release();
    expect(await a).toBe(await b);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('automatic checks: after the delay, then every 6 h, only while the toggle is on', async () => {
    vi.useFakeTimers();
    let auto = true;
    const fetch = fakeFetch({ [`${RELEASES_URL}.atom`]: atom() });
    const { updater } = wire('swap', { fetch, isAutoEnabled: () => auto });
    const stop = updater.start({ delay: 5000 });
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetch).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    auto = false;
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(fetch).toHaveBeenCalledTimes(1);
    auto = true;
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(fetch).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 3);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('swap mode: ready → Restart starts the detached swap helper, then quits; once', async () => {
    const zip = Buffer.from('zip bytes');
    const sha512 = (await import('crypto')).createHash('sha512').update(zip).digest('base64');
    const routes = {
      [`${RELEASES_URL}.atom`]: atom('v1.0.0-rc.2'),
      [`${RELEASES_URL}/download/v1.0.0-rc.2/latest-mac.yml`]: `version: 1.0.0-rc.2\nfiles:\n  - url: Orkumo-1.0.0-rc.2-arm64-mac.zip\n    sha512: ${sha512}\n    size: ${zip.length}\n  - url: Orkumo-1.0.0-rc.2-mac.zip\n    sha512: ${sha512}\n    size: ${zip.length}\n`,
    };
    const fetch = vi.fn(async (url) => {
      if (url.endsWith('.zip')) {
        return {
          ok: true,
          status: 200,
          headers: new globalThis.Headers(),
          body: (async function* () {
            yield zip;
          })(),
        };
      }
      return { ok: true, status: 200, text: async () => routes[url] };
    });
    const run = vi.fn(async (file, args) => {
      if (file.endsWith('ditto'))
        fs.mkdirSync(path.join(args[3], 'Orkumo.app', 'Contents'), { recursive: true });
      if (file.endsWith('plutil')) {
        return {
          stdout: args[1] === 'CFBundleIdentifier' ? 'com.devorbit.dashboard\n' : '1.0.0-rc.2\n',
        };
      }
      return { stdout: '' };
    });
    const unref = vi.fn();
    const spawn = vi.fn(() => ({ unref }));
    const quit = vi.fn();
    let auto = true;
    const { updater, statuses } = wire('swap', {
      fetch,
      run,
      spawn,
      quit,
      arch: 'arm64',
      pid: 4242,
      isAutoEnabled: () => auto,
    });

    const status = await updater.check();
    expect(status, status.error).toMatchObject({
      state: 'ready',
      version: '1.0.0-rc.2',
      manual: false,
    });
    expect(fetch).toHaveBeenCalledWith(
      `${RELEASES_URL}/download/v1.0.0-rc.2/Orkumo-1.0.0-rc.2-arm64-mac.zip`,
      expect.anything()
    );
    expect(run.mock.calls.map(([file]) => path.basename(file))).toEqual([
      'ditto',
      'plutil',
      'plutil',
      'xattr',
      'codesign',
    ]);
    expect(statuses.map((s) => s.state)).toEqual([
      'checking',
      'downloading',
      'downloading',
      'ready',
    ]);

    // a ready update is kept: no second download
    await updater.check({ manual: true });
    expect(fetch).toHaveBeenCalledTimes(3);

    // plain quit with auto-update off: the update waits for Restart
    auto = false;
    updater.installOnQuit();
    expect(spawn).not.toHaveBeenCalled();
    auto = true;

    expect(updater.install()).toEqual({ success: true });
    const [shell, [script], options] = spawn.mock.calls[0];
    expect(shell).toBe('/bin/sh');
    expect(options).toMatchObject({ detached: true });
    expect(unref).toHaveBeenCalled();
    expect(fs.readFileSync(script, 'utf8')).toContain('pid=4242');
    expect(fs.readFileSync(script, 'utf8')).toContain('relaunch=1');
    expect(quit).toHaveBeenCalledTimes(1);
    updater.installOnQuit(); // before-quit after Restart: the helper already runs
    expect(updater.install().success).toBe(false);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('install without a downloaded update is refused', () => {
    const quit = vi.fn();
    const { updater } = wire('swap', { quit });
    expect(updater.install()).toEqual({ success: false, error: 'No downloaded update to install' });
    expect(quit).not.toHaveBeenCalled();
  });
});

describe('checkWithFinalFallback (AC-5)', () => {
  it('rc without newer rc: checks final releases too', async () => {
    const u = fakeUpdater('1.0.0-rc.2');
    const seen = [];
    u.checkForUpdates.mockImplementation(async () => {
      seen.push(u.allowPrerelease);
      return { isUpdateAvailable: !u.allowPrerelease };
    });
    const { result } = await checkWithFinalFallback(u, quiet);
    expect(seen).toEqual([true, false]);
    expect(result.isUpdateAvailable).toBe(true);
    expect(u.allowPrerelease).toBe(true);
  });

  it('rc with newer rc: one check', async () => {
    const u = fakeUpdater('1.0.0-rc.1');
    u.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true });
    await checkWithFinalFallback(u, quiet);
    expect(u.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('final version: one check', async () => {
    const u = fakeUpdater('1.0.0');
    await checkWithFinalFallback(u, quiet);
    expect(u.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('both checks failing never throws and returns the error', async () => {
    const u = fakeUpdater('1.0.0-rc.1');
    u.checkForUpdates.mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED'));
    const { result, error } = await checkWithFinalFallback(u, quiet);
    expect(result).toBeNull();
    expect(error.message).toBe('net::ERR_INTERNET_DISCONNECTED');
  });
});

it('releasePageUrl encodes the version', () => {
  expect(releasePageUrl('1.0.0-rc.2')).toBe(
    'https://github.com/hpmartini/Orkumo/releases/tag/v1.0.0-rc.2'
  );
  expect(releasePageUrl('1/../../x')).not.toContain('/../');
});
