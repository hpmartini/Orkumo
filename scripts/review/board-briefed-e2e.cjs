/* global document */
// Board briefed e2e: the real UI on Vite, /api/board/* answered from fixture MACC data (Todo,
// Briefed, In Progress, to Review, Done), so the Briefed column and the feedback buttons can be seen
// without a GitHub project. Usage: NODE_PATH=<dir with playwright> node <this> <baseUrl> <shotDir>
const { chromium } = require('playwright');
const [base, out] = process.argv.slice(2);
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

const options = [
  { id: 'o-todo', name: 'Todo', color: 'BLUE' },
  { id: 'o-briefed', name: 'Briefed', color: 'ORANGE' },
  { id: 'o-prog', name: 'In Progress', color: 'YELLOW' },
  { id: 'o-review', name: 'to Review', color: 'PURPLE' },
  { id: 'o-done', name: 'Done', color: 'GREEN' },
];
const marker = (kind, at, attrs = {}) => ({ kind, attrs, at });
const T = '2026-11-05T09:00:00Z';
const card = (number, title, statusOptionId, extra = {}) => ({
  itemId: `PVTI_${number}`,
  type: 'Issue',
  issueId: `I_${number}`,
  number,
  title,
  url: `https://github.com/hpmartini/Orkumo/issues/${number}`,
  repo: 'hpmartini/Orkumo',
  state: 'OPEN',
  stateReason: null,
  statusOptionId,
  labels: [{ name: 'mw:go', color: '5319e7' }],
  milestone: null,
  assignees: [],
  parent: null,
  subIssues: { total: 0, completed: 0 },
  pullRequests: [],
  mwBoardSessions: [],
  mwMarkers: [marker('start', T, { session: 's', mode: 'default' })],
  updatedAt: T,
  closedAt: null,
  ...extra,
});
const briefed = card(301, 'Board zeigt die Spalte Briefed', 'o-briefed', {
  mwMarkers: [
    marker('start', T, { session: 's', mode: 'default' }),
    marker('briefed', '2026-11-05T10:00:00Z', { path: 'briefings/2026-11-05-x.md' }),
  ],
});
const items = [
  card(300, 'Neues Feature, Interview läuft', 'o-todo'),
  briefed,
  card(302, 'Umsetzung mit /goal', 'o-prog', {
    mwMarkers: [marker('start', T), marker('briefed', T), marker('goal', T)],
  }),
  card(303, 'PR wartet auf Review', 'o-review', {
    pullRequests: [{ number: 9, url: 'https://github.com/hpmartini/Orkumo/pull/9', state: 'OPEN' }],
  }),
  card(304, 'Fertig und gemerged', 'o-done', { state: 'CLOSED', closedAt: T }),
];
const board = {
  source: { owner: 'hpmartini', number: 1 },
  projectId: 'PVT_1',
  title: 'MACC',
  statusField: { id: 'F', options },
  items,
  fetchedAt: Date.now(),
};
const repoOptions = {
  repositoryId: 'R',
  labels: ['mw:go', 'mw:build', 'mw:dynamic', 'mw:delegate', 'mw:review', 'mw:image', 'mw:update', 'mw:followup'].map(
    (name, i) => ({ id: `L${i}`, name, color: '000000' })
  ),
  assignees: [],
  milestones: [],
};

const answer = (path) => {
  if (path === '/api/board/items') return board;
  if (path === '/api/board/settings')
    return { source: board.source, favorites: [], order: [], hidden: [] };
  if (path === '/api/board/repo-options') return repoOptions;
  if (/^\/api\/board\/issues\/[^/]+\/comments$/.test(path)) return { comments: [] };
  if (/^\/api\/board\/issues\/[^/]+$/.test(path)) return { body: 'Briefing liegt vor.', subIssues: [] };
  return null;
};

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
  await p.route('**/api/board/**', (route) => {
    const body = answer(new URL(route.request().url()).pathname);
    return body
      ? route.fulfill({ json: body })
      : route.fulfill({ status: 404, json: { error: 'fixture: not mocked' } });
  });
  await p.goto(`${base}/board`, { waitUntil: 'load' });
  await p.getByText('Board zeigt die Spalte Briefed').first().waitFor({ timeout: 90000 });
  await p.waitForTimeout(1000);

  const heads = await p.evaluate(() =>
    [...document.querySelectorAll('button[aria-expanded]')].map((e) => e.textContent.trim())
  );
  const order = ['Todo', 'Briefed', 'In Progress', 'to Review', 'Done'].map((n) =>
    heads.findIndex((h) => h.replace(/\d+/g, "") === n)
  );
  check('Briefed column from the MACC options, in order', order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])), heads.join(' | '));
  await p.screenshot({ path: `${out}/1-board-briefed.png` });

  await p.getByText('Board zeigt die Spalte Briefed').first().click();
  const box = p.getByLabel('Rückmeldung');
  await box.waitFor({ timeout: 30000 });
  const upd = p.getByRole('button', { name: 'Überarbeiten' });
  await p.waitForTimeout(800);
  check('Überarbeiten disabled without text', await upd.isDisabled());
  await box.fill('Abschnitt Guardrails bitte um den Altfall ergänzen.');
  check('Überarbeiten enabled with text', await upd.isEnabled());
  await p.screenshot({ path: `${out}/2-dialog-ueberarbeiten.png` });

  await b.close();
  console.log(fails ? `${fails} FAIL` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
