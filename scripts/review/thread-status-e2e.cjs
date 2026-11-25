/* global document, getComputedStyle */
// e2e for H-6: the maximised threads panel lists the orchestrator's Status entries below the
// threads; a click shows the entry's details (the Status module's view) in the main area while the
// panel stays maximised; "Show in Status" in a bound thread opens the same details; an option there
// answers like the Status view. Real mouse and keyboard in a tab, a split and a drawer (narrow tab).
// Needs a running Orkumo with the Status module and orchestrator ORCH (session id) whose report has
// the tasks named in TASKS, each with an open decision (options). Sends one message into a new
// thread bound to the first task and one answer per mode; both reach the orchestrator's PTY.
// The pane header's own "Show in Status" (whole status of the orchestrator) shows in the panel while
// maximised and covers an open drawer. Esc right after a list click or "Show in Status" is logged
// (INFO), not checked. Fixture used for the committed run: report.example.json of the orchestrator
// CLI plus two waiting tasks (versand-regeln, newsletter) each with a copy of its decision.
// Usage: NODE_PATH=<dir with playwright> ORCH=<session id> [OTHER=<session id>] [CHROME=<path>]
//   node scripts/review/thread-status-e2e.cjs <baseUrl> <outDir>
const pw = (() => {
  try {
    return require('playwright');
  } catch {
    return require('playwright-core');
  }
})();
const fs = require('fs');
const [BASE, OUT] = process.argv.slice(2);
const API = process.env.API || BASE.replace(/:\d+$/, ':3592') + '/api';
const { ORCH, OTHER } = process.env;
if (!BASE || !OUT || !ORCH)
  throw new Error('usage: ORCH=<id> node thread-status-e2e.cjs <baseUrl> <outDir>');
fs.mkdirSync(OUT, { recursive: true });
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
// project/task ids, titles and the id (prefix) of each task's open decision; the first task gets
// the bound thread
const PROJECT = process.env.PROJECT || 'beispiel-shop';
const TASKS = {
  tab: ['rabatt-codes', 'Rabattcodes pro Kunde begrenzen', 'rabatt-limit'],
  split: ['versand-regeln', 'Versandkosten nach Gewicht staffeln', 'versand-regeln-frage'],
  drawer: ['newsletter', 'Newsletter-Anmeldung im Checkout', 'newsletter-frage'],
};
let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const wait = (page, ms) => page.waitForTimeout(ms);

async function rowId(sessionId) {
  const { sessions } = await (await fetch(`${API}/agents`)).json();
  return sessions.find((s) => s.sessionId === sessionId)?.id;
}
async function openAgent(page, sessionId) {
  const card = page.locator(`[role="option"][data-session-id="${await rowId(sessionId)}"]`);
  if (!(await card.count())) {
    await page.locator('[role="option"]', { hasText: 'Orchestrators' }).first().click();
    await wait(page, 800);
  }
  await card.first().dblclick();
  await wait(page, 3500);
}
const panes = (page) => page.locator('[data-chat-pane]:visible');
// the visible pane of the orchestrator: the one holding the thread bound to the first task
async function orchPane(page) {
  const n = await panes(page).count();
  for (let i = 0; i < n; i++) {
    await showPanel(page, i);
    const rows = panes(page).nth(i).locator('[data-thread-row]', { hasText: TASKS.tab[1] });
    if (await rows.count()) return i;
    // not this one: put its panel away again
    await panes(page).nth(i).getByRole('button', { name: 'Hide threads panel' }).click();
    await wait(page, 300);
  }
  return -1;
}

