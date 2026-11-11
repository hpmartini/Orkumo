// E2E for #208 in Chromium against the real app (server + vite, GitHub faked by 208-fake-gh).
// Usage: node 208-e2e.cjs <appUrl> <shotsDir> <fakeGhStateFile>
const { chromium } = require('playwright');
const fs = require('fs');

const [url, shots, state] = process.argv.slice(2);
const ISSUE = `${url}/board?item=${encodeURIComponent('o/onboard#1')}`;
let failed = 0;
const check = (id, ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${what}`);
  if (!ok) failed++;
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    recordVideo: { dir: shots, size: { width: 1400, height: 900 } },
  });
  const page = await ctx.newPage();
  const panel = page.locator('aside').filter({ hasText: 'Agents an diesem Issue' });
  const comments = panel.getByRole('region', { name: 'Kommentare' });
  const toggle = comments.getByRole('button', { name: /umschalten/ });
  const authors = () => comments.locator('li span.font-medium').allTextContents();
  const open = async () => {
    await page.goto(ISSUE);
    await comments.locator('li').first().waitFor({ timeout: 30000 });
  };

  await open();
  // AC-1: DOM order of the panel sections
  const order = await panel.evaluate((root) => {
    const find = (sel, text) =>
      [...root.querySelectorAll(sel)].find((e) => !text || e.textContent.trim().startsWith(text));
    const els = [
      ['Titel', find('h2, button, div', 'Review #208')],
      ['Status', find('select[aria-label="Status"]')],
      ['Agents', find('h3', 'Agents an diesem Issue')],
      ['Pull Requests', find('h3', 'Pull Requests')],
      ['Sub-Issues', find('h3', 'Sub-Issues')],
      ['Beschreibung', find('h3', 'Beschreibung')],
      ['Kommentare', find('section[aria-label="Kommentare"]')],
    ];
    const missing = els.filter(([, e]) => !e).map(([n]) => n);
    if (missing.length) return `fehlt: ${missing}`;
    for (let i = 1; i < els.length; i++)
      if (!(els[i - 1][1].compareDocumentPosition(els[i][1]) & Node.DOCUMENT_POSITION_FOLLOWING))
        return `${els[i - 1][0]} nicht vor ${els[i][0]}`;
    return 'ok';
  });
  check('AC-1', order === 'ok', `Reihenfolge Titel→Status→Agents→PRs→Sub-Issues→Beschreibung→Kommentare (${order})`);
  check('AC-1', await panel.getByText('Fake-PR zu #1').isVisible(), 'PR sichtbar oben im Panel');
  await page.screenshot({ path: `${shots}/panel-oben.png` });

  // AC-2 + AC-3 default: API order is mitte, alt, neu
  check('AC-3', (await toggle.textContent()).includes('Älteste zuerst'), 'Default ohne gespeicherten Wert: Älteste zuerst');
  check('AC-2', JSON.stringify(await authors()) === JSON.stringify(['@alt', '@mitte', '@neu']), `älteste zuerst: ${await authors()}`);
  const boxBeforeList = () =>
    comments.evaluate((s) => {
      const box = s.querySelector('textarea');
      const list = s.querySelector('ul');
      return !!(box.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
  check('AC-4', !(await boxBeforeList()), 'älteste zuerst: Composer unter der Liste');
  await comments.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/kommentare-aelteste.png` });

  await toggle.click();
  check('AC-2', JSON.stringify(await authors()) === JSON.stringify(['@neu', '@mitte', '@alt']), `neueste zuerst: ${await authors()}`);
  check('AC-4', await boxBeforeList(), 'neueste zuerst: Composer über der Liste');
  await comments.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/kommentare-neueste.png` });

  // AC-3: real reload keeps the choice
  await page.reload();
  await comments.locator('li').first().waitFor({ timeout: 30000 });
  check('AC-3', (await toggle.textContent()).includes('Neueste zuerst'), 'nach Neuladen weiter Neueste zuerst');
  check('AC-3', (await authors())[0] === '@neu', 'nach Neuladen neuester oben');

  // AC-4: reply inserts the newest comment's author, send goes through server to (fake) GitHub
  await comments.getByRole('button', { name: 'Antworten' }).first().click();
  const box = comments.getByLabel('Neuer Kommentar');
  check('AC-4', (await box.inputValue()).includes('@neu'), 'Antworten auf obersten Kommentar füllt @neu ein');
  await box.fill('Neu aus dem E2E #208');
  await comments.getByRole('button', { name: 'Kommentieren' }).click();
  await comments.getByText('Neu aus dem E2E #208').waitFor({ timeout: 15000 });
  check('AC-4', (await authors())[0] === '@review', 'gesendeter Kommentar erscheint oben (neueste zuerst)');
  check('AC-4', (await box.inputValue()) === '', 'Composer nach Senden leer');
  const stored = JSON.parse(fs.readFileSync(state, 'utf8'));
  check('AC-4', stored.some((c) => c.body === 'Neu aus dem E2E #208'), 'addComment kam beim (Fake-)GitHub an');

  // AC-3: a blocked localStorage breaks nothing (fresh context, storage throws)
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx2.addInitScript(() => {
    for (const m of ['getItem', 'setItem'])
      Storage.prototype[m] = () => {
        throw new Error('blocked');
      };
  });
  const p2 = await ctx2.newPage();
  const errors = [];
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.goto(ISSUE);
  const c2 = p2.locator('section[aria-label="Kommentare"]');
  await c2.locator('li').first().waitFor({ timeout: 30000 });
  await c2.getByRole('button', { name: /umschalten/ }).click();
  const first = await c2.locator('li span.font-medium').first().textContent();
  check('AC-3', errors.length === 0 && first === '@review', `localStorage blockiert: kein Fehler, Umschalten geht (${errors})`);
  await ctx2.close();

  await ctx.close(); // flushes the video
  await browser.close();
  console.log(failed ? `${failed} FAIL` : 'e2e: alle Checks PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
