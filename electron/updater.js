/**
 * Auto-update (#126). Modes:
 * - install: electron-updater downloads and installs (Linux AppImage, macOS with Developer ID signature)
 * - swap: macOS without Developer ID; own download + bundle swap (electron/selfUpdate.js)
 * - notify: only reports a new version with its release page (.deb/.rpm, app outside a writable folder)
 * No dialogs: every change goes out as a status (`onStatus`) for the renderer's banner and the Settings
 * section. Background check errors stay in that status and the log (#125: an error sheet pushed the window
 * onto another display).
 */
import { spawn as nodeSpawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import path from 'path';
import {
  BUNDLE_ID,
  canSwapBundle,
  channelOf,
  downloadVerified,
  findMacZip,
  findRelease,
  launchSwap,
  runFile,
  stageBundle,
} from './selfUpdate.js';

export const GITHUB_FEED = { provider: 'github', owner: 'hpmartini', repo: 'Orkumo' };
export const RELEASES_URL = `https://github.com/${GITHUB_FEED.owner}/${GITHUB_FEED.repo}/releases`;
export const FIRST_CHECK_DELAY_MS = 5000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export { canSwapBundle };

/** Squirrel.Mac only accepts an update whose signature matches the running app: needs a Developer ID. */
export function isDeveloperIdSigned(appBundlePath, spawn = spawnSync) {
  // codesign -dv prints the details to stderr, even on success
  const { stderr } = spawn('codesign', ['-dv', '--verbose=2', appBundlePath], {
    encoding: 'utf8',
    timeout: 5000,
  });
  return /^Authority=Developer ID Application/m.test(String(stderr ?? ''));
}

/** @returns {'off' | 'notify' | 'install' | 'swap'} */
export function resolveUpdateMode({ isDev, platform, env, hasUpdateConfig, macSigned, canSwap }) {
  if (isDev) return 'off';
  if (env.ORKUMO_DISABLE_UPDATES === '1') return 'off';
  if (platform === 'linux') return hasUpdateConfig && env.APPIMAGE ? 'install' : 'notify';
  if (platform === 'darwin') {
    // codesign only runs when Squirrel could be used at all
    if (hasUpdateConfig && macSigned()) return 'install';
    return canSwap() ? 'swap' : 'notify';
  }
  return 'notify';
}

/**
 * ORKUMO_UPDATE_FEED=http://host:port: a fake GitHub for the e2e tests (scripts/review/126*, test/), so the
 * real tag/channel logic runs. http(s) on loopback only.
 */
export function feedOverride(env) {
  const raw = env.ORKUMO_UPDATE_FEED;
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // test hook only: never redirect a real install to a remote host
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return null;
  return { ...GITHUB_FEED, host: url.host, protocol: url.protocol.slice(0, -1) };
}

/** github.com/<owner>/<repo>/releases, or the same path on the ORKUMO_UPDATE_FEED server. */
export function releasesBase(env) {
  const override = feedOverride(env);
  if (!override) return RELEASES_URL;
  return `${override.protocol}://${override.host}/${GITHUB_FEED.owner}/${GITHUB_FEED.repo}/releases`;
}

export function releasePageUrl(version) {
  return `${RELEASES_URL}/tag/v${encodeURIComponent(String(version))}`;
}

function firstLine(error) {
  return String(error?.message ?? error).split('\n')[0];
}

/**
 * From an rc (channel `rc`) electron-updater only looks at rc tags and never offers a final release.
 * So: check the own channel first, and if nothing newer is there, check final releases only.
 * @returns {Promise<{ result: object | null, error: Error | null }>}
 */
export async function checkWithFinalFallback(autoUpdater, log) {
  const isPrerelease = /-/.test(String(autoUpdater.currentVersion));
  let result = null;
  let error = null;
  try {
    result = await autoUpdater.checkForUpdates();
  } catch (e) {
    error = e;
    log.error('[Updater] Check failed:', firstLine(e));
  }
  if (!isPrerelease || result?.isUpdateAvailable) return { result, error };
  // not `channel = null`: the setter also turns on allowDowngrade
  autoUpdater.allowPrerelease = false;
  try {
    return { result: await autoUpdater.checkForUpdates(), error: null };
  } catch (e) {
    log.error('[Updater] Final-release check failed:', firstLine(e));
    return { result: null, error: e };
  } finally {
    autoUpdater.allowPrerelease = true;
  }
}

/** The Settings toggle (settingsService `autoUpdate`), read from the local server's settings.json. */
export function readAutoUpdateSetting(dataDir) {
  try {
    return (
      JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8')).autoUpdate !== false
    );
  } catch {
    return true;
  }
}

/**
 * @typedef {{ state: 'idle'|'checking'|'none'|'available'|'downloading'|'ready'|'error',
 *   mode: string, currentVersion: string, channel: string, version?: string, percent?: number,
 *   error?: string, lastCheck: number | null, manual: boolean, releaseUrl?: string }} UpdateStatus
 *
 * @param deps.mode           from resolveUpdateMode
 * @param deps.autoUpdater    electron-updater's autoUpdater (install mode)
 * @param deps.fetch          fetch for the feed and downloads (Electron's net.fetch: system proxy)
 * @param deps.updatesDir     downloads, staging dir and the swap script/log
 * @param deps.bundlePath     running .app bundle (swap mode)
 * @param deps.isAutoEnabled  the Settings toggle; read on every automatic check and on quit
 * @param deps.onStatus       every status change
 * @param deps.quit           quits the app (after the swap helper has started)
 */
export function setupUpdater({
  mode,
  autoUpdater,
  currentVersion,
  arch = process.arch,
  env = process.env,
  log = console,
  fetch = globalThis.fetch,
  updatesDir,
  bundlePath,
  pid = process.pid,
  isAutoEnabled = () => true,
  onStatus = () => {},
  quit = () => {},
  spawn = nodeSpawn,
  run = runFile,
  bundleId = BUNDLE_ID, // the e2e fixture app has its own
  now = Date.now,
}) {
  log.log(`[Updater] mode=${mode}`);
  let status = {
    state: 'idle',
    mode,
    currentVersion,
    channel: channelOf(currentVersion),
    lastCheck: null,
    manual: false,
  };
  const set = (next) => {
    status = {
      mode,
      currentVersion,
      channel: status.channel,
      lastCheck: status.lastCheck,
      ...next,
    };
    onStatus(status);
    return status;
  };
  const base = releasesBase(env);
  let staged = null; // swap mode: .app ready to swap in
  let installing = false;
  let inflight = null;
  let lastProgress = 0;

  const progress = (version, manual) => (received, total) => {
    if (!total) return;
    const percent = Math.min(100, Math.floor((received / total) * 100));
    // one status per percent at most: every chunk would flood the IPC channel
    if (percent === lastProgress && percent !== 100) return;
    lastProgress = percent;
    set({ state: 'downloading', version, percent, manual });
  };

  if (mode === 'install') {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;
    const override = feedOverride(env);
    if (override) autoUpdater.setFeedURL(override);
    autoUpdater.on('error', (error) => log.error('[Updater] Error:', firstLine(error)));
    autoUpdater.on('download-progress', (p) => {
      const percent = Math.floor(p?.percent ?? 0);
      if (percent === lastProgress) return;
      lastProgress = percent;
      set({ ...status, state: 'downloading', percent });
    });
  } else if (mode === 'swap') {
    // a previous run's leftovers; the zip of a pending update is fetched again
    fs.rmSync(path.join(updatesDir, 'staging'), { recursive: true, force: true });
    for (const name of fs.existsSync(updatesDir) ? fs.readdirSync(updatesDir) : []) {
      if (/\.zip(\.part)?$/.test(name)) fs.rmSync(path.join(updatesDir, name), { force: true });
    }
  }

  async function checkInstall(manual) {
    const { result, error } = await checkWithFinalFallback(autoUpdater, log);
    if (!result?.isUpdateAvailable) {
      if (error) throw error;
      return set({ state: 'none', manual, lastCheck: now() });
    }
    const version = String(result.updateInfo?.version ?? '');
    log.log(`[Updater] update-available ${version}`);
    set({ state: 'downloading', version, percent: 0, manual, lastCheck: now() });
    lastProgress = 0;
    await autoUpdater.downloadUpdate();
    log.log(`[Updater] update-downloaded ${version}`);
    return set({ state: 'ready', version, manual });
  }

  async function checkOwn(manual) {
    const release = await findRelease({ releasesBase: base, currentVersion, fetch });
    const checked = now();
    if (!release) {
      log.log('[Updater] no newer release');
      return set({ state: 'none', manual, lastCheck: checked });
    }
    const { version } = release;
    log.log(`[Updater] update-available ${version}`);
    if (mode === 'notify') {
      return set({
        state: 'available',
        version,
        manual,
        lastCheck: checked,
        releaseUrl: releasePageUrl(version),
      });
    }
    staged = null;
    set({ state: 'downloading', version, percent: 0, manual, lastCheck: checked });
    lastProgress = 0;
    const zip = await findMacZip({ releasesBase: base, release, arch, fetch });
    const dest = path.join(updatesDir, `Orkumo-${version}-${arch}.zip`);
    await downloadVerified({
      url: zip.downloadUrl,
      dest,
      sha512: zip.sha512,
      size: zip.size,
      fetch,
      onProgress: progress(version, manual),
    });
    const app = await stageBundle({
      zip: dest,
      dir: path.join(updatesDir, 'staging'),
      version,
      bundleId,
      run,
    });
    fs.rmSync(dest, { force: true });
    staged = { version, app };
    log.log(`[Updater] update-ready ${version}`);
    return set({ state: 'ready', version, manual });
  }

  /** One check at a time; a found update is downloaded right away (install, swap). */
  function check({ manual = false } = {}) {
    if (mode === 'off') return Promise.resolve(status);
    if (installing) return Promise.resolve(status);
    if (inflight) return inflight;
    // a downloaded update stays put until it is installed
    if (status.state === 'ready') return Promise.resolve(status);
    set({ state: 'checking', manual });
    inflight = (mode === 'install' ? checkInstall(manual) : checkOwn(manual))
      .catch((error) => {
        log.error('[Updater] Update failed:', firstLine(error));
        return set({ state: 'error', error: firstLine(error), manual, lastCheck: now() });
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  function startSwap(relaunch) {
    installing = true;
    launchSwap({ updatesDir, spawn, pid, bundle: bundlePath, staged: staged.app, relaunch });
    log.log(`[Updater] swap to ${staged.version} started (relaunch=${relaunch})`);
  }

  /** "Restart to update". */
  function install() {
    if (status.state !== 'ready' || installing) {
      return { success: false, error: 'No downloaded update to install' };
    }
    if (mode === 'install') {
      installing = true;
      autoUpdater.quitAndInstall(false, true);
      return { success: true };
    }
    try {
      startSwap(true);
    } catch (error) {
      installing = false;
      set({ ...status, state: 'error', error: firstLine(error), manual: true });
      return { success: false, error: firstLine(error) };
    }
    quit();
    return { success: true };
  }

  /** Plain quit with a staged update and auto-update on: swap without relaunching (like Squirrel). */
  function installOnQuit() {
    if (mode !== 'swap' || installing || !staged || status.state !== 'ready') return;
    if (!isAutoEnabled()) return;
    try {
      startSwap(false);
    } catch (error) {
      log.error('[Updater] Install on quit failed:', firstLine(error));
    }
  }

  /** Automatic checks: after FIRST_CHECK_DELAY_MS, then every CHECK_INTERVAL_MS, while the toggle is on. */
  function start({
    delay = FIRST_CHECK_DELAY_MS,
    interval = CHECK_INTERVAL_MS,
    timers = globalThis,
  } = {}) {
    if (mode === 'off') return () => {};
    const tick = () => {
      if (isAutoEnabled()) check();
      else log.log('[Updater] automatic updates are off');
    };
    const first = timers.setTimeout(tick, delay);
    const every = timers.setInterval(tick, interval);
    first?.unref?.();
    every?.unref?.();
    return () => {
      timers.clearTimeout(first);
      timers.clearInterval(every);
    };
  }

  return {
    getStatus: () => status,
    check,
    install,
    installOnQuit,
    start,
  };
}

export function hasUpdateConfigFile(resourcesPath) {
  return fs.existsSync(path.join(resourcesPath, 'app-update.yml'));
}

/** Path of the running .app bundle (…/Orkumo.app/Contents/MacOS/Orkumo → …/Orkumo.app). */
export function appBundlePath(execPath) {
  return path.resolve(execPath, '..', '..', '..');
}
