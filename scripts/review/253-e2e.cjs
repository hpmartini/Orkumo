/* global localStorage */
// #253 e2e: a fixed project stays in the rail without sessions; the group menu removes it,
// the command palette adds one through the directory picker.
// Usage: NODE_PATH=<dir with playwright> node scripts/review/253-e2e.cjs <baseUrl> <outDir> <projectDir>
const { chromium } = require('playwright');
const [base, out, dir] = process.argv.slice(2);
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 860 } });
  await ctx.addInitScript((fixed) => {
    if (!localStorage.getItem('e2e253')) {
      localStorage.setItem('e2e253', '1');
      localStorage.setItem(
        'devOrbitAgentRail.v1',
        JSON.stringify({ modes: {}, fixedProjects: [fixed] })
      );
    }
  }, dir);
  const p = await ctx.newPage();
  await p.goto(`${base}/agents`, { waitUntil: 'load' });
  const group = p.getByRole('option').filter({ hasText: 'notes' }).first();
  await group.waitFor({ timeout: 30000 });
  check('fixed project is listed without any session', true);
  // a session the rail hides (interactive terminal) must not count as a filter
  check(
    'rail has a hidden interactive session in this run',
    (await p.getByText(/1 hidden/).count()) === 1
  );
  await p.screenshot({ path: `${out}/253-1-festes-projekt.png` });

  await group.click({ button: 'right' });
  const remove = p.getByRole('menuitem', { name: 'Remove fixed project' });
  await remove.waitFor();
  check(
    'group menu offers "Open terminal here" and "New agent here" for the empty project',
    (await p.getByRole('menuitem', { name: 'Open terminal here' }).count()) === 1 &&
      (await p.getByRole('menuitem', { name: 'New agent here' }).count()) === 1
  );
  await p.screenshot({ path: `${out}/253-2-menue.png` });
  await remove.click();
  await p.waitForTimeout(400);
  check(
    'removed: the empty project is gone',
    (await p.getByRole('option').filter({ hasText: 'notes' }).count()) === 0
  );

  await p.keyboard.press('Meta+P');
  await p.keyboard.type('Add fixed project');
  await p.waitForTimeout(500);
  await p.keyboard.press('Enter');
  await p.getByPlaceholder('Directory of the fixed project…').waitFor();
  await p.getByPlaceholder('/absolute/path').fill(dir);
  await p.screenshot({ path: `${out}/253-3-picker.png` });
  await p.getByRole('button', { name: 'Use path' }).click();
  await p.getByRole('option').filter({ hasText: 'notes' }).first().waitFor({ timeout: 5000 });
  check('added again through the command palette and the directory picker', true);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(2500);
  const stored = await p.evaluate(
    () => JSON.parse(localStorage.getItem('devOrbitAgentRail.v1')).fixedProjects
  );
  check(
    'persisted across a reload',
    JSON.stringify(stored) === JSON.stringify([dir]) &&
      (await p.getByRole('option').filter({ hasText: 'notes' }).count()) === 1,
    JSON.stringify(stored)
  );
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
