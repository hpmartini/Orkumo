/* global getComputedStyle */
// #210 e2e: real app, real rail. Open two agents (double-click), click a third, then ArrowDown to a
// fourth; check the rendered styles of all four cards and take screenshots.
// Usage: NODE_PATH=<dir with playwright> node scripts/review/210-e2e.cjs <baseUrl> <outDir>
const { chromium } = require('playwright');
const [base, out] = process.argv.slice(2);
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1400, height: 860 } })).newPage();
  await p.goto(`${base}/agents`, { waitUntil: 'load' });
  const card = (name) => p.locator('[role="option"][data-session-id]', { hasText: name }).first();
  await card('open-agent').waitFor({ timeout: 90000 });
  await p.waitForTimeout(1500);

  await card('attached-agent').dblclick();
  await p.waitForTimeout(800);
  await card('open-agent').dblclick();
  await p.waitForTimeout(800);
  await card('clicked-agent').click();
  await p.mouse.move(1390, 850); // no hover tint in the shot
  await p.waitForTimeout(600);

  const style = (name) =>
    card(name).evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        outline: s.outlineStyle === 'none' ? 0 : parseFloat(s.outlineWidth),
        shadow: s.boxShadow,
        bg: s.backgroundColor,
        current: el.getAttribute('aria-current'),
        selected: el.getAttribute('aria-selected'),
      };
    });
  const none = (sh) => sh === 'none' || /^(rgba\(0, 0, 0, 0\) 0px 0px 0px 0px(, )?)+$/.test(sh);
  const open = await style('open-agent');
  const attached = await style('attached-agent');
  const clicked = await style('clicked-agent');
  const plain = await style('keyboard-agent');
  console.log(JSON.stringify({ open, attached, clicked, plain }, null, 1));
  check('AC-1 open card: 2px outline + tint', open.current === 'true' && open.outline === 2 && open.bg !== plain.bg);
  check('AC-2 attached card: left bar, no outline, weaker than open', attached.outline === 0 && !none(attached.shadow) && attached.bg !== open.bg);
  check('AC-3 clicked card looks like an untouched one', clicked.selected === 'true' && clicked.outline === 0 && none(clicked.shadow) && clicked.bg === plain.bg);
  const rail = p.locator('[role="listbox"]').first();
  await rail.screenshot({ path: `${out}/rail-open-attached-clicked.png` });
  await p.screenshot({ path: `${out}/app.png` });

  await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(500);
  const kb = await style('keyboard-agent');
  check('AC-4 keyboard-moved selection shows a cursor ring', kb.selected === 'true' && !none(kb.shadow), kb.shadow);
  await rail.screenshot({ path: `${out}/rail-keyboard-cursor.png` });

  for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowUp');
  await p.waitForTimeout(500);
  const kbOpen = await style('open-agent');
  // the 2px outline covers the ring's outer 2px: the ring must be wider than that to show
  const ringPx = Math.max(0, ...[...kbOpen.shadow.matchAll(/0px 0px 0px (\d+)px inset/g)].map((m) => +m[1]));
  check('AC-4 keyboard cursor visible on the open card', kbOpen.selected === 'true' && kbOpen.outline === 2 && ringPx > 2, kbOpen.shadow);
  await rail.screenshot({ path: `${out}/rail-keyboard-on-open.png` });

  await b.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
