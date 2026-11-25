// e2e: the UI view of a Claude pane follows the agent through /clear (and /compact). Real Orkumo,
// real Claude Code in the pane: start an agent in a fixed project, switch the pane to the UI view,
// send `/clear` and a prompt through the UI composer, then `/compact` and one more prompt. Checks:
// the turn before the clear stays, a "Context cleared · hh:mm" divider follows, the answers after
// it arrive live, a "Context compacted" divider after /compact. Run it against an isolated
// instance (own DEVORBIT_DATA_PATH) whose project dirs hold PROJECT.
// Usage: NODE_PATH=<dir with playwright> node scripts/review/ui-follow-clear-e2e.cjs <baseUrl> <outDir> <project>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [BASE, OUT, PROJECT] = process.argv.slice(2);
if (!BASE || !OUT || !PROJECT)
  throw new Error('usage: ui-follow-clear-e2e.cjs <baseUrl> <outDir> <project>');
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const shot = (name) => p.screenshot({ path: path.join(OUT, `${name}.png`) });
  const pane = () => p.locator('main, body').first();
  const send = async (text) => {
    const box = p.getByPlaceholder(/^Message/).first();
    await box.fill(text);
    await box.press('Meta+Enter');
  };
  const sawText = (text, timeout) =>
    pane()
      .getByText(text, { exact: true })
      .filter({ visible: true })
      .first()
      .waitFor({ timeout })
      .then(
        () => true,
        () => false
      );

  await p.goto(`${BASE}/agents`);
  await p.waitForTimeout(3000);
  await p.keyboard.press('Meta+P');
  await p.keyboard.type('Add fixed project');
  await p.waitForTimeout(500);
  await p.keyboard.press('Enter');
  await p.getByText(path.basename(PROJECT), { exact: true }).last().click();
  await p.waitForTimeout(1500);
  await p
    .getByRole('option')
    .filter({ hasText: path.basename(PROJECT) })
    .first()
    .click({ button: 'right' });
  await p.getByRole('menuitem', { name: 'New agent here' }).click();
  await p
    .getByRole('button', { name: /Oh My Pi|Claude Code/ })
    .first()
    .click();
  await p.getByText('Claude Code', { exact: true }).last().click();
  // no first prompt: the agent idles until the UI composer sends one
  await p.getByRole('button', { name: 'Start agent' }).click();
  await p.waitForTimeout(8000);
  // the new agent runs in the background: open it in a pane
  const agents = await (await fetch(`${BASE.replace(/:\d+$/, ':3871')}/api/agents`)).json();
  const mine = agents.sessions.filter((a) => a.cwd === PROJECT).at(-1);
  if (!mine) throw new Error(`no agent in ${PROJECT}`);
  console.log(`agent ${mine.id}`);
  await p.getByText(mine.id.slice(0, 8), { exact: true }).first().dblclick();
  await p.waitForTimeout(5000);
  await shot('0-terminal');
  // a background agent opens in the UI view; a terminal pane switches to it
  const uiView = p.getByRole('button', { name: 'UI view', exact: true });
  if (await uiView.count()) await uiView.first().click();
  await p.waitForTimeout(2000);
  await send('Reply with exactly the word ALPHA and nothing else.');
  check('UI view shows the first answer', await sawText('ALPHA', 90000));
  await shot('1-before-clear');

  await send('/clear');
  await p.waitForTimeout(6000);
  await send('Reply with exactly the word BRAVO and nothing else.');
  check('UI view shows the answer after /clear (live)', await sawText('BRAVO', 90000));
  check('the turn before /clear is still there', await sawText('ALPHA', 1000));
  const seps = await pane()
    .getByRole('separator')
    .filter({ hasText: /^Context|^New session/ })
    .allTextContents();
  check(
    'a timed "Context cleared" divider',
    seps.some((s) => /^Context cleared · \d\d:\d\d$/.test(s)),
    JSON.stringify(seps)
  );
  const order = await pane().evaluate((el) => {
    const t = el.textContent; // innerText would carry the divider's uppercase transform
    return [t.indexOf('ALPHA'), t.indexOf('Context cleared'), t.lastIndexOf('BRAVO')];
  });
  check(
    'order: old turn, divider, new turn',
    order[0] >= 0 && order[0] < order[1] && order[1] < order[2],
    JSON.stringify(order)
  );
  await shot('2-after-clear');

  await send('/compact');
  check(
    'a "Context compacted" divider after /compact',
    await pane()
      .getByRole('separator')
      .filter({ hasText: 'Context compacted' })
      .first()
      .waitFor({ timeout: 120000 })
      .then(
        () => true,
        () => false
      )
  );
  await send('Reply with exactly the word CHARLIE and nothing else.');
  check('UI view shows the answer after /compact', await sawText('CHARLIE', 90000));
  await shot('3-after-compact');
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
