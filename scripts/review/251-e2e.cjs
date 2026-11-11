/* global location */
// #251 quick window e2e against the packaged app: the shortcut is registered, the quick window
// opens on the /quick route, Enter hands the prompt to the main window's chat composer.
// Usage: NODE_PATH=<dir with playwright> node scripts/review/251-e2e.cjs <Orkumo binary> <outDir> <home> <port>
const { _electron } = require('playwright');
const path = require('path');
const [bin, out, home, port] = process.argv.slice(2);
const SHORTCUT = 'Alt+Shift+F9'; // not the default: the test must not take a shortcut in use
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

(async () => {
  const env = {
    ...process.env,
    HOME: home,
    CFFIXED_USER_HOME: home, // own userData: the installed app's single-instance lock stays untouched
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    CLAUDE_CLI_PATH: path.resolve(__dirname, '../../test/fixtures/fake-gh/claude'),
    SERVER_PORT: port,
    DEVHUB_PREMIUM_DIR: path.join(home, 'no-modules'),
    ORKUMO_DISABLE_UPDATES: '1',
    ORKUMO_QUICK_SHORTCUT: SHORTCUT,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: bin, env });
  try {
    const main = await app.firstWindow();
    await main.getByRole('group', { name: 'Mode' }).waitFor({ timeout: 60000 });
    check(
      'global shortcut registered',
      await app.evaluate(({ globalShortcut }, s) => globalShortcut.isRegistered(s), SHORTCUT)
    );
    const opened = app.waitForEvent('window');
    await app.evaluate(({ app }) => app.emit('orkumo-quick-toggle'));
    const quick = await opened;
    await quick.getByLabel('Quick prompt').waitFor({ timeout: 20000 });
    check(
      'quick window shows the /quick route',
      (await quick.evaluate(() => location.hash)) === '#/quick'
    );
    const size = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .map((w) => ({ ...w.getBounds(), top: w.isAlwaysOnTop(), visible: w.isVisible() }))
        .find((w) => w.height < 100)
    );
    check(
      'small, always on top, visible',
      size && size.top && size.visible && size.width === 680,
      JSON.stringify(size)
    );
    await quick.screenshot({ path: path.join(out, '251-1-quick-window.png') });
    await quick.getByLabel('Quick prompt').fill('Was steht heute an?');
    await quick.keyboard.press('Enter');
    await main.getByText('Was steht heute an?').first().waitFor({ timeout: 10000 });
    check('Enter: the main window opens the composer with the prompt', true);
    const hidden = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getBounds().height < 100)
        ?.isVisible()
    );
    check('quick window hidden after sending', hidden === false);
    await main.screenshot({ path: path.join(out, '251-2-composer.png') });

    // Main window closed (the app keeps running on macOS): the prompt must not get lost
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getBounds().height > 100)
        .close()
    );
    await new Promise((r) => setTimeout(r, 1000));
    const quickAgain = app.waitForEvent('window');
    await app.evaluate(({ app }) => app.emit('orkumo-quick-toggle'));
    const quick2 = await quickAgain;
    await quick2.getByLabel('Quick prompt').waitFor({ timeout: 20000 });
    const reopened = app.waitForEvent('window');
    await quick2.getByLabel('Quick prompt').fill('Zweite Frage ohne Hauptfenster');
    await quick2.keyboard.press('Enter');
    const main2 = await reopened;
    await main2.getByText('Zweite Frage ohne Hauptfenster').first().waitFor({ timeout: 30000 });
    check('main window closed: Enter reopens it with the prompt in the composer', true);
  } finally {
    await Promise.race([app.close(), new Promise((r) => setTimeout(r, 10000))]);
    try {
      app.process().kill('SIGKILL');
    } catch {
      // already gone
    }
  }
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
