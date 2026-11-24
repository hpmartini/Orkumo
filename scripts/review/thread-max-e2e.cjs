/* global document, localStorage */
// e2e for the threads panel: maximise (button, Mod+Shift+M, Esc), sidebar list, thread composer
// send key, height grip and `@` files, with a real mouse and keyboard in a tab and in a split.
// Needs a running Orkumo with two orchestrators whose chat UI view shows threads. Sends one short
// message per run into a thread of the first orchestrator (it reaches its PTY). `@` lists files
// only in a git work tree: the orchestrator directory must be one.
// Usage: NODE_PATH=<dir with playwright> node scripts/review/thread-max-e2e.cjs <baseUrl> <outDir> [width]
// (CHROME=<path> to use a given Chromium; SUBMIT=enter if the chat setting is "Enter sends";
// VIDEO=<dir> records the run)
const pw = (() => {
  try {
    return require('playwright');
  } catch {
    return require('playwright-core');
  }
})();
const { chromium } = pw;
const fs = require('fs');
const [BASE, OUT, width] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const exe = process.env.CHROME || undefined;
const W = Number(width || 1440);
const ENTER_SENDS = process.env.SUBMIT === 'enter';
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const tag = `w${W}${ENTER_SENDS ? '-enter' : ''}`;
let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const shot = (page, name) => page.screenshot({ path: `${OUT}/${tag}-${name}.png` });

async function openAgent(page, n) {
  const cards = page.locator('[role="option"][data-session-id]');
  if ((await cards.count()) < 2) {
    await page.locator('[role="option"]', { hasText: 'Orchestrators' }).first().click();
    await page.waitForTimeout(800);
  }
  await cards.nth(n).dblclick();
  await page.waitForTimeout(3500);
}

// state of chat pane i: main chat visible, panel width, pane width, maximised, layout
const paneState = (page, i) =>
  page.evaluate((i) => {
    const pane = [...document.querySelectorAll('[data-chat-pane]')].filter(
      (p) => p.getBoundingClientRect().width > 0
    )[i];
    if (!pane) return null;
    const log = pane.querySelector('[role=log]');
    const aside = pane.querySelector('aside[aria-label="Threads"]');
    const panel = pane.querySelector('[data-threads-panel]');
    const main = pane.querySelector('textarea[aria-label="Message"]');
    const thread = pane.querySelector('textarea[aria-label="Reply in thread"]');
    return {
      pane: Math.round(pane.getBoundingClientRect().width),
      mainVisible: !!log && log.getBoundingClientRect().width > 0,
      aside: aside ? Math.round(aside.getBoundingClientRect().width) : 0,
      maximized: panel?.getAttribute('data-threads-maximized') === 'true',
      layout: pane.querySelector('[data-threads-layout]')?.getAttribute('data-threads-layout'),
      mainDraft: main ? main.value : null,
      threadValue: thread ? thread.value : null,
      threadHeight: thread ? Math.round(thread.getBoundingClientRect().height) : 0,
      mainHeight: main ? Math.round(main.getBoundingClientRect().height) : 0,
      focusInThread: !!thread && document.activeElement === thread,
      handle: !!pane.querySelector('[role=separator][aria-label="Resize threads panel"]'),
    };
  }, i);

const inPane = (page, i) => page.locator('[data-chat-pane]:visible').nth(i);

async function ensureThread(page, i) {
  const pane = inPane(page, i);
  if (await pane.locator('textarea[aria-label="Reply in thread"]').count()) return;
  const rows = pane.locator('[data-thread-row]');
  if (await rows.count()) {
    await rows.first().click();
  } else {
    await pane.getByRole('button', { name: 'New thread' }).click();
    await pane.getByRole('menuitem', { name: /Thread without a task/ }).click();
  }
  await page.waitForTimeout(600);
}