// layout facts of pane i: maximised, mode, status list below the threads, details, clipping
const state = (page, i) =>
  page.evaluate((i) => {
    const pane = [...document.querySelectorAll('[data-chat-pane]')].filter(
      (p) => p.getBoundingClientRect().width > 0
    )[i];
    const aside = pane.querySelector('aside[aria-label="Threads"]');
    const panel = pane.querySelector('[data-threads-panel]');
    const rows = [...pane.querySelectorAll('[data-thread-row]')];
    const status = [...pane.querySelectorAll('[data-status-row]')];
    const details = pane.querySelector('[data-threads-status]');
    const box = (aside || pane).getBoundingClientRect();
    const clipped = [...(aside || pane).querySelectorAll('button, span, textarea, h2, h3, p')]
      .filter((e) => !e.closest('pre, code'))
      .filter((e) => {
        const b = e.getBoundingClientRect();
        if (!b.width || !b.height) return false;
        let [left, right, top, bottom] = [b.left, b.right, b.top, b.bottom];
        for (let a = e.parentElement; a && a !== pane; a = a.parentElement) {
          const st = getComputedStyle(a);
          const r = a.getBoundingClientRect();
          if (st.overflowX !== 'visible')
            [left, right] = [Math.max(left, r.left), Math.min(right, r.right)];
          if (st.overflowY !== 'visible')
            [top, bottom] = [Math.max(top, r.top), Math.min(bottom, r.bottom)];
        }
        if (right <= left || bottom <= top) return false;
        return (
          right > box.right + 1 ||
          left < box.left - 1 ||
          bottom > box.bottom + 1 ||
          top < box.top - 1
        );
      })
      .map((e) => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30));
    return {
      pane: Math.round(pane.getBoundingClientRect().width),
      aside: aside ? Math.round(aside.getBoundingClientRect().width) : 0,
      maximized: panel?.getAttribute('data-threads-maximized') === 'true',
      mode: pane.querySelector('[data-threads-mode]')?.getAttribute('data-threads-mode') ?? null,
      statusRows: status.map((s) => s.getAttribute('data-status-row')),
      statusBelowThreads:
        status.length > 0 &&
        (rows.length === 0 ||
          status[0].getBoundingClientRect().top >=
            rows[rows.length - 1].getBoundingClientRect().bottom - 1),
      current:
        status
          .find((s) => s.getAttribute('aria-current') === 'true')
          ?.getAttribute('data-status-row') ?? null,
      details: details?.getAttribute('aria-label') ?? null,
      detailsText: details?.innerText ?? '',
      detailsInside:
        !details ||
        (() => {
          const d = details.getBoundingClientRect();
          return d.right <= box.right + 1 && d.bottom <= box.bottom + 1 && d.width > 200;
        })(),
      clipped,
      // inside the details: nothing past their right edge (raw box, an overflow-hidden card cuts
      // it), no text squeezed into a column narrower than a word
      detailsCut: details
        ? [...details.querySelectorAll('span, div, p, button, li')]
            .filter((e) => !e.closest('pre'))
            .filter((e) => {
              const b = e.getBoundingClientRect();
              const d = details.getBoundingClientRect();
              const text = (e.innerText || '').trim();
              return b.width > 1 && (b.right > d.right + 1 || (text.length > 12 && b.width < 72));
            })
            .map((e) => (e.innerText || '').trim().slice(0, 30))
        : [],
    };
  }, i);

async function showPanel(page, i) {
  const t = panes(page).nth(i).locator('button[aria-label="Threads"][aria-pressed="false"]');
  if (await t.count()) {
    await t.click();
    await wait(page, 400);
  }
}

// a thread bound to the first task: New thread -> the task -> first message (it goes to the orchestrator)
async function boundThread(page, i) {
  const pane = panes(page).nth(i);
  const [, title] = TASKS.tab;
  const row = pane.locator('[data-thread-row]', { hasText: title });
  if (await row.count()) {
    if ((await row.first().getAttribute('aria-current')) !== 'true') await row.first().click();
    await wait(page, 600);
    return;
  }
  await pane.getByRole('button', { name: 'New thread' }).click();
  await page.getByRole('menuitem', { name: new RegExp(title) }).click();
  await wait(page, 600);
  await pane.locator('aside[aria-label="Threads"] textarea').first().click();
  await page.keyboard.type('e2e H-6: kurze Bestaetigung bitte, nur "ok".');
  await page.keyboard.press(`${MOD}+Enter`);
  await wait(page, 3000);
}

