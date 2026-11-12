// MAGOS#497 e2e: a PR pill opens exactly its pull request(s); the overview opens from "open PRs".
// Usage: NODE_PATH=<dir with playwright> node scripts/review/497-e2e.cjs <baseUrl> <outDir>
const { chromium } = require('playwright');
const [base, out] = process.argv.slice(2);
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(`${base}/agents`, { waitUntil: 'load' });
  const overview = p.getByRole('dialog', { name: 'Open pull requests' });

  const pill = p.getByRole('button', { name: 'Pull request #479' }).first();
  await pill.waitFor({ timeout: 30000 });
  await pill.click();
  const one = p.getByRole('dialog', { name: 'Pull request #479' });
  await one.waitFor();
  check('pill #479 opens a modal for exactly that PR', await one.getByText('IMAP fuer das Privatkonto').isVisible());
  check('the modal does not list other PRs', (await one.getByText('DMS-Eingang').count()) === 0);
  check('the overview stays closed', (await overview.count()) === 0);
  check('merged PR is shown with its state', await one.getByText('merged').isVisible());
  const href = await one.getByRole('link', { name: 'Open #479 in browser' }).getAttribute('href');
  check('links to the PR itself', href === 'https://github.com/acme/orbit/pull/479', href);
  await p.screenshot({ path: `${out}/1-single-pr.png` });
  await p.keyboard.press('Escape');
  check('Escape closes the modal', (await one.count()) === 0);

  await p.getByRole('button', { name: 'Pull request 2' }).first().click();
  const two = p.getByRole('dialog', { name: '2 pull requests' });
  await two.waitFor();
  check('a pill with two PRs lists both and nothing else', (await two.getByRole('listitem').count()) === 2 && (await two.getByText('IMAP').count()) === 0);
  await p.screenshot({ path: `${out}/2-two-prs.png` });

  await two.getByRole('button', { name: 'All open PRs' }).click();
  check('"All open PRs" leads to the overview', (await two.count()) === 0 && (await overview.count()) === 1);
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: /open PRs?$/ }).first().click();
  check('"xx open PRs" in the summary bar opens the overview', (await overview.count()) === 1);
  await p.screenshot({ path: `${out}/3-overview.png` });

  await b.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
