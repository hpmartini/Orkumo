// Minimal Electron app for the #126 update e2e: wires electron/updater.js like electron/main.js and writes
// every step to $ORKUMO_E2E_LOG. A fixture relaunched by the macOS swap (`open`, without this shell's env)
// reads the same variables from e2e-env.json next to its bundle.
// ORKUMO_E2E_SWAP=1 allows the macOS bundle swap; without it an ad-hoc fixture stays in notify mode.
import { app, net } from 'electron';
import electronUpdater from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';
import {
  setupUpdater,
  resolveUpdateMode,
  hasUpdateConfigFile,
  isDeveloperIdSigned,
  appBundlePath,
  canSwapBundle,
} from '../../../electron/updater.js';

const bundle = appBundlePath(process.execPath);
const envFile = path.join(path.dirname(bundle), 'e2e-env.json');
const env =
  !process.env.ORKUMO_E2E_LOG && fs.existsSync(envFile)
    ? { ...process.env, ...JSON.parse(fs.readFileSync(envFile, 'utf8')) }
    : process.env;
if (env.ORKUMO_E2E_DATA) app.setPath('userData', env.ORKUMO_E2E_DATA);

const write = (line) => {
  if (env.ORKUMO_E2E_LOG) fs.appendFileSync(env.ORKUMO_E2E_LOG, `${line}\n`);
};
const log = {
  log: (...a) => write(a.join(' ')),
  error: (...a) => write(a.join(' ')),
};

app.whenReady().then(async () => {
  write(`version ${app.getVersion()}`);
  const mode = resolveUpdateMode({
    isDev: !app.isPackaged,
    platform: process.platform,
    env,
    hasUpdateConfig: hasUpdateConfigFile(process.resourcesPath),
    macSigned: () => isDeveloperIdSigned(bundle),
    canSwap: () => env.ORKUMO_E2E_SWAP === '1' && canSwapBundle(bundle),
  });
  const updater = setupUpdater({
    mode,
    autoUpdater: electronUpdater.autoUpdater,
    currentVersion: app.getVersion(),
    env,
    log,
    fetch: (url, init) => net.fetch(url, init),
    updatesDir: path.join(app.getPath('userData'), 'updates'),
    bundlePath: bundle,
    bundleId: 'com.devorbit.update-fixture',
    onStatus: (s) =>
      write(
        ['status', s.state, s.version, s.releaseUrl, s.error && `error=${s.error}`]
          .filter(Boolean)
          .join(' ')
      ),
    quit: () => app.quit(),
  });
  const status = await updater.check();
  write(`check-done state=${status.state}`);
  // install/swap with a downloaded update: Restart ends the process (Squirrel/AppImage or the swap helper)
  if (status.state === 'ready') {
    write('installing');
    const result = updater.install();
    if (!result.success) {
      write(`install-failed ${result.error}`);
      app.exit(1);
    }
    return;
  }
  write('exiting');
  app.exit(0);
});