async function maximise(page, i) {
  const pane = panes(page).nth(i);
  if (!(await state(page, i)).maximized) {
    await pane.getByRole('button', { name: 'Maximize threads' }).click();
    await wait(page, 500);
  }
}

// the pane header's "Show in Status" (not the one in a thread's header inside the panel)
const headerStatus = (page, i) =>
  panes(page)
    .nth(i)
    .locator(':scope > div:first-child')
    .getByRole('button', { name: 'Show in Status', exact: true });
// Esc right after an action (focus wherever that action left it); restores the maximised thread view
async function escProbe(page, i, what) {
  await page.keyboard.press('Escape');
  await wait(page, 500);
  const s = await state(page, i);
  console.log(
    `INFO Esc right after ${what}: details ${s.details ? 'still shown' : 'closed'}, ${s.maximized ? 'still maximised' : 'panel restored'}`
  );
  if (s.details)
    await panes(page).nth(i).getByRole('button', { name: 'Back to the thread (Esc)' }).click();
  if (!s.maximized) await maximise(page, i);
  await wait(page, 300);
}

// one mode: list click, details, Back, "Show in Status", one real answer
async function modeChecks(page, i, name) {
  const pane = panes(page).nth(i);
  const [task, title] = TASKS[name];
  const [bound, boundTitle] = TASKS.tab;
  await showPanel(page, i);
  const s0 = await state(page, i);
  await boundThread(page, i);
  await maximise(page, i);
  const s1 = await state(page, i);
  await shot(page, `${name}-1-maximised-status-list`);
  check(
    `${name}: panel maximised (mode before: ${s0.mode})`,
    s1.maximized,
    JSON.stringify({ pane: s1.pane, aside: s1.aside })
  );
  check(
    `${name}: Status list below the thread list`,
    s1.statusRows.includes(`${PROJECT}/${task}`) && s1.statusBelowThreads,
    JSON.stringify(s1.statusRows)
  );
  check(`${name}: nothing clipped (list)`, s1.clipped.length === 0, JSON.stringify(s1.clipped));
  if (name === 'tab') {
    // the list on the left (sidebar): the Status list sits under the threads there too
    await pane.getByRole('button', { name: 'Thread list on the left' }).click();
    await wait(page, 400);
    const ss = await state(page, i);
    await shot(page, `${name}-1b-sidebar-status-list`);
    check(
      `${name}: sidebar, Status list under the threads`,
      ss.statusBelowThreads && ss.maximized && ss.clipped.length === 0,
      JSON.stringify(ss.clipped)
    );
  }

  // a click on the entry: details in the main area, maximisation stays
  await pane.locator(`[data-status-row="${PROJECT}/${task}"]`).click();
  await pane.locator('[data-threads-status]').waitFor({ timeout: 10000 });
  await wait(page, 1500);
  const s2 = await state(page, i);
  await shot(page, `${name}-2-details-from-list`);
  check(
    `${name}: list click shows "${title}" details, still maximised`,
    s2.maximized &&
      s2.details === `Status · ${title}` &&
      s2.detailsText.includes(title) &&
      s2.current === `${PROJECT}/${task}`,
    JSON.stringify({ details: s2.details, current: s2.current })
  );
  check(
    `${name}: details inside the panel, nothing clipped`,
    s2.detailsInside && s2.clipped.length === 0 && s2.detailsCut.length === 0,
    JSON.stringify([...s2.clipped, ...s2.detailsCut].slice(0, 6))
  );

  // Esc goes back to the thread, the panel stays maximised
  // focus inside the details (their heading), as after reading or answering there
  await pane
    .locator('[data-threads-status] > div')
    .nth(1)
    .click({ position: { x: 300, y: 25 } });
  await page.keyboard.press('Escape');
  await wait(page, 500);
  const s3 = await state(page, i);
  check(
    `${name}: Esc back to the thread, still maximised`,
    !s3.details && s3.maximized,
    JSON.stringify({ details: s3.details })
  );

  await pane.locator(`[data-status-row="${PROJECT}/${task}"]`).click();
  await pane.locator('[data-threads-status]').waitFor({ timeout: 10000 });
  await escProbe(page, i, `${name} list click`);

  // "Show in Status" in the bound thread opens the same details as a click on its row
  await boundThread(page, i);
  await pane
    .locator('aside[aria-label="Threads"]')
    .getByRole('button', { name: 'Show in Status', exact: true })
    .click();
  await pane.locator('[data-threads-status]').waitFor({ timeout: 10000 });
  await wait(page, 1500);
  const s4 = await state(page, i);
  await shot(page, `${name}-3-show-in-status`);
  check(
    `${name}: "Show in Status" opens "${boundTitle}" details, still maximised`,
    s4.maximized && s4.details === `Status · ${boundTitle}` && s4.current === `${PROJECT}/${bound}`,
    JSON.stringify({ details: s4.details, current: s4.current })
  );
  await escProbe(page, i, `${name} thread "Show in Status"`);

  // the pane header's "Show in Status" while maximised: the whole status in the panel's main area
  await headerStatus(page, i).click();
  await pane.locator('[data-threads-status]').waitFor({ timeout: 10000 });
  await wait(page, 1500);
  const s6 = await state(page, i);
  await shot(page, `${name}-3b-header-show-in-status`);
  check(
    `${name}: pane header "Show in Status" shows the status in the panel, still maximised`,
    s6.maximized && s6.details === 'Status' && s6.detailsInside && s6.detailsCut.length === 0,
    JSON.stringify({ details: s6.details, cut: s6.detailsCut.slice(0, 4) })
  );
  await pane.getByRole('button', { name: 'Back to the thread (Esc)' }).click();
  await wait(page, 400);
  const s7 = await state(page, i);
  check(`${name}: Back from the header's status, still maximised`, !s7.details && s7.maximized);
  // the header toggle is the host's and stays on after Back: switch it off again
  await headerStatus(page, i).click();
  await wait(page, 400);
  // this mode's entry again for the answer
  await pane.locator(`[data-status-row="${PROJECT}/${task}"]`).click();
  await pane.locator('[data-threads-status]').waitFor({ timeout: 10000 });
  await wait(page, 1500);

  // one real answer: the entry's first option, as in the Status view
  const since = Date.now();
  const option = pane.locator('[data-threads-status] button[data-answer][data-option]').first();
  const label = ((await option.innerText()) || '').split('\n')[0].split(' · ')[0].trim();
  await option.click();
  let delivered = false;
  for (let k = 0; k < 30 && !delivered; k++) {
    await wait(page, 500);
    delivered = /delivered/.test((await state(page, i)).detailsText);
  }
  const s5 = await state(page, i);
  await shot(page, `${name}-4-answered`);
  check(
    `${name}: answer "${label}" delivered in the details, still maximised`,
    delivered && s5.maximized && s5.details === `Status · ${title}`
  );
  check(
    `${name}: nothing clipped (answered)`,
    s5.detailsInside && s5.clipped.length === 0 && s5.detailsCut.length === 0,
    JSON.stringify([...s5.clipped, ...s5.detailsCut].slice(0, 6))
  );
  return { since, label };
}

