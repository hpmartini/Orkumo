/* global window, document */
// Usage: NODE_PATH=<playwright node_modules> node scripts/review/chat-prompts-e2e.cjs <harnessUrl> <events.json> <outDir> <label>
// Real ChatPane in the harness (scripts/review/chat-prompts-harness): history, then a prompt typed
// mid-turn (queued), start-prompt list with jump, answers hidden and remembered after a reload.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const [url, eventsFile, outDir, label] = process.argv.slice(2);
const events = JSON.parse(fs.readFileSync(eventsFile, 'utf8'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 760, height: 520 },
    deviceScaleFactor: 2,
  });
  const shot = (name) => page.screenshot({ path: path.join(outDir, `${label}-${name}.png`) });
  const load = async () => {
    await page.goto(url);
    await page.waitForSelector('[data-chat-pane]');
    await page.waitForTimeout(600); // Tailwind CDN
    await page.evaluate((e) => window.harness.emit(e), events.history);
    await page.waitForTimeout(200);
  };
  await load();

  // 3: a prompt typed while the agent works
  await page.evaluate((e) => window.harness.emit(e), events.live);
  await page.waitForTimeout(200);
  const queued = await page.locator('[data-queued]').count();
  check('prompt typed mid-turn shows at once', queued === 1, `queued bubbles: ${queued}`);
  await shot('1-queued');

  // 4: start prompts, jump to the one after the compaction
  const bar = page.locator('[data-chat-starts]');
  check(
    'start-prompt list',
    (await bar.count()) === 1,
    (await bar.count()) ? await bar.innerText() : 'none'
  );
  if (await bar.count()) {
    await bar.click();
    const entries = page.locator('[data-chat-starts] + ol button');
    check('two start prompts (session start, after compaction)', (await entries.count()) === 2);
    await entries.nth(0).click();
    await page.waitForTimeout(600);
    const inView = await page.evaluate(() => {
      const list = document.querySelector('[role="log"]').getBoundingClientRect();
      const el = document.querySelector('[data-chat-key="u0"]').getBoundingClientRect();
      return el.top >= list.top - 1 && el.top < list.bottom;
    });
    check('jump keeps the first prompt in view', inView);
    await shot('2-starts-jump');
  }

  // 5: answers hidden, remembered for the session
  const toggle = page.getByRole('button', { name: 'Show only my prompts' });
  if (await toggle.count()) {
    await toggle.click();
    await page.waitForTimeout(200);
    const answers = await page.locator('[data-chat-key^="a"]').count();
    check('only prompts shown', answers === 0, `answer cards: ${answers}`);
    await shot('3-prompts-only');
    await load();
    const after = await page.locator('[data-chat-key^="a"]').count();
    check('still only prompts after reload', after === 0, `answer cards: ${after}`);
  } else check('prompts-only button', false, 'missing');

  await browser.close();
  console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAIL');
})();
