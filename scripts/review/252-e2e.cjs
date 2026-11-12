// #252 e2e: the main agent dialog opens from the title bar and the palette in views other than
// Agents, shows the session named main-orchestrator, and the keep-alive switch is stored.
// Usage: NODE_PATH=<dir with playwright> node scripts/review/252-e2e.cjs <baseUrl> <apiUrl> <outDir>
const { chromium } = require('playwright');
const [base, api, out] = process.argv.slice(2);
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const keepAlive = async () =>
  (await (await fetch(`${api}/api/settings/agent-view`)).json()).mainAgent;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 860 } });
  for (const route of ['/dashboard', '/usage', '/agents']) {
    await p.goto(`${base}${route}`, { waitUntil: 'load' });
    await p.getByRole('button', { name: 'Open main agent' }).click();
    const dialog = p.getByRole('dialog', { name: 'Main agent' });
    await dialog.waitFor({ timeout: 20000 });
    await dialog.getByText('orchestrator-e2e').first().waitFor({ timeout: 20000 });
    check(`${route}: title bar button opens the dialog with the main-orchestrator session`, true);
    if (route === '/dashboard') await p.screenshot({ path: `${out}/252-1-dialog.png` });
    await p.keyboard.press('Escape');
    await p.mouse.click(5, 400);
    await dialog.waitFor({ state: 'detached', timeout: 5000 });
  }
  await p.goto(`${base}/dashboard`, { waitUntil: 'load' });
  await p.waitForTimeout(1500); // the page's own key handlers must be up before the shortcut
  await p.getByRole('button', { name: /Command palette/ }).click();
  await p.waitForTimeout(400);
  await p.keyboard.type('Main agent');
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/252-2-palette.png` });
  await p.keyboard.press('Enter');

  const dialog = p.getByRole('dialog', { name: 'Main agent' });
  await dialog.waitFor({ timeout: 10000 });
  check('command palette "Main agent" opens it too', true);
  check(
    'keep-alive is on by default',
    (await keepAlive()).keepAlive === true,
    JSON.stringify(await keepAlive())
  );
  await dialog.getByLabel('Keep alive').uncheck();
  await p.waitForTimeout(800);
  check(
    'keep-alive switch is stored on the server',
    (await keepAlive()).keepAlive === false,
    JSON.stringify(await keepAlive())
  );
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
