/* global document, localStorage */
// e2e for the threads panel: maximise (button, Mod+Shift+M, Esc), sidebar list, thread composer
// send key, height grip (at most 40 % of the pane) and `@` files, with a real mouse and keyboard in
// a tab and in splits (side by side, stacked). Narrow panes: the main chat keeps its minimum width
// beside the panel, else the panel is a drawer over it (dimmed, Esc / x / a click outside put it away).
// Needs a running Orkumo with two orchestrators whose chat UI view shows threads. Sends one short
// message per run into a thread of the first orchestrator (it reaches its PTY). `@` lists files
// only in a git work tree: the orchestrator directory must be one.
// Usage: NODE_PATH=<dir with playwright> node scripts/review/thread-max-e2e.cjs <baseUrl> <outDir> [width]
// (CHROME=<path> to use a given Chromium; SUBMIT=enter if the chat setting is "Enter sends";
// SPLIT=down for stacked panes; VIDEO=<dir> records the run)
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
const SPLIT = process.env.SPLIT === 'down' ? 'down' : 'right';
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const tag = `w${W}${ENTER_SENDS ? '-enter' : ''}${SPLIT === 'down' ? '-down' : ''}`;
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
      mode: pane.querySelector('[data-threads-mode]')?.getAttribute('data-threads-mode') ?? null,
      scrim: !!pane.querySelector('[data-threads-scrim]'),
      mainCol: Math.round(log?.parentElement?.getBoundingClientRect().width ?? 0),
      paneHeight: Math.round(pane.getBoundingClientRect().height),
      sectionHeight: Math.round(aside?.querySelector('section')?.clientHeight ?? 0),
      // pane title keeps a readable width; nothing sticks out of the pane or the panel
      nameWidth: Math.round(
        pane.querySelector(':scope > div:first-child > span.font-medium')?.getBoundingClientRect()
          .width ?? 0
      ),
      clipped: [...pane.querySelectorAll('button, span, textarea, [role=meter]')]
        .filter((e) => !e.closest('pre, code'))
        .filter((e) => {
          const b = e.getBoundingClientRect();
          if (!b.width || !b.height) return false;
          // what an overflow-hidden ancestor cuts with an ellipsis is truncation, not clipping
          let [left, right, top, bottom] = [b.left, b.right, b.top, b.bottom];
          for (let a = e.parentElement; a && a !== pane; a = a.parentElement) {
            const st = a.ownerDocument.defaultView.getComputedStyle(a);
            const r = a.getBoundingClientRect();
            if (st.overflowX !== 'visible')
              [left, right] = [Math.max(left, r.left), Math.min(right, r.right)];
            // a scrolling log may hold more than it shows; that is not clipping
            if (st.overflowY !== 'visible')
              [top, bottom] = [Math.max(top, r.top), Math.min(bottom, r.bottom)];
          }
          if (right <= left || bottom <= top) return false;
          const box = (aside && aside.contains(e) ? aside : pane).getBoundingClientRect();
          return (
            right > box.right + 1 ||
            left < box.left - 1 ||
            bottom > box.bottom + 1 ||
            top < box.top - 1
          );
        })
        .map((e) =>
          (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30)
        ),
      // header path / model either readable or not shown
      stubs: [...(pane.firstElementChild?.querySelectorAll('span.truncate') ?? [])]
        .filter((e) => !e.classList.contains('font-medium'))
        .filter((e) => {
          const w = e.getBoundingClientRect().width;
          return w > 0 && w < 100 && e.scrollWidth > e.clientWidth;
        })
        .map((e) => `${e.textContent.slice(0, 20)} ${Math.round(e.getBoundingClientRect().width)}px`),
      // answer footers on one line ("Done · 1.3 s", "Copy answer" do not wrap)
      wrapped: [...pane.querySelectorAll('button')]
        .filter((e) => /^\s*Copy answer\s*$/.test(e.textContent || ''))
        .filter((e) => e.getBoundingClientRect().height > 26).length,
      // thread input and its Attach row end inside the panel (nothing cut off at the bottom)
      threadInside:
        !thread ||
        !aside ||
        [
          thread,
          ...[...aside.querySelectorAll('section *')].filter(
            (e) => /^\s*Attach\s*$/.test(e.textContent || '') && !e.children.length
          ),
        ].every(
          (e) => e.getBoundingClientRect().bottom <= aside.getBoundingClientRect().bottom + 1
        ),
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