async function maximiseChecks(page, i, name) {
  const pane = inPane(page, i);
  await ensureThread(page, i);
  // a draft in the main input must survive the maximised panel
  const main = pane.locator('textarea[aria-label="Message"]');
  await main.click();
  await page.keyboard.type('draft kept');
  const s0 = await paneState(page, i);
  await pane.getByRole('button', { name: 'Maximize threads' }).click();
  await page.waitForTimeout(400);
  const s1 = await paneState(page, i);
  await shot(page, `${name}-maximized`);
  check(
    `${name}: button maximises (main chat hidden, panel = pane, no width handle)`,
    s1.maximized && !s1.mainVisible && s1.aside >= s1.pane - 4 && !s1.handle,
    JSON.stringify({ pane: s1.pane, aside: s1.aside, main: s1.mainVisible })
  );
  check(`${name}: focus moves into the thread input`, s1.focusInThread);
  const header = pane.locator('[data-testid="threads-header"]');
  check(
    `${name}: thread count in the header`,
    /Threads\s*\d/.test((await header.textContent()) || '')
  );
  // sidebar on, then off again
  const side = pane.getByRole('button', { name: 'Thread list on the left' });
  await side.click();
  await page.waitForTimeout(300);
  const s2 = await paneState(page, i);
  await shot(page, `${name}-sidebar`);
  check(`${name}: sidebar layout`, s2.layout === 'sidebar', s2.layout);
  // Esc in the thread input restores; draft and width come back
  await pane.locator('textarea[aria-label="Reply in thread"]').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const s3 = await paneState(page, i);
  check(
    `${name}: Esc restores (main chat, same width, draft kept)`,
    !s3.maximized &&
      s3.mainVisible &&
      Math.abs(s3.aside - s0.aside) <= 2 &&
      s3.mainDraft === 'draft kept',
    JSON.stringify({ before: s0.aside, after: s3.aside, draft: s3.mainDraft })
  );
  // shortcut twice, from the thread input
  await pane.locator('textarea[aria-label="Reply in thread"]').click();
  await page.keyboard.press(`${MOD}+Shift+KeyM`);
  await page.waitForTimeout(400);
  const s4 = await paneState(page, i);
  check(`${name}: ${MOD}+Shift+M maximises`, s4.maximized && !s4.mainVisible);
  check(`${name}: sidebar remembered`, s4.layout === 'sidebar', s4.layout);
  // `@` opens the file picker; Esc closes only the picker
  await page.keyboard.type('@');
  const list = pane.locator('[role=listbox]');
  await list.waitFor({ timeout: 4000 }).catch(() => {});
  const options = await list.locator('[role=option]').count();
  await shot(page, `${name}-at-files`);
  check(`${name}: @ lists files`, options > 0, `${options} options`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const s5 = await paneState(page, i);
  check(
    `${name}: Esc on the picker keeps the panel maximised`,
    s5.maximized && (await list.count()) === 0
  );
  await page.keyboard.press('Backspace');
  // sidebar off for the next pane, then restore with the shortcut
  await side.click();
  await page.keyboard.press(`${MOD}+Shift+KeyM`);
  await page.waitForTimeout(400);
  const s6 = await paneState(page, i);
  check(`${name}: ${MOD}+Shift+M restores`, !s6.maximized && s6.mainVisible);
  await main.fill('');
}

async function composerChecks(page, i, name) {
  const pane = inPane(page, i);
  await ensureThread(page, i);
  const box = pane.locator('textarea[aria-label="Reply in thread"]');
  const users = () => pane.locator('aside article, aside [data-user-message]').count();
  // height grip: drag up 80 px
  const grip = pane.locator('aside [role=separator][aria-label^="Resize input"]');
  const s0 = await paneState(page, i);
  const g = await grip.boundingBox();
  check(`${name}: thread input has a height grip`, !!g);
  if (g) {
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2, { steps: 4 });
    await page.mouse.down();
    for (let k = 1; k <= 10; k++) {
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 - 8 * k);
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    const s1 = await paneState(page, i);
    await shot(page, `${name}-taller`);
    check(
      `${name}: drag up 80 px makes the thread input taller`,
      s1.threadHeight >= s0.threadHeight + 70,
      `${s0.threadHeight} -> ${s1.threadHeight}`
    );
    check(`${name}: main input height untouched`, s1.mainHeight === s0.mainHeight);
  }
  // send key
  await box.click();
  const before = await users();
  await page.keyboard.type('Which colour is snow?');
  await page.keyboard.press(ENTER_SENDS ? 'Shift+Enter' : 'Enter');
  await page.waitForTimeout(300);
  const v = (await paneState(page, i)).threadValue;
  check(
    `${name}: ${ENTER_SENDS ? 'Shift+Enter' : 'Enter'} adds a line, sends nothing`,
    v === 'Which colour is snow?\n',
    JSON.stringify(v)
  );
  await page.keyboard.type('One word.');
  await page.keyboard.press(ENTER_SENDS ? 'Enter' : `${MOD}+Enter`);
  await page.waitForTimeout(2500);
  const after = await paneState(page, i);
  await shot(page, `${name}-sent`);
  check(
    `${name}: ${ENTER_SENDS ? 'Enter' : `${MOD}+Enter`} sends (input empty)`,
    after.threadValue === '',
    JSON.stringify(after.threadValue)
  );
  console.log(`  items in panel ${before} -> ${await users()}`);
  return s0.threadHeight;
}

(async () => {
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const ctx = await browser.newContext({
    viewport: { width: W, height: 900 },
    // VIDEO=<dir>: record the run (proof GIF)
    recordVideo: process.env.VIDEO
      ? { dir: process.env.VIDEO, size: { width: W, height: 900 } }
      : undefined,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${BASE}/agents`);
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    localStorage.removeItem('devOrbitChatThreadComposerHeight');
    localStorage.removeItem('agents-ui:threads-sidebar');
  });
  await openAgent(page, 1);
  await openAgent(page, 0);
  await shot(page, 'tab');

  await composerChecks(page, 0, 'tab');
  const height = (await paneState(page, 0)).threadHeight;
  await maximiseChecks(page, 0, 'tab');

  // the dragged height survives a reload
  await page.reload();
  await page.waitForTimeout(5000);
  await openAgent(page, 1); // the split needs two tabs
  await openAgent(page, 0);
  await ensureThread(page, 0);
  const h2 = (await paneState(page, 0)).threadHeight;
  check('reload: thread input height remembered', Math.abs(h2 - height) <= 2, `${height} -> ${h2}`);

  const split = page.locator('button[aria-label^="Split "][aria-label$=" right"]').first();
  if (await split.count()) {
    await split
      .locator('xpath=ancestor::*[contains(concat(" ", @class, " "), " group ")][1]')
      .hover();
    await page.waitForTimeout(300);
    await split.click();
    await page.waitForTimeout(4000);
    await shot(page, 'split');
    // maximise the right pane only: the left one keeps its main chat
    await ensureThread(page, 1);
    await inPane(page, 1).getByRole('button', { name: 'Maximize threads' }).click();
    await page.waitForTimeout(400);
    const [l, r] = [await paneState(page, 0), await paneState(page, 1)];
    await shot(page, 'split-right-maximized');
    check(
      'split: only the maximised pane hides its main chat',
      r.maximized && !r.mainVisible && l.mainVisible && !l.maximized,
      JSON.stringify({ left: l.mainVisible, right: r.mainVisible })
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    for (const i of [0, 1]) await maximiseChecks(page, i, `split-${i}`);
  } else check('split button', false);

  console.log('console errors', JSON.stringify(errors));
  await ctx.close();
  await browser.close();
  console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
