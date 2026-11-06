// Minimal Electron app for the #126 update e2e: wires electron/updater.js exactly like electron/main.js,
// but answers dialogs automatically and writes every step to $ORKUMO_E2E_LOG.
import { app, dialog, shell } from 'electron';
import electronUpdater from 'electron-updater';
import fs from 'node:fs';
import {
  setupUpdater,
  resolveUpdateMode,
  hasUpdateConfigFile,
  isDeveloperIdSigned,
  appBundlePath,
} from '../../../electron/updater.js';

const logFile = process.env.ORKUMO_E2E_LOG;
const write = (line) => {
  if (logFile) fs.appendFileSync(logFile, `${line}\n`);
};
const log = {
  log: (...a) => write(a.join(' ')),
  error: (...a) => write(a.join(' ')),
};

app.whenReady().then(async () => {
  write(`version ${app.getVersion()}`);
  const fakeDialog = {
    showMessageBox: async (...args) => {
      const options = args.at(-1);
      write(`dialog ${options.type} "${options.title}" "${options.message}"`);
      return { response: 0 };
    },
  };
  const fakeShell = { openExternal: async (url) => write(`openExternal ${url}`) };
  const mode = resolveUpdateMode({
    isDev: !app.isPackaged,
    platform: process.platform,
    env: process.env,
    hasUpdateConfig: hasUpdateConfigFile(process.resourcesPath),
    macSigned: () => isDeveloperIdSigned(appBundlePath(process.execPath)),
  });
  const updater = electronUpdater.autoUpdater;
  updater.on('update-downloaded', () => write('downloaded'));
  const check = setupUpdater({
    autoUpdater: updater,
    dialog: fakeDialog,
    shell: fakeShell,
    getWindow: () => null,
    mode,
    log,
  });
  if (!check) return app.exit(0);
  const result = await check();
  write(`check-done available=${Boolean(result?.isUpdateAvailable)}`);
  // install mode with an update: download + quitAndInstall end the process; otherwise done
  // no timers: a windowless app gets App Nap on macOS and its timers may not fire for minutes
  if (mode !== 'install' || !result?.isUpdateAvailable) {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); // let the dialog handler finish
    write('exiting');
    app.exit(0);
  }
});
