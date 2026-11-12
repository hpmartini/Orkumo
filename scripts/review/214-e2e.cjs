/* global location */
// #214 e2e: the packaged app (renderer on file://) with and without a premium module.
// Usage: NODE_PATH=<dir with playwright> node scripts/review/214-e2e.cjs <Orkumo binary> <outDir> <moduleDir> <home> <port> with|without
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');
const [bin, out, moduleDir, home, port, variant] = process.argv.slice(2);
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

(async () => {
  // HOME + claude stub: no real sessions or board in the screenshots (public repo), nothing read from ~/.claude
  const env = {
    ...process.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    CLAUDE_CLI_PATH: path.resolve(__dirname, '../../test/fixtures/fake-gh/claude'),
    CFFIXED_USER_HOME: home,
    SERVER_PORT: port,
    DEVHUB_PREMIUM_DIR: moduleDir,
    ORKUMO_DISABLE_UPDATES: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE; // set in agent shells: the app would exit silently
  const app = await _electron.launch({ executablePath: bin, env });
  try {
    // userData is pinned in main.js; CFFIXED_USER_HOME moves appData, so the installed app's lock and data stay untouched
    const userData = await app.evaluate(({ app }) => app.getPath('userData'));
    if (!userData.startsWith(fs.realpathSync(home)) && !userData.startsWith(home))
      throw new Error(`userData not isolated: ${userData}`);
    const page = await app.firstWindow();
    const errors = [];
    const uiJs = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('response', async (r) => {
      if (r.status() >= 400)
        console.log(
          `HTTP ${r.status()} ${r.url()}: ${(await r.text().catch(() => '')).slice(0, 300)}`
        );
      if (!/\/api\/modules\/[^/]+\/ui\.js/.test(r.url())) return;
      const req = await r.request().allHeaders();
      uiJs.push({
        url: r.url(),
        status: r.status(),
        origin: req.origin,
        acao: r.headers()['access-control-allow-origin'],
      });
    });
    await page.reload({ waitUntil: 'load' }); // listeners attached from the first request on
    await page.getByRole('group', { name: 'Mode' }).waitFor({ timeout: 60_000 });
    console.log(`location.protocol = ${await page.evaluate(() => location.protocol)}`);
    check('renderer runs on file://', (await page.evaluate(() => location.protocol)) === 'file:');
    const modeEntry = page.getByRole('group', { name: 'Mode' }).getByLabel('Workflows');

    if (variant === 'with') {
      check('Workflows entry in the mode bar', (await modeEntry.count()) === 1);
      const t0 = Date.now();
      await page.evaluate(() => (location.hash = '#/workflows'));
      await page.locator('[data-module="workflows"] > *').first().waitFor({ timeout: 30_000 });
      console.log(`mode switch to module UI visible: ${Date.now() - t0} ms`);
      await page.waitForTimeout(3000);
      console.log(`end URL hash = ${await page.evaluate(() => location.hash)}`);
      check(
        '/workflows stays',
        (await page.evaluate(() => location.hash)).startsWith('#/workflows')
      );
      console.log(`ui.js: ${JSON.stringify(uiJs)}`);
      check(
        'ui.js 200 with CORS header for the file:// renderer',
        uiJs.length > 0 &&
          uiJs.every((r) => r.status === 200 && r.acao && r.acao === (r.origin ?? 'null'))
      );
      await page.screenshot({ path: path.join(out, 'electron-workflows-mit-modul.png') });
      await page.keyboard.press('Meta+P');
      await page.keyboard.type('workflows');
      await page.waitForTimeout(800);
      check(
        'Workflows entry in the command palette',
        (await page.getByText(/open workflows/i).count()) > 0
      );
      await page.keyboard.press('Escape');
    } else {
      check('no Workflows entry in the mode bar', (await modeEntry.count()) === 0);
      await page.keyboard.press('Meta+P');
      await page.keyboard.type('workflows');
      await page.waitForTimeout(800);
      check(
        'no Workflows entry in the command palette',
        (await page.getByText(/open workflows/i).count()) === 0
      );
      await page.screenshot({ path: path.join(out, 'electron-ohne-modul-palette.png') });
      await page.keyboard.press('Escape');
      await page.evaluate(() => (location.hash = '#/workflows'));
      await page.waitForTimeout(2000);
      const hash = await page.evaluate(() => location.hash);
      console.log(`end URL after /workflows = ${hash}`);
      check('/workflows redirects to /dashboard', hash.startsWith('#/dashboard'));
      await page.screenshot({ path: path.join(out, 'electron-ohne-modul-dashboard.png') });
    }
    console.log(`console errors: ${errors.length}`);
    errors.forEach((e) => console.log(`  ${e}`));
    check('console without errors', errors.length === 0);
  } finally {
    // the server child can outlive a graceful quit for a long time: don't wait for it
    await Promise.race([app.close(), new Promise((r) => setTimeout(r, 10_000))]);
    app.process().kill('SIGKILL');
  }
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
