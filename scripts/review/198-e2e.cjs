/* global document */
// #198 e2e: real app on real agent sessions. Rail text search in the filter row.
// Usage: NODE_PATH=<dir with playwright> node scripts/review/198-e2e.cjs <baseUrl> <screenshotDir>
const { chromium } = require('playwright');
const [base, out] = process.argv.slice(2);
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await p.goto(`${base}/agents`, { waitUntil: 'load' });
  const search = p.getByRole('searchbox', { name: 'Search agents' });
  await search.waitFor({ timeout: 90000 });
  await p.waitForSelector('[data-session-id]', { timeout: 90000 });
  await p.waitForTimeout(1500);
  const counter = () => p.locator('[aria-live="polite"]').filter({ hasText: /agent|of/ }).first().innerText();
  const rows = () => p.locator('[data-session-id]').count();

  // AC-1: visible in the filter row, placeholder, no overflow
  const box = await search.boundingBox();
  const bar = await search.evaluate((el) => {
    const row = el.closest('.flex.items-center');
    return { scroll: row.scrollWidth, client: row.clientWidth };
  });
  check('AC-1 field visible with placeholder', !!box && (await search.getAttribute('placeholder')) === 'Suche');
  check('AC-1 filter row does not overflow', bar.scroll <= bar.client, JSON.stringify(bar));
  await p.screenshot({ path: `${out}/1-suchfeld.png`, clip: { x: 0, y: 0, width: 520, height: 400 } });

  // Search term: longest word of the first row's name
  const first = await p.locator('[data-session-id]').first().innerText();
  const term = first.split(/\s+/).filter((w) => /^[\p{L}\d-]{4,}$/u.test(w)).sort((a, c) => c.length - a.length)[0] || first.slice(0, 4);
  const before = await counter();

  // AC-2 / AC-4: live narrowing, "N of M"
  await search.fill(term);
  await p.waitForTimeout(300);
  const narrowed = await counter();
  check('AC-2 list narrows live', / of /.test(narrowed), `"${term}": ${before} -> ${narrowed}`);
  check('AC-2 case-insensitive', await (async () => {
    await search.fill(term.toUpperCase());
    await p.waitForTimeout(200);
    return (await counter()) === narrowed;
  })());
  await p.screenshot({ path: `${out}/2-suche.png`, clip: { x: 0, y: 0, width: 520, height: 600 } });

  // AC-5: typing digits, letters, arrows, Enter stays in the field
  const url = p.url();
  const selBefore = await p.locator('[role="option"][aria-selected="true"]').count();
  await search.fill('');
  await search.press('ArrowDown');
  await search.type('j1 k2');
  await search.press('Enter');
  check(
    'AC-5 no rail shortcut while typing',
    (await search.inputValue()) === 'j1 k2' &&
      p.url() === url &&
      (await search.evaluate((el) => document.activeElement === el)),
    `value=${await search.inputValue()} url=${p.url()} selected=${selBefore}`
  );

  // AC-4: Escape clears and leaves the field
  await search.press('Escape');
  check(
    'AC-4 Escape clears and blurs',
    (await search.inputValue()) === '' && !(await search.evaluate((el) => document.activeElement === el))
  );
  check('AC-4 counter back to total', (await counter()) === before, await counter());

  // AC-3: search combined with a chip only narrows the chip's view
  await p.getByRole('button', { name: 'Show filters' }).click();
  const chip = p.locator('#agent-filter-chips button').filter({ hasText: /^Completed/ });
  await chip.click();
  await p.waitForTimeout(200);
  const chipOnly = await counter();
  await search.fill(term);
  await p.waitForTimeout(300);
  const both = await counter();
  const n = (s) => Number(s.split(' ')[0]);
  check('AC-3 search within chip filter', n(both) <= n(chipOnly) && n(both) <= n(narrowed), `chip=${chipOnly} chip+search=${both} search=${narrowed}`);
  await p.screenshot({ path: `${out}/3-suche-mit-chip.png`, clip: { x: 0, y: 0, width: 520, height: 600 } });

  // AC-4: Clear also empties the search
  await p.getByTitle('Clear all filters').click();
  check('AC-4 Clear empties search', (await search.inputValue()) === '' && (await counter()) === before, await counter());
  await chip.isVisible().then(async (v) => v && (await p.getByRole('button', { name: 'Hide filters' }).click()));

  // AC-6: collapsed groups do not hide matches
  await p.getByRole('button', { name: 'Collapse all groups' }).click();
  await p.waitForTimeout(300);
  const collapsedRows = await rows();
  await search.fill(term);
  await p.waitForTimeout(300);
  const searchRows = await rows();
  check('AC-6 matches shown despite collapsed groups', searchRows > 0, `collapsed=${collapsedRows} with search=${searchRows}`);
  await p.screenshot({ path: `${out}/4-eingeklappt-mit-suche.png`, clip: { x: 0, y: 0, width: 520, height: 600 } });
  await search.fill('');
  await p.getByRole('button', { name: 'Expand all groups' }).click().catch(() => {});

  await b.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
