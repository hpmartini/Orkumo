// Prompt field (Bug 2) against composer-harness: hidden mount, browser split with long text,
// drag handle remembered across reload, double-click back to auto-grow.
// Usage: NODE_PATH=<dir with playwright> node scripts/review/composer-e2e.cjs <harnessUrl> <outDir> <label>
/* global window, localStorage, getComputedStyle */
const { chromium } = require('playwright');
const [url, out, label = 'run'] = process.argv.slice(2);
const LONG =
  'Bitte prüfe den Login-Flow im eingebauten Browser, reproduziere den Fehler mit gsi/transform, belege die Ursache mit einem Skript und behebe sie an der Wurzel, danach Screenshots vorher und nachher.';
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
// The field plus some room above it, on a page-wide strip so the right panel shows too
const shot = async (p, path) => {
  const box = await p.locator('textarea').boundingBox();
  const y = Math.max(0, box.y - 80);
  await p.screenshot({
    path,
    clip: { x: 0, y, width: 1200, height: Math.min(700 - y, box.height + 120) },
  });
};
const measure = (p) =>
  p.$eval('textarea', (el) => ({
    height: el.offsetHeight,
    clipped: el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === 'hidden',
  }));

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 700 }, deviceScaleFactor: 2 });

  // 1. Mounted while hidden (inactive tab / session switch), then shown
  await p.goto(`${url}?hidden=1`);
  await p.waitForFunction(() => window.harness);
  await p.evaluate(() => window.harness.setVisible(true));
  await p.waitForTimeout(300);
  let m = await measure(p);
  await shot(p, `${out}/${label}-1-hidden-mount.png`);
  check('hidden mount: one full line visible', m.height >= 42 && !m.clipped, JSON.stringify(m));

  // 2. Long text, then the browser opens on the right
  await p.evaluate(() => localStorage.clear());
  await p.goto(url);
  await p.waitForFunction(() => window.harness);
  await p.waitForTimeout(500); // Tailwind CDN styles in
  await p.fill('textarea', LONG);
  await p.waitForTimeout(200);
  await p.evaluate(() => window.harness.setSplit(true));
  await p.waitForTimeout(300);
  m = await measure(p);
  await shot(p, `${out}/${label}-2-split-long.png`);
  check('split view: text not clipped', !m.clipped, JSON.stringify(m));

  // 2b. More text than the cap: capped height plus a scrollbar, nothing cut off
  await p.fill('textarea', LONG.repeat(6));
  await p.waitForTimeout(200);
  const capped = await p.$eval('textarea', (el) => ({
    height: el.offsetHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));
  await shot(p, `${out}/${label}-2b-past-cap.png`);
  check(
    'past the cap: scrollbar',
    capped.height === 320 && capped.overflowY === 'auto',
    JSON.stringify(capped)
  );
  await p.fill('textarea', LONG);
  await p.waitForTimeout(200);

  // 3. Drag handle pins the height, survives reload, double-click returns to auto-grow
  const grip = await p.$('[role="separator"]');
  if (!grip) {
    check('drag handle exists', false);
  } else {
    const box = await grip.boundingBox();
    const before = m.height;
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down();
    await p.mouse.move(box.x + box.width / 2, box.y - 150, { steps: 5 });
    await p.mouse.up();
    const dragged = (await measure(p)).height;
    check('drag up makes it taller', dragged > before + 100, `${before} -> ${dragged}`);
    await p.reload();
    await p.waitForFunction(() => window.harness);
    await p.evaluate(() => window.harness.setSplit(true));
    await p.fill('textarea', LONG);
    await p.waitForTimeout(300);
    const kept = (await measure(p)).height;
    check('height remembered after reload', Math.abs(kept - dragged) <= 1, `${kept}`);
    await shot(p, `${out}/${label}-3-dragged.png`);
    await p.dblclick('[role="separator"]');
    m = await measure(p);
    check(
      'double-click fits to text again',
      Math.abs(m.height - before) <= 1 && !m.clipped,
      `${m.height}`
    );
  }
  await b.close();
  process.exit(fails ? 1 : 0);
})();