// The main input, also under a drawer: put the drawer away first (x in the panel header)
async function clickMain(page, i) {
  const pane = inPane(page, i);
  if ((await paneState(page, i)).mode === 'overlay')
    await pane.getByRole('button', { name: 'Hide threads panel' }).click();
  await pane.locator('textarea[aria-label="Message"]').click();
}
async function showPanel(page, i) {
  const pane = inPane(page, i);
  if (!(await paneState(page, i)).mode) {
    await pane.locator('button[aria-label="Threads"][aria-pressed="false"]').click();
    await page.waitForTimeout(300);
  }
  await ensureThread(page, i);
}

async function maximiseChecks(page, i, name) {
  const pane = inPane(page, i);
  await ensureThread(page, i);
  // a draft in the main input must survive the maximised panel
  const main = pane.locator('textarea[aria-label="Message"]');
  await clickMain(page, i);
  await page.keyboard.type('draft kept');
  await showPanel(page, i);
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
  // from the main input: it hides, focus falls to <body>; the keys still reach this pane
  await clickMain(page, i);
  await page.keyboard.press(`${MOD}+Shift+KeyM`);
  await page.waitForTimeout(400);
  const f1 = await paneState(page, i);
  await page.keyboard.press(`${MOD}+Shift+KeyM`);
  await page.waitForTimeout(400);
  const f2 = await paneState(page, i);
  check(
    `${name}: shortcut from the main input maximises, again restores`,
    f1.maximized && !f2.maximized && f2.mainVisible,
    JSON.stringify({ first: f1.maximized, second: f2.maximized })
  );
  await page.keyboard.press(`${MOD}+Shift+KeyM`);
  await page.waitForTimeout(300);
  // a click on text in the panel leaves focus on <body>
  const hb = await pane.locator('[data-testid="threads-header"]').boundingBox();
  await page.mouse.click(hb.x + 40, hb.y + hb.height / 2);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const f3 = await paneState(page, i);
  check(`${name}: Esc after a click on panel text restores`, !f3.maximized && f3.mainVisible);
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
  await clickMain(page, i);
  await main.fill('');
  await showPanel(page, i);
}

// Beside: the main chat keeps 460 px; too narrow for both: drawer over a dimmed chat
// the split divider between the two chat panes (other resizable groups on the page don't count)
const paneDivider = (page) =>
  page.evaluate(() => {
    const [a, b] = [...document.querySelectorAll('[data-chat-pane]')]
      .filter((p) => p.getBoundingClientRect().width > 0)
      .map((p) => p.getBoundingClientRect());
    if (!a || !b) return null;
    const hit = [...document.querySelectorAll('[data-separator]')]
      .map((e) => e.getBoundingClientRect())
      .find((r) =>
        r.width > r.height
          ? r.top >= a.bottom - 2 && r.bottom <= b.top + 2
          : r.left >= a.right - 2 && r.right <= b.left + 2
      );
    return hit ? { x: hit.x, y: hit.y, width: hit.width, height: hit.height } : null;
  });

function clipCheck(name, s) {
  check(
    `${name}: nothing clipped, title readable, footers on one line`,
    s.clipped.length === 0 && s.nameWidth >= 120 && s.wrapped === 0 && s.stubs.length === 0,
    JSON.stringify({ clipped: s.clipped, name: s.nameWidth, wrapped: s.wrapped, stubs: s.stubs })
  );
}

