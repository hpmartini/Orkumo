/* global window, document, getComputedStyle */
// Usage: NODE_PATH=<playwright node_modules> node scripts/review/terminal-links-e2e.cjs <harnessUrl> <outDir>
// Screenshots before (?off) and after, hover still works, alt-screen and scroll redo the styling.
const { chromium } = require('playwright');
const [url, out] = process.argv.slice(2);
let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 900, height: 330 }, deviceScaleFactor: 2 });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const deco = () => p.locator('.xterm-decoration').count();
  for (const mode of ['off', 'on']) {
    await p.goto(`${url}?${mode}`);
    await p.waitForFunction(() => window.done);
    await p.evaluate(() => window.done);
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/${mode === 'off' ? 'before' : 'after'}.png` });
  }
  // 2 PR URLs, 4 paths, 1 long URL over 2 rows = 8
  const n = await deco();
  check('links decorated', n === 8, `${n} decorations`);
  const style = await p.evaluate(() => {
    const el = document.querySelector('.xterm-decoration');
    return (
      el && {
        border: getComputedStyle(el).borderBottomStyle,
        pe: getComputedStyle(el).pointerEvents,
      }
    );
  });
  check(
    'underline, clicks pass through',
    style?.border === 'solid' && style?.pe === 'none',
    JSON.stringify(style)
  );
  check('no console errors', errors.length === 0, errors.join(' | '));
  // alternate screen (TUIs): links there too, back on the main screen the old ones again
  await p.evaluate(
    () => new Promise((r) => window.term.write('\x1b[?1049h\x1b[Hsee https://orkumo.dev/x\r\n', r))
  );
  await p.waitForTimeout(200);
  check('alt screen', (await deco()) === 1, `${await deco()}`);
  await p.evaluate(() => new Promise((r) => window.term.write('\x1b[?1049l', r)));
  await p.waitForTimeout(200);
  check('back on main screen', (await deco()) === 8, `${await deco()}`);
  // scrolled away: decorations follow the viewport
  await p.evaluate(
    () => new Promise((r) => window.term.write('\r\n'.repeat(20) + 'only https://a.b/c\r\n', r))
  );
  await p.waitForTimeout(200);
  check('scroll follows viewport', (await deco()) === 1, `${await deco()}`);
  await b.close();
  process.exit(fails ? 1 : 0);
})();
