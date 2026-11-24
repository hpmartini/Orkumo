/* global document, getComputedStyle, localStorage */
// #346 e2e: threads panel resize with a real mouse (Chromium pointer events, no synthetic events)
// in a tab and in a split. Needs a running Orkumo with two orchestrators whose chat UI view shows
// threads; opens the first two orchestrator cards. Fails on a handle that cannot be hit, has no
// col-resize cursor, or a drag that does not move the panel to the clamped target.
// Usage: NODE_PATH=<dir with playwright> node scripts/review/346-e2e.cjs <baseUrl> <outDir> [width]
// (CHROME=<path> to use a given Chromium)
const pw = (() => {
  try {
    return require('playwright');
  } catch {
    return require('playwright-core');
  }
})();
const { chromium } = pw;
const fs = require('fs');
const [BASE, OUT, width] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const exe = process.env.CHROME || undefined;
const W = Number(width || 1440);
const tag = `w${W}`;
let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

const measureAll = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role=separator][aria-label="Resize threads panel"]')]
      .map((s) => {
        const a = s.nextElementSibling;
        const r = s.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const top = document.elementFromPoint(x, y);
        return {
          x,
          y,
          w: r.width,
          h: r.height,
          cursor: getComputedStyle(s).cursor,
          topIsHandle: !!top && s.contains(top),
          aside: a ? Math.round(a.getBoundingClientRect().width) : null,
          now: Number(s.getAttribute('aria-valuenow')),
          min: Number(s.getAttribute('aria-valuemin')),
          max: Number(s.getAttribute('aria-valuemax')),
          visible: r.width > 0 && r.height > 0,
        };
      })
      .filter((m) => m.visible)
  );

async function drag(page, i, dx, name) {
  const all = await measureAll(page);
  const m0 = all[i];
  if (!m0) return check(`${name}: handle present`, false, `${all.length} visible`);
  check(
    `${name}: handle grabbable`,
    m0.w >= 7 && m0.cursor === 'col-resize' && m0.topIsHandle,
    JSON.stringify(m0)
  );
  // the handle counts from the width on screen (a 60 % cap hid the stored width before)
  check(
    `${name}: handle value = width on screen`,
    Math.abs(m0.now - m0.aside) <= 1,
    `${m0.now} vs ${m0.aside}`
  );
  await page.mouse.move(m0.x, m0.y, { steps: 5 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${tag}-${name}-hover.png` });
  await page.mouse.down();
  for (let k = 1; k <= 15; k++) {
    await page.mouse.move(m0.x + (dx * k) / 15, m0.y);
    await page.waitForTimeout(40);
  }
  await page.screenshot({ path: `${OUT}/${tag}-${name}-dragging.png` });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const m1 = (await measureAll(page))[i];
  // left edge: dragging left (dx < 0) widens; expected = clamped target
  const want = Math.max(m0.min, Math.min(m0.aside - dx, m0.max));
  check(
    `${name}: drag ${dx}px -> ${want}`,
    m1 && Math.abs(m1.aside - want) <= 3 && (want !== m0.aside || m0.min === m0.max),
    `${m0.aside} -> ${m1 && m1.aside} (range ${m0.min}-${m0.max})`
  );
  await page.screenshot({ path: `${OUT}/${tag}-${name}-after.png` });
  await page.mouse.move(m0.x - 300, m0.y + 200, { steps: 5 });
}

async function openAgent(page, n) {
  const cards = page.locator('[role="option"][data-session-id]');
  // a collapsed Orchestrators group hides the cards; its header is an option without a session
  if ((await cards.count()) < 2) {
    await page.locator('[role="option"]', { hasText: 'Orchestrators' }).first().click();
    await page.waitForTimeout(800);
  }
  await cards.nth(n).dblclick(); // opens the agent in a tab of its own
  await page.waitForTimeout(3500);
}

(async () => {
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: W, height: 900 },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${BASE}/agents`);
  await page.waitForTimeout(5000);
  await page.evaluate(() => localStorage.removeItem('agents-ui:threads-width'));
  await openAgent(page, 1);
  await openAgent(page, 0);
  await page.screenshot({ path: `${OUT}/${tag}-tabs.png` });

  // tab: drag left widens, then right narrows
  await drag(page, 0, -160, 'tab-wider');
  await drag(page, 0, 100, 'tab-narrower');

  // split: hover the active tab and split it right
  const tabBtn = page.locator('button[aria-label^="Split "][aria-label$=" right"]').first();
  await page.waitForTimeout(300);
  if (await tabBtn.count()) {
    // like a user: hover the active tab, its split buttons appear
    await tabBtn
      .locator('xpath=ancestor::*[contains(concat(" ", @class, " "), " group ")][1]')
      .hover();
    await page.waitForTimeout(300);
    await tabBtn.click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${OUT}/${tag}-split.png` });
    const n = (await measureAll(page)).length;
    console.log('handles in split', n);
    for (let i = 0; i < n; i++) {
      await drag(page, i, 60, `split-${i}-narrower`);
      await drag(page, i, -120, `split-${i}-wider`);
    }
  } else check('split button', false);

  console.log('console errors', JSON.stringify(errors));
  await ctx.close();
  await browser.close();
  console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
