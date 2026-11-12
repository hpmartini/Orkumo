/* global document, getComputedStyle */
// #254 e2e: "Neues Issue" dialog against a stubbed board API (GitHub is the only stand-in).
// Usage: NODE_PATH=<dir with playwright> node scripts/review/254-e2e.cjs <baseUrl> <outDir>
const { chromium } = require('playwright');
const [base, out] = process.argv.slice(2);
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

const options = [
  { id: 's-backlog', name: 'Backlog', color: 'GRAY' },
  { id: 's-todo', name: 'Todo', color: 'BLUE' },
  { id: 's-done', name: 'Done', color: 'GREEN' },
];
const item = (n, repo, status) => ({
  itemId: `PVTI_${n}`,
  type: 'Issue',
  issueId: `I_${n}`,
  number: n,
  title: `Issue ${n}`,
  url: `https://github.com/${repo}/issues/${n}`,
  repo,
  state: 'OPEN',
  stateReason: null,
  statusOptionId: status,
  labels: [],
  milestone: null,
  assignees: [],
  parent: null,
  subIssues: { total: 0, completed: 0 },
  pullRequests: [],
  workflow: null,
  updatedAt: '2026-11-12T00:00:00Z',
  closedAt: null,
});
const board = {
  source: { owner: 'acme', number: 1 },
  projectId: 'PVT_1',
  title: 'Board',
  statusField: { id: 'F_1', options },
  items: [item(1, 'acme/orbit', 's-backlog'), item(2, 'acme/notes', 's-todo')],
  fetchedAt: Date.now(),
};
const repoOptions = {
  repositoryId: 'R_1',
  labels: [
    { id: 'l1', name: 'bug', color: 'd73a4a' },
    { id: 'l2', name: 'mw:go', color: '5319e7' },
  ],
  assignees: [{ id: 'u1', login: 'hpmartini' }],
  milestones: [{ id: 'm1', title: 'v1.0' }],
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  let created = null;
  const json = (route, body) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  await p.route('**/api/board/items*', (r) => json(r, board));
  await p.route('**/api/board/repo-options*', (r) => json(r, repoOptions));
  await p.route('**/api/board/issues', (r) => {
    created = r.request().postDataJSON();
    return json(r, { ...item(3, created.repo, created.statusOptionId), title: created.title });
  });

  await p.goto(`${base}/board`, { waitUntil: 'load' });
  await p.getByText('Issue 1').first().waitFor({ timeout: 30000 });
  await p.getByRole('button', { name: /Neues Issue/ }).first().click();
  const dialog = p.getByRole('dialog', { name: 'Neues Issue' });
  await dialog.waitFor();
  const trigger = (name) => dialog.getByRole('button', { name: `${name} ändern` });
  const lists = () =>
    dialog.locator('[role=listbox][aria-multiselectable]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('aria-label'))
    );
  await p.waitForFunction(
    () => !document.querySelector('[aria-label="Labels ändern"]')?.hasAttribute('disabled')
  );

  const widths = await Promise.all(
    ['Labels', 'Assignees', 'Milestone'].map(async (n) => (await trigger(n).boundingBox()).width)
  );
  const fieldWidth = (await dialog.getByLabel('Titel').boundingBox()).width;
  check('picker buttons are as wide as their value, not the row', widths.every((w) => w < fieldWidth / 2), `${widths.map(Math.round).join('/')} px of ${Math.round(fieldWidth)} px`);
  const border = await trigger('Labels').evaluate((e) => getComputedStyle(e).borderTopWidth);
  check('picker buttons have a visible border', border !== '0px', border);
  await p.screenshot({ path: `${out}/1-dialog.png` });

  await trigger('Labels').click();
  check('Labels opens', JSON.stringify(await lists()) === '["Labels"]');
  // the open list covers the buttons below it, so the next picker is reached by keyboard
  await trigger('Assignees').focus();
  await p.keyboard.press('Enter');
  check('opening Assignees closes Labels', JSON.stringify(await lists()) === '["Assignees"]');
  await trigger('Milestone').focus();
  await p.keyboard.press('Enter');
  check('opening Milestone closes Assignees', JSON.stringify(await lists()) === '["Milestone"]');
  await p.screenshot({ path: `${out}/2-one-picker.png` });
  await dialog.getByLabel('Beschreibung').click();
  check('a click elsewhere closes the picker', (await lists()).length === 0);
  await trigger('Labels').click();
  await dialog.getByRole('option', { name: 'bug' }).click();
  check('picking a label keeps the multi picker open', JSON.stringify(await lists()) === '["Labels"]');
  await trigger('Labels').click();
  check('its own button closes the picker', (await lists()).length === 0);

  await dialog.getByLabel('Titel').fill('#');
  const repoList = dialog.getByRole('listbox', { name: 'Repository' });
  check('# lists the repositories', (await repoList.getByRole('option').count()) === 2);
  await p.screenshot({ path: `${out}/3-hash-repos.png` });
  await dialog.getByLabel('Titel').fill('#no');
  await p.keyboard.press('Enter');
  check('# + Enter picks the repository', (await dialog.getByLabel('Repository').inputValue()) === 'acme/notes');

  await dialog.getByLabel('Status').selectOption({ label: 'Todo' });
  await dialog.getByLabel('Titel').fill('Direkt nach Todo');
  await p.screenshot({ path: `${out}/4-status-todo.png` });
  await dialog.getByRole('button', { name: /Issue anlegen/ }).click();
  await dialog.waitFor({ state: 'detached' });
  check('issue is created in the chosen status', created?.statusOptionId === 's-todo' && created?.repo === 'acme/notes', JSON.stringify(created));

  // /agents: the same dialog offers the status (was Backlog only)
  await p.goto(`${base}/agents`, { waitUntil: 'load' });
  await p.getByRole('button', { name: /More: new agent/ }).click();
  await p.getByRole('menuitem', { name: /New issue/ }).click();
  const d2 = p.getByRole('dialog', { name: 'Neues Issue' });
  await d2.waitFor();
  await d2.getByLabel('Status').waitFor({ timeout: 10000 });
  const names = await d2.getByLabel('Status').locator('option').allTextContents();
  check('/agents: status is choosable', names.includes('Todo'), names.join(', '));
  await p.screenshot({ path: `${out}/5-agents-status.png` });

  await b.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
