// Review #187 browser check against the real project scan (AC-1, AC-2, AC-3).
// Usage: NODE_PATH=<dir with playwright-core> node scripts/review/187-measure.cjs http://localhost:3187/
// CommonJS on purpose: NODE_PATH resolves playwright-core without adding a project dependency.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const url = process.argv[2] ?? 'http://localhost:3187/';

(async () => {
  const browser = await chromium.launch();
  try {
    // Fresh context: no saved size or collapse state
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(url);
    const open = async () => {
      await page.getByRole('button', { name: 'Neuer Kontext' }).click({ timeout: 60000 });
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(300);
    };
    const measure = () =>
      page.evaluate(() => {
        const d = document.querySelector('[role=dialog]');
        const l = document.querySelector('[data-testid=context-project-list]');
        const lr = l.getBoundingClientRect();
        const rows = [...l.querySelectorAll('input[type=checkbox]')].filter((c) => {
          const r = c.getBoundingClientRect();
          return r.height > 0 && r.top >= lr.top && r.bottom <= lr.bottom;
        }).length;
        const save = [...d.querySelectorAll('button')]
          .find((b) => /Anlegen|Speichern/.test(b.textContent))
          .getBoundingClientRect();
        return {
          width: d.offsetWidth,
          height: d.offsetHeight,
          listHeight: l.clientHeight,
          visibleRows: rows,
          projects: l.querySelectorAll('input[type=checkbox]').length,
          footerVisible: save.top >= 0 && save.bottom <= innerHeight,
        };
      });

    await open();
    const before = await measure();
    const box = await page.getByRole('dialog').boundingBox();
    await page.mouse.move(box.x + box.width - 3, box.y + box.height - 3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 300, box.y + 2000, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = await measure();
    console.log('AC-1 before', before);
    console.log('AC-1 after ', after);
    assert.ok(after.width > before.width && after.height > before.height, 'dialog grew');
    assert.ok(after.listHeight > before.listHeight, 'list uses the extra height');
    assert.ok(after.footerVisible, 'save button stays in the viewport');

    await page.keyboard.press('Escape');
    await page.reload();
    await open();
    const reopened = await measure();
    console.log('AC-2 reopened after reload', reopened);
    assert.ok(Math.abs(reopened.width - after.width) <= 2, 'width kept');
    assert.ok(Math.abs(reopened.height - after.height) <= 2, 'height kept');

    await page.getByRole('button', { name: 'Alle Verzeichnisse einklappen' }).click();
    const headers = page.locator('[data-testid=context-project-list] button[aria-expanded]');
    await headers.first().focus();
    await page.keyboard.press('Enter');
    const states = await headers.evaluateAll((bs) =>
      bs.map((b) => b.getAttribute('aria-expanded'))
    );
    console.log('AC-3 aria-expanded after collapse all + Enter on first header', states);
    assert.equal(states[0], 'true');
    assert.ok(states.slice(1).every((s) => s === 'false'));
    console.log('PASS');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
