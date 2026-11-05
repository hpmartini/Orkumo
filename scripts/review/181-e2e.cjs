/* global document -- runs inside the page via waitForFunction */
// #181 e2e against the running app and the real agent list (writes settings: use a throwaway data dir).
// Usage: NODE_PATH=<dir with playwright> node scripts/review/181-e2e.cjs <baseUrl> <screenshotDir>
const { chromium } = require('playwright');
const [base, out] = process.argv.slice(2);
let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`
  );
};
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await p.goto(`${base}/agents`, { waitUntil: 'load' });
  const cards = p.locator('[data-session-id][role=option]:visible');
  await cards.first().waitFor({ timeout: 90000 });
  const open = async () =>
    cards.evaluateAll((els) =>
      els.filter((e) => e.querySelector('[data-card-details]')).map((e) => e.dataset.sessionId)
    );
  const card = (id) => p.locator(`[data-session-id="${id}"][role=option]`);
  // Find cards that have details: 'always' shows them once the agent contexts have loaded
  await p.request.put(`${base}/api/settings/agent-view`, { data: { cardDetails: 'always' } });
  await p.reload({ waitUntil: 'load' });
  await cards.first().waitFor({ timeout: 90000 });
  await p.waitForFunction(
    () => document.querySelectorAll('[data-card-details]').length >= 3,
    null,
    { timeout: 90000 }
  );
  await p.waitForTimeout(3000);
  const withDetails = (await open()).slice(1, 4);
  await p.request.put(`${base}/api/settings/agent-view`, { data: { cardDetails: 'click' } });
  await p.reload({ waitUntil: 'load' });
  await cards.first().waitFor({ timeout: 90000 });
  await p.waitForTimeout(8000);
  const [A, B, C] = withDetails;
  console.log('cards with details', withDetails.length, A, B, C);
  // Click mode
  await card(B).click({ position: { x: 120, y: 12 } });
  await p.waitForTimeout(150);
  check('click mode: clicked card open', await open(), [B]);
  await card(A).hover({ position: { x: 120, y: 12 } });
  await p.waitForTimeout(400);
  check('click mode: hovering another card opens nothing more', await open(), [B]);
  await p.screenshot({
    path: `${out}/click-mode.png`,
    clip: { x: 0, y: 80, width: 440, height: 820 },
  });
  // Switch to hover mode through the settings panel
  await p
    .getByRole('button', { name: /settings/i })
    .first()
    .click();
  const select = p.locator('#agent-card-details');
  await select.waitFor();
  console.log('options:', JSON.stringify(await select.locator('option').allTextContents()));
  await select.scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${out}/settings.png` });
  await select.selectOption('hover');
  await p.waitForTimeout(500);
  await p.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await p.getByRole('dialog').waitFor({ state: 'hidden' });
  // Hover mode: click B, then point at A (above) and C (below)
  await card(B).click({ position: { x: 120, y: 12 } });
  await p.waitForTimeout(400);
  check('hover mode: clicked + hovered card open', await open(), [B]);
  await card(A).hover({ position: { x: 120, y: 12 } });
  await p.waitForTimeout(400);
  check('hover mode: card above opens, clicked card closes', await open(), [A]);
  await p.screenshot({
    path: `${out}/hover-mode-above.png`,
    clip: { x: 0, y: 80, width: 440, height: 820 },
  });
  await card(C).hover({ position: { x: 120, y: 12 } });
  await p.waitForTimeout(400);
  check('hover mode: card below opens alone', await open(), [C]);
  await p.screenshot({
    path: `${out}/hover-mode-below.png`,
    clip: { x: 0, y: 80, width: 440, height: 820 },
  });
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