async function closeMax(page, i) {
  const pane = panes(page).nth(i);
  if ((await state(page, i)).details) {
    await pane.getByRole('button', { name: 'Back to the thread (Esc)' }).click();
    await wait(page, 300);
  }
  if ((await state(page, i)).maximized) {
    await pane.locator('aside[aria-label="Threads"] textarea').first().click();
    await page.keyboard.press('Escape');
    await wait(page, 400);
  }
}

// user turns that reached the orchestrator's Claude transcript since `since` (CWD: its workspace)
function reached(since) {
  const os = require('os');
  const path = require('path');
  const cwd = process.env.ORCH_CWD || '/Users/Shared/orkumo-hotfix/data/orchestrator';
  const file = path.join(
    os.homedir(),
    '.claude/projects',
    cwd.replace(/[^a-zA-Z0-9]/g, '-'),
    `${ORCH}.jsonl`
  );
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((r) => r && r.type === 'user' && Date.parse(r.timestamp) >= since)
    .map((r) =>
      typeof r.message?.content === 'string'
        ? r.message.content
        : (r.message?.content ?? []).map((c) => c.text ?? '').join('')
    );
}

(async () => {
  const browser = await pw.chromium.launch({
    executablePath: process.env.CHROME || undefined,
    headless: true,
  });
  const errors = [];
  const newPage = async (width) => {
    const ctx = await browser.newContext({ viewport: { width, height: 950 } });
    const page = await ctx.newPage();
    page.on(
      'console',
      (m) => m.type() === 'error' && errors.push(`${m.text()} ${m.location()?.url || ''}`.trim())
    );
    page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
    await page.goto(`${BASE}/agents`);
    await wait(page, 5000);
    return page;
  };
  const sent = [];

  // tab, wide: panel beside the chat
  let page = await newPage(1600);
  await openAgent(page, ORCH);
  sent.push(['tab', await modeChecks(page, 0, 'tab')]);
  await closeMax(page, 0);

  // split: the orchestrator beside another agent
  if (OTHER) {
    await openAgent(page, OTHER);
    await openAgent(page, ORCH);
    const split = page.locator('button[aria-label^="Split "][aria-label$=" right"]').first();
    await split
      .locator('xpath=ancestor::*[contains(concat(" ", @class, " "), " group ")][1]')
      .hover();
    await wait(page, 300);
    await split.click();
    await wait(page, 4000);
    check('split: two panes', (await panes(page).count()) === 2);
    const i = await orchPane(page);
    check('split: orchestrator pane found', i >= 0);
    sent.push(['split', await modeChecks(page, i, 'split')]);
    const other = (await state(page, 1 - i)).maximized;
    check('split: the other pane keeps its main chat', !other);
    await closeMax(page, i);
  } else check('split: OTHER session given', false);
  await page.context().close();

  // drawer: a narrow tab, the panel over a dimmed chat
  page = await newPage(1000);
  await openAgent(page, ORCH);
  await showPanel(page, 0);
  const d0 = await state(page, 0);
  check('drawer: narrow tab opens the panel as a drawer', d0.mode === 'overlay', d0.mode);
  // not maximised: the header's "Show in Status" covers the open drawer (it rendered under it)
  await headerStatus(page, 0).click();
  await wait(page, 2000);
  const top = await panes(page)
    .nth(0)
    .evaluate((pane) => {
      const title = [...pane.querySelectorAll('[data-part="title"]')].find(
        (e) => e.getBoundingClientRect().width > 0 && !e.closest('[data-threads-status]')
      );
      if (!title) return 'no status view';
      const b = title.getBoundingClientRect();
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return hit && title.contains(hit) ? 'status view on top' : `covered by ${hit?.tagName}`;
    });
  await shot(page, 'drawer-0-header-show-in-status');
  check(
    'drawer: header "Show in Status" covers the open drawer',
    top === 'status view on top',
    top
  );
  await headerStatus(page, 0).click();
  await wait(page, 600);
  await showPanel(page, 0);
  sent.push(['drawer', await modeChecks(page, 0, 'drawer')]);
  await page.context().close();
  await browser.close();

  // the server's answer message names the entry and the choice
  for (const [name, { since, label }] of sent)
    check(
      `${name}: answer "${label}" for ${TASKS[name][2]} reached the orchestrator`,
      reached(since).some(
        (t) =>
          t.startsWith('[Status answer]') &&
          t.includes(`(entry ${TASKS[name][2]}`) &&
          t.includes(`Choice: ${label}`)
      )
    );
  check('0 console errors', errors.length === 0, JSON.stringify(errors.slice(0, 5)));
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
