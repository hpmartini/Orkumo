// #243 e2e: real app, real lsof/ps. The orphan (a listener in <tmp>/repo/.claude/worktrees/old, no
// session there) shows under "Verwaist" in the servers panel; Stop + confirm kills it.
// Usage: NODE_PATH=<dir with playwright> node scripts/review/243-e2e.cjs <baseUrl> <outDir> <orphanPid> <orphanPort>
const { chromium } = require('playwright');
const [base, out, pidArg, portArg] = process.argv.slice(2);
const pid = Number(pidArg);
const port = Number(portArg);
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const alive = () => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const stopButton = (p) => p.locator(`[aria-label="Stop orphaned server on port ${port}"]`);

const openPanel = async (p) => {
  await p.goto(`${base}/agents`, { waitUntil: 'load' });
  const button = p.getByRole('button', { name: /servers? running/ });
  await button.waitFor({ timeout: 60000 });
  await button.click();
  const section = p.getByRole('region', { name: 'Orphaned servers' });
  await section.waitFor({ timeout: 60000 });
  await stopButton(p).waitFor({ timeout: 30000 });
  await p.waitForTimeout(1500); // load column
  return section;
};

(async () => {
  const b = await chromium.launch();
  const mobile = await b.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await mobile.newPage();
  await (await openPanel(mp)).scrollIntoViewIfNeeded();
  await mp.waitForTimeout(300);
  await mp.screenshot({ path: `${out}/orphans-mobile.png` });
  await mobile.close();

  const ctx = await b.newContext({
    viewport: { width: 1400, height: 860 },
    recordVideo: { dir: out, size: { width: 1400, height: 860 } },
  });
  const p = await ctx.newPage();
  const section = await openPanel(p);
  check('orphan listed under Verwaist', await stopButton(p).isVisible());
  await p.screenshot({ path: `${out}/orphans-desktop.png` });
  await stopButton(p).click();
  const confirm = section.getByRole('button', { name: `Stop pid ${pid}` });
  await confirm.waitFor();
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/orphans-confirm.png` });
  await confirm.click();
  await confirm.waitFor({ state: 'detached', timeout: 15000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/orphans-after-stop.png` });
  check('row gone after stop', (await stopButton(p).count()) === 0);
  check('process gone after stop', !alive(), `pid ${pid}`);
  await ctx.close();
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
