// #242 e2e: real app, real settings file. The seeded pre-#181 `hover` must come back as `click`
// with the marker on disk; the row menu offers "Keep details open" only in hover mode.
// Usage: NODE_PATH=<dir with playwright> node scripts/review/242-e2e.cjs <baseUrl> <outDir> <settings.json>
const { chromium } = require('playwright');
const fs = require('fs');
const [base, out, settingsFile] = process.argv.slice(2);
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 860 } });
  await p.goto(`${base}/agents`, { waitUntil: 'load' });
  const api = await (await p.request.get(`${base}/api/settings/agent-view`)).json();
  check('AC-1 API: migrated to click', api.cardDetails === 'click', api.cardDetails);
  const onDisk = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).agentView;
  check(
    'AC-1 file: click + marker',
    onDisk.cardDetails === 'click' && onDisk.cardDetailsMigrated === true,
    JSON.stringify(onDisk)
  );

  /** Right-click the agent row, screenshot the open menu, return its labels */
  const menu = async (shot, viewport) => {
    if (viewport) await p.setViewportSize(viewport);
    await p.reload({ waitUntil: 'load' });
    const row = p.getByText('e2e-worker', { exact: true }).first();
    await row.waitFor({ timeout: 90000 });
    await row.click({ button: 'right' });
    await p.getByRole('menuitem').first().waitFor();
    const labels = (await p.getByRole('menuitem').allTextContents()).map((s) => s.trim());
    await p.screenshot({ path: `${out}/${shot}.png` });
    await p.keyboard.press('Escape');
    return labels;
  };
  let labels = await menu('click-desktop');
  check('AC-5 click: no "Keep details open"', !labels.includes('Keep details open'), labels.join(' | '));
  labels = await menu('click-mobile', { width: 390, height: 844 });
  check('AC-5 click (mobile): no "Keep details open"', !labels.includes('Keep details open'));
  await p.request.put(`${base}/api/settings/agent-view`, { data: { cardDetails: 'hover' } });
  labels = await menu('hover-desktop', { width: 1400, height: 860 });
  check('AC-5 hover: "Keep details open" offered', labels.includes('Keep details open'), labels.join(' | '));
  await b.close();
  if (fails) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
