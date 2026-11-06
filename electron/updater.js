/**
 * Auto-update (#126). Two modes:
 * - install: electron-updater downloads and installs (Linux AppImage, macOS with Developer ID signature)
 * - notify: only reports a new version and opens its release page (ad-hoc/unsigned mac, .deb/.rpm, `--dir` builds)
 * Background check errors are only logged, never shown (#125: an error sheet pushed the window onto another display).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import path from 'path';

export const GITHUB_FEED = { provider: 'github', owner: 'hpmartini', repo: 'Orkumo' };
export const RELEASES_URL = `https://github.com/${GITHUB_FEED.owner}/${GITHUB_FEED.repo}/releases`;

/** Squirrel.Mac only accepts an update whose signature matches the running app: needs a Developer ID. */
export function isDeveloperIdSigned(appBundlePath, spawn = spawnSync) {
  // codesign -dv prints the details to stderr, even on success
  const { stderr } = spawn('codesign', ['-dv', '--verbose=2', appBundlePath], {
    encoding: 'utf8',
    timeout: 5000,
  });
  return /^Authority=Developer ID Application/m.test(String(stderr ?? ''));
}

/** @returns {'off' | 'notify' | 'install'} */
export function resolveUpdateMode({ isDev, platform, env, hasUpdateConfig, macSigned }) {
  if (isDev) return 'off';
  if (env.ORKUMO_DISABLE_UPDATES === '1') return 'off';
  if (!hasUpdateConfig) return 'notify';
  if (platform === 'linux') return env.APPIMAGE ? 'install' : 'notify';
  if (platform === 'darwin') return macSigned() ? 'install' : 'notify';
  return 'notify';
}

/**
 * ORKUMO_UPDATE_FEED=http://host:port: a fake GitHub for the e2e test (scripts/review/126*), so the real
 * GitHubProvider tag/channel logic runs. http(s) on loopback only.
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

export function releasePageUrl(version) {
  return `${RELEASES_URL}/tag/v${encodeURIComponent(String(version))}`;
}

function firstLine(error) {
  return String(error?.message ?? error).split('\n')[0];
}

/**
 * From an rc (channel `rc`) electron-updater only looks at rc tags and never offers a final release.
 * So: check the own channel first, and if nothing newer is there, check final releases only.
 */
export async function checkWithFinalFallback(autoUpdater, log) {
  const isPrerelease = /-/.test(String(autoUpdater.currentVersion));
  let result = null;
  try {
    result = await autoUpdater.checkForUpdates();
  } catch (error) {
    log.error('[Updater] Check failed:', firstLine(error));
  }
  if (!isPrerelease || result?.isUpdateAvailable) return result;
  // not `channel = null`: the setter also turns on allowDowngrade
  autoUpdater.allowPrerelease = false;
  try {
    return await autoUpdater.checkForUpdates();
  } catch (error) {
    log.error('[Updater] Final-release check failed:', firstLine(error));
    return null;
  } finally {
    autoUpdater.allowPrerelease = true;
  }
}

/**
 * @param deps { autoUpdater, dialog, shell, getWindow, mode, env, log }
 */
export function setupUpdater({
  autoUpdater,
  dialog,
  shell,
  getWindow,
  mode,
  env = process.env,
  log = console,
}) {
  log.log(`[Updater] mode=${mode}`);
  if (mode === 'off') return null;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = mode === 'install';
  autoUpdater.logger = null;
  const override = feedOverride(env);
  if (override) autoUpdater.setFeedURL(override);
  else if (mode === 'notify') autoUpdater.setFeedURL(GITHUB_FEED); // `--dir` builds have no app-update.yml

  let downloading = false;
  const ask = (options) => {
    const win = getWindow();
    return win && !win.isDestroyed()
      ? dialog.showMessageBox(win, options)
      : dialog.showMessageBox(options);
  };

  autoUpdater.on('error', (error) => {
    log.error('[Updater] Error:', firstLine(error));
    if (!downloading) return; // background check: log only
    downloading = false;
    ask({
      type: 'error',
      title: 'Update fehlgeschlagen',
      message: firstLine(error),
      buttons: ['OK'],
    });
  });

  autoUpdater.on('update-available', async (info) => {
    log.log(`[Updater] update-available ${info.version}`);
    if (mode === 'notify') {
      const { response } = await ask({
        type: 'info',
        title: 'Update verfügbar',
        message: `Orkumo ${info.version} ist verfügbar.`,
        detail: 'Diese Installation kann sich nicht selbst aktualisieren. Release-Seite öffnen?',
        buttons: ['Release-Seite öffnen', 'Später'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) shell.openExternal(releasePageUrl(info.version));
      return;
    }
    const { response } = await ask({
      type: 'info',
      title: 'Update verfügbar',
      message: `Orkumo ${info.version} ist verfügbar.`,
      detail: 'Jetzt herunterladen? Installiert wird beim nächsten Neustart.',
      buttons: ['Herunterladen', 'Später'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return;
    downloading = true;
    autoUpdater.downloadUpdate().catch(() => {}); // failure arrives as 'error' event
  });

  autoUpdater.on('update-not-available', (info) =>
    log.log(`[Updater] update-not-available ${info?.version}`)
  );

  autoUpdater.on('update-downloaded', async (info) => {
    downloading = false;
    log.log(`[Updater] update-downloaded ${info.version}`);
    const { response } = await ask({
      type: 'info',
      title: 'Update bereit',
      message: `Orkumo ${info.version} ist heruntergeladen.`,
      detail: 'Jetzt neu starten und installieren?',
      buttons: ['Neu starten', 'Später'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall(false, true);
  });

  return () => checkWithFinalFallback(autoUpdater, log);
}

export function hasUpdateConfigFile(resourcesPath) {
  return fs.existsSync(path.join(resourcesPath, 'app-update.yml'));
}

/** Path of the running .app bundle (…/Orkumo.app/Contents/MacOS/Orkumo → …/Orkumo.app). */
export function appBundlePath(execPath) {
  return path.resolve(execPath, '..', '..', '..');
}
