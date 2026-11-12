/* MAGOS#497 against the packaged app: the PR pill opens the modal and the built-in browser (native view) loads the PR inside it.
   Usage: NODE_PATH=<dir with playwright> node scripts/review/497-app-e2e.cjs <Orkumo binary> <outDir> <home> <port> */
const { _electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const [bin, out, home, port] = process.argv.slice(2);
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const PR = 'https://github.com/octocat/Hello-World/pull/1';
(async () => {
  const cfg = path.join(home, '.claude');
  fs.mkdirSync(path.join(cfg, 'jobs', 'e2e497a'), { recursive: true });
  fs.writeFileSync(
    path.join(cfg, 'jobs', 'e2e497a', 'state.json'),
    JSON.stringify({ children: [{ kind: 'pr', href: PR, title: 'Erster PR', state: 'merged' }] })
  );
  const stub = path.join(home, 'claude');
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env bash\ncase "$1" in agents) echo '[{"kind":"background","id":"e2e497a","cwd":"/tmp","name":"imap-privatkonto","state":"idle","startedAt":1}]' ;; --version) echo "2.1.0 (Claude Code)" ;; *) exit 0 ;; esac\n`,
    { mode: 0o755 }
  );
  const env = {
    ...process.env,
    HOME: home,
    CFFIXED_USER_HOME: home,
    CLAUDE_CONFIG_DIR: cfg,
    CLAUDE_CLI_PATH: stub,
    SERVER_PORT: port,
    DEVHUB_PREMIUM_DIR: path.join(home, 'no-modules'),
    ORKUMO_DISABLE_UPDATES: '1',
    ORKUMO_QUICK_SHORTCUT: 'Alt+Shift+F9',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: bin, env });
  try {
    const main = await app.firstWindow();
    await main.getByRole('group', { name: 'Mode' }).waitFor({ timeout: 60000 });
    const pill = main.getByRole('button', { name: 'Pull request #1' }).first();
    await pill.waitFor({ timeout: 30000 });
    await pill.click();
    const dialog = main.getByRole('dialog', { name: 'Pull request #1' });
    await dialog.waitFor();
    check('pill opens the single-PR modal', await dialog.getByText('Erster PR').isVisible());
    check(
      'no overview',
      (await main.getByRole('dialog', { name: 'Open pull requests' }).count()) === 0
    );
    let views = [];
    for (let i = 0; i < 40; i++) {
      views = await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((x) => x.getBounds().height > 200);
        const kids = w.contentView?.children || [];
        return kids
          .filter((k) => k.webContents && k.webContents !== w.webContents)
          .map((k) => ({ url: k.webContents.getURL(), b: k.getBounds() }));
      });
      if (views.some((v) => v.url.includes('/pull/1'))) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const v = views.find((x) => x.url.includes('/pull/1'));
    check('built-in browser loads the PR page', !!v, JSON.stringify(views));
    const box = await dialog.boundingBox();
    check(
      'browser view lies inside the modal',
      !!v &&
        v.b.x >= box.x &&
        v.b.y >= box.y &&
        v.b.x + v.b.width <= box.x + box.width + 1 &&
        v.b.y + v.b.height <= box.y + box.height + 1 &&
        v.b.height > 300,
      JSON.stringify({ v: v && v.b, box })
    );
    await new Promise((r) => setTimeout(r, 2500));
    const img = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.getBounds().height > 200);
      return (await w.capturePage()).toPNG().toString('base64');
    });
    fs.writeFileSync(path.join(out, 'app-1-modal.png'), Buffer.from(img, 'base64'));
    await main.screenshot({ path: path.join(out, 'app-1-dom.png') });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await new Promise((r) => setTimeout(r, 1000));
    const after = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.getBounds().height > 200);
      return (w.contentView?.children || []).filter(
        (k) =>
          k.webContents &&
          k.webContents !== w.webContents &&
          k.webContents.getURL().includes('/pull/1') &&
          k.getBounds().width > 0 &&
          k.getVisible?.() !== false
      ).length;
    });
    check('closing the modal removes the browser view', after === 0, String(after));
  } finally {
    await app.close().catch(() => {});
  }
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