async function narrowChecks(page, i, name) {
  const pane = inPane(page, i);
  await showPanel(page, i);
  const s = await paneState(page, i);
  await shot(page, `${name}-narrow`);
  check(`${name}: thread input and buttons inside the panel`, s.threadInside);
  if (await pane.locator('[data-threads-short]').count()) {
    // short pane: the open thread fills the panel, "Back to the list" brings the list back
    const rowsOpen = await pane.locator('[data-thread-row]').count();
    await pane.getByRole('button', { name: 'Back to the list (thread stays open)' }).click();
    await page.waitForTimeout(300);
    const rowsBack = await pane.locator('[data-thread-row]').count();
    await shot(page, `${name}-short-list`);
    check(
      `${name}: short pane shows thread or list`,
      rowsOpen === 0 && rowsBack > 0,
      `${rowsOpen} -> ${rowsBack}`
    );
    await ensureThread(page, i);
  }
  clipCheck(name, s);
  if (s.mode === 'side') {
    check(`${name}: beside, main chat >= 460 px`, s.mainCol >= 460, JSON.stringify(s));
    // drag the handle far left: the panel stops where the main chat keeps its minimum
    const h = await pane
      .locator('[role=separator][aria-label="Resize threads panel"]')
      .boundingBox();
    await page.mouse.move(h.x + 4, h.y + h.height / 2, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(h.x - 900, h.y + h.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const s2 = await paneState(page, i);
    await shot(page, `${name}-narrow-widest`);
    check(
      `${name}: widest panel still leaves the main chat >= 460 px`,
      s2.mainCol >= 460 && s2.mode === 'side',
      `${s.aside}/${s.mainCol} -> ${s2.aside}/${s2.mainCol}`
    );
    clipCheck(`${name} widest`, s2);
    // and far right: the narrowest panel still shows its header and footers uncut
    const hn = await pane
      .locator('[role=separator][aria-label="Resize threads panel"]')
      .boundingBox();
    await page.mouse.move(hn.x + 4, hn.y + hn.height / 2, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(hn.x + 900, hn.y + hn.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const s3 = await paneState(page, i);
    await shot(page, `${name}-narrowest`);
    clipCheck(`${name} narrowest`, s3);
    // back to a default width for the next checks
    const h2 = await pane
      .locator('[role=separator][aria-label="Resize threads panel"]')
      .boundingBox();
    await page.mouse.dblclick(h2.x + 4, h2.y + h2.height / 2);
    await page.waitForTimeout(300);
    return;
  }
  check(
    `${name}: pane too narrow for both -> drawer, dimmed chat`,
    s.mode === 'overlay' && s.scrim,
    JSON.stringify(s)
  );
  // the drawer widens up to the pane
  const h = await pane.locator('[role=separator][aria-label="Resize threads panel"]').boundingBox();
  await page.mouse.move(h.x + 4, h.y + h.height / 2, { steps: 3 });
  await page.mouse.down();
  await page.mouse.move(h.x - 900, h.y + h.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const s2 = await paneState(page, i);
  await shot(page, `${name}-drawer-widest`);
  check(
    `${name}: drawer drags up to the pane width`,
    s2.aside >= s2.pane - 30 && s2.pane - s2.aside >= 20,
    `${s.aside} -> ${s2.aside} of ${s2.pane}`
  );
  clipCheck(`${name} drawer widest`, s2);
  // dragging the widest drawer's handle back narrows the drawer, the split stays
  const hb = await pane
    .locator('[role=separator][aria-label="Resize threads panel"]')
    .boundingBox();
  await page.mouse.move(hb.x + 4, hb.y + hb.height / 2, { steps: 3 });
  await page.mouse.down();
  await page.mouse.move(hb.x + 204, hb.y + hb.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const s4 = await paneState(page, i);
  check(
    `${name}: dragging the widest drawer back narrows it, the pane keeps its width`,
    Math.abs(s4.pane - s2.pane) <= 1 && s4.aside < s2.aside - 50,
    `pane ${s2.pane} -> ${s4.pane}, drawer ${s2.aside} -> ${s4.aside}`
  );
  const h2 = await pane
    .locator('[role=separator][aria-label="Resize threads panel"]')
    .boundingBox();
  await page.mouse.dblclick(h2.x + 4, h2.y + h2.height / 2);
  await page.waitForTimeout(300);
  // Esc in the drawer, a click on the dimmed chat, x: each puts it away
  await pane.locator('textarea[aria-label="Reply in thread"]').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check(`${name}: Esc in the drawer puts it away`, !(await paneState(page, i)).mode);
  await showPanel(page, i);
  const box = await pane.locator('[data-threads-scrim]').boundingBox();
  await page.mouse.click(box.x + 10, box.y + box.height / 2);
  await page.waitForTimeout(300);
  check(`${name}: a click on the dimmed chat puts it away`, !(await paneState(page, i)).mode);
  await showPanel(page, i);
  await pane.getByRole('button', { name: 'Hide threads panel' }).click();
  await page.waitForTimeout(300);
  check(`${name}: x in the panel header puts it away`, !(await paneState(page, i)).mode);
  await showPanel(page, i);
}

// 20 typed lines and the main grip dragged to the top: inputs stop at 40 %, nothing leaves the pane
async function tallInputChecks(page, i, name) {
  const pane = inPane(page, i);
  for (const label of ['Reply in thread', 'Message']) {
    const field = pane.locator(`textarea[aria-label="${label}"]`);
    if (!(await field.count())) continue;
    // focus, not click: in a drawer a click on the main input lands on the backdrop
    await field.focus();
    for (let k = 0; k < 20; k++) {
      await page.keyboard.type(`line ${k}`);
      await page.keyboard.press('Shift+Enter');
    }
    await page.waitForTimeout(300);
    const s = await paneState(page, i);
    await shot(page, `${name}-typed-${label === 'Message' ? 'main' : 'thread'}`);
    const h = Math.round((await field.boundingBox()).height);
    check(
      `${name}: 20 typed lines in "${label}" stay within 40 % of the pane`,
      h <= Math.ceil(s.paneHeight * 0.4) + 1,
      `${h} of ${s.paneHeight}`
    );
    clipCheck(`${name} typed ${label}`, s);
    const log = Math.round((await pane.locator('[role="log"]').first().boundingBox()).height);
    check(`${name} typed ${label}: chat log keeps >= 90 px`, log >= 90, `${log}`);
    check(`${name} typed ${label}: thread input and buttons inside the panel`, s.threadInside);
    await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+a`);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);
  }
  // the main input's grip dragged to the top; a drawer covers it, so put the drawer away first
  const drawer = (await paneState(page, i)).mode === 'overlay';
  if (drawer) await pane.getByRole('button', { name: 'Hide threads panel' }).click();
  const g = await pane
    .locator('[role=separator][aria-label^="Resize input"]')
    .filter({ hasNot: page.locator('xpath=ancestor::aside') })
    .first()
    .boundingBox();
  if (g) {
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2, 2, { steps: 15 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const s = await paneState(page, i);
    await shot(page, `${name}-main-dragged`);
    check(
      `${name}: dragged main input at most 40 % of the pane`,
      s.mainHeight <= Math.ceil(s.paneHeight * 0.4) + 1,
      `${s.mainHeight} of ${s.paneHeight}`
    );
    clipCheck(`${name} main dragged`, s);
    const log = Math.round((await pane.locator('[role="log"]').first().boundingBox()).height);
    check(`${name} main dragged: chat log keeps >= 90 px`, log >= 90, `${log}`);
    const g2 = await pane
      .locator('[role=separator][aria-label^="Resize input"]')
      .filter({ hasNot: page.locator('xpath=ancestor::aside') })
      .first()
      .boundingBox();
    await page.mouse.dblclick(g2.x + g2.width / 2, g2.y + g2.height / 2);
    await page.waitForTimeout(200);
  }
  if (drawer) await showPanel(page, i);
}

// The dragged thread input stops at 40 % of the pane height
async function heightCapCheck(page, i, name) {
  const pane = inPane(page, i);
  const g = await pane.locator('aside [role=separator][aria-label^="Resize input"]').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2, { steps: 3 });
  await page.mouse.down();
  for (let k = 1; k <= 20; k++) {
    await page.mouse.move(g.x + g.width / 2, Math.max(2, g.y - 40 * k));
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  const s = await paneState(page, i);
  await shot(page, `${name}-input-tallest`);
  check(
    `${name}: thread input at most 40 % of the pane height`,
    s.threadHeight <= Math.ceil(s.paneHeight * 0.4) + 1 && s.threadHeight > 60,
    `${s.threadHeight} of ${s.paneHeight}`
  );
  check(
    `${name}: thread input reaches ~40 % of the pane where the thread view has room`,
    s.threadHeight >= Math.min(s.paneHeight * 0.4, s.sectionHeight - 180) - 10,
    `${s.threadHeight} of ${s.paneHeight}, section ${s.sectionHeight}`
  );
  check(`${name}: tallest thread input still inside the panel`, s.threadInside);
  // back to auto height
  const g2 = await pane.locator('aside [role=separator][aria-label^="Resize input"]').boundingBox();
  await page.mouse.dblclick(g2.x + g2.width / 2, g2.y + g2.height / 2);
  await page.waitForTimeout(200);
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

  await narrowChecks(page, 0, 'tab');
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

  const split = page.locator(`button[aria-label^="Split "][aria-label$=" ${SPLIT}"]`).first();
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
    for (const i of [0, 1]) await narrowChecks(page, i, `split-${i}`);
    // panel hidden: the bare pane is uncut too
    for (const i of [0, 1]) {
      await inPane(page, i).getByRole('button', { name: 'Hide threads panel' }).click();
      await page.waitForTimeout(300);
      clipCheck(`split-${i} no panel`, await paneState(page, i));
    }
    await shot(page, 'split-no-panel');
    // the split divider stops before a pane gets too small to show header and composer
    const div = await paneDivider(page);
    if (div) {
      const vertical = SPLIT === 'down';
      const [cx, cy] = [div.x + div.width / 2, div.y + div.height / 2];
      await page.mouse.move(cx, cy, { steps: 3 });
      await page.mouse.down();
      await page.mouse.move(vertical ? cx : cx + 2000, vertical ? cy + 2000 : cy, { steps: 15 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      const p1 = await paneState(page, 1);
      await shot(page, 'split-divider-extreme');
      check(
        'split divider: the squeezed pane keeps its minimum',
        vertical ? p1.paneHeight >= 356 : p1.pane >= 416,
        JSON.stringify({ w: p1.pane, h: p1.paneHeight })
      );
      clipCheck('split-1 squeezed', p1);
      await page.mouse.dblclick(cx, cy);
      await page.waitForTimeout(300);
      const after = await paneDivider(page);
      if (after && Math.abs(after.x - div.x) + Math.abs(after.y - div.y) > 4) {
        await page.mouse.move(after.x + after.width / 2, after.y + after.height / 2, { steps: 3 });
        await page.mouse.down();
        await page.mouse.move(cx, cy, { steps: 15 });
        await page.mouse.up();
        await page.waitForTimeout(300);
      }
    } else check('split divider found', false);
    for (const i of [0, 1]) await showPanel(page, i);
    for (const i of [0, 1]) await maximiseChecks(page, i, `split-${i}`);
    await heightCapCheck(page, 0, 'split-0');
    for (const i of [0, 1]) await tallInputChecks(page, i, `split-${i}`);
  } else check('split button', false);
  await heightCapCheck(page, 0, 'tab');
  await tallInputChecks(page, 0, 'tab');

  console.log('console errors', JSON.stringify(errors));
  await ctx.close();
  await browser.close();
  console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
