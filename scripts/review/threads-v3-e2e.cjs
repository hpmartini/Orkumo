/* global document, navigator, ClipboardItem, DataTransfer, File, DragEvent, atob, getComputedStyle */
// e2e for threads v3 (contract-threads2 AC-1 … AC-10) with a real mouse and keyboard, the real
// clipboard (Meta/Ctrl+V) and the real `orkumo` CLI on an isolated Orkumo:
//  ac7  backfill: two senders without a thread message the orchestrator (`orkumo send`), the next
//       load makes one thread each (opened before the first message), a second load changes nothing
//  ac5  `orkumo start` from the orchestrator: a thread named after the project/agent, linked to it;
//       the agent's `orkumo send` and the orchestrator's answer land in it, not in the main chat
//  ac6  `orkumo thread open "<title>"`: the row shows in the panel within 3 s, no reload
//  ac9  injected legacy "Answer HH:MM" threads are renamed on load (a user-renamed one stays);
//       no title starts with "Answer " or holds Markdown; no "Not bound to a status task"
//  ac4  maximised: list on the left by default; switched off it stays off after a reload
//  ac1  rename: double-click on row and header, "…" → Rename on both; Enter, Esc, blur; reload;
//       same id and tag; the thread keeps its messages and a new reply still lands in it
//  ac3  attachments (Attach button, Meta+V paste, drop) only in the composer they were added in
//  ac2  footer spans the pane, the panel ends above it, nothing in the footer clipped (side,
//       maximised, drawer where the layout gives one)
//  ac10 tidy-up by CLI (merge per project, move main entries): one thread per project, entry
//       count unchanged (UI and CLI), the UI regroups without a reload; panel "Undo tidy-up" plus
//       `orkumo thread undo` restore every entry's thread exactly
//  ac11 scroll: real wheel up in the thread and in the main log while the orchestrator streams a
//       real answer (text between tool calls); the first visible row sampled every 250 ms for
//       ≥ 10 s stays within 2 px, "New messages" shows, a click goes back and follows again
// Usage: NODE_PATH=<dir with playwright> node scripts/review/threads-v3-e2e.cjs <baseUrl> <outDir> [width]
// env: ORCH=<orchestrator session id, omp-…> (required), ORCH2=<second orchestrator> (splits),
//      SPLIT=tab|right|down (default tab), ONLY=ac7,ac5,… (default all), CHROME=<chromium>,
//      ORKUMO=<orkumo CLI>, API=<api url>, DATA=<data dir>, PROJECT=<project dir for ac5>,
//      SUBMIT=enter if the chat setting is "Enter sends"
// ac5 starts one real agent (omp, short prompt) and stops it at the end.
const pw = (() => {
  try {
    return require('playwright');
  } catch {
    return require('playwright-core');
  }
})();
const { chromium } = pw;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const [BASE, OUT, width] = process.argv.slice(2);
const W = Number(width || 1440);
const ORCH = process.env.ORCH;
const ORCH2 = process.env.ORCH2;
const SPLIT = ['right', 'down'].includes(process.env.SPLIT) ? process.env.SPLIT : 'tab';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const on = (s) => !ONLY.length || ONLY.includes(s);
const ORKUMO = process.env.ORKUMO || '/Users/Shared/orkumo-demo/data/orchestrator-bin/orkumo';
const API = process.env.API || 'http://127.0.0.1:3591/api';
const DATA = process.env.DATA || '/Users/Shared/orkumo-demo/data';
const PROJECT = process.env.PROJECT || '/Users/Shared/orkumo-demo/beispiel-shop';
const ENTER_SENDS = process.env.SUBMIT === 'enter';
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const RUN = Date.now().toString(36).slice(-4);
const tag = `w${W}-${SPLIT}`;
if (!BASE || !OUT || !ORCH) {
  console.error('usage: ORCH=omp-… node threads-v3-e2e.cjs <baseUrl> <outDir> [width]');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 10000, step = 250) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await sleep(step);
  }
}

// ---- the real CLI and API --------------------------------------------------------------------
const cliEnv = (sender) => {
  const env = { ...process.env, ORKUMO_API_URL: API, ORKUMO_AGENT_ID: sender };
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'PI_SESSION_ID']) delete env[k];
  return env;
};
/** `orkumo …` as `sender`; { code, out } (stderr folded in) */
function cli(sender, ...args) {
  try {
    const out = execFileSync(ORKUMO, args, { env: cliEnv(sender), encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out: out.trim() };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() };
  }
}
const api = async (p) => (await fetch(`${API}${p}`)).json();
const entriesOf = () => api(`/orchestrator/threads/entries?session=${encodeURIComponent(ORCH)}`);
const loadThreads = () => api(`/orchestrator/threads?session=${encodeURIComponent(ORCH)}`);
const title = (t) => [t.name?.project, t.name?.task].filter(Boolean).join(' · ');
const threadFile = (owner) => path.join(DATA, 'orchestrator-reports', 'threads', `${owner}.json`);
const sha = (file) =>
  fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : '-';

/** The orchestrator's answer after `since` (ms): waits for its turn to end */
async function waitAnswer(since, ms = 240000) {
  return waitFor(
    async () => {
      const { entries } = await entriesOf();
      const a = entries.filter((e) => e.kind === 'answer' && e.ts > since);
      const s = await api('/agents');
      const me = s.sessions.find((x) => x.id === ORCH);
      return a.length && me && me.displayState !== 'working' ? a : null;
    },
    ms,
    2000
  );
}

// ---- page helpers --------------------------------------------------------------------------
const shot = (page, name) => page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
let paneSel = '[data-chat-pane]';
const paneOf = (page) => page.locator(paneSel).first();

async function openAgent(page, id) {
  const card = page.locator(`[role="option"][data-session-id="${id}"]`);
  if (!(await card.count())) {
    await page.locator('[role="option"]', { hasText: 'Orchestrators' }).first().click();
    await page.waitForTimeout(800);
  }
  await card.dblclick();
  await page.waitForTimeout(3500);
}

/** Opens the app with the orchestrator in a tab, or split beside/below the second one */
async function openLayout(page) {
  await page.goto(`${BASE}/agents`);
  await page.waitForTimeout(5000);
  const { sessions } = await api('/agents');
  const paneId = sessions.find((s) => s.id === ORCH)?.paneId;
  paneSel = paneId ? `[data-chat-pane][data-agent-pane="${paneId}"]` : '[data-chat-pane]:visible';
  if (SPLIT !== 'tab' && ORCH2) await openAgent(page, ORCH2);
  await openAgent(page, ORCH);
  if (SPLIT !== 'tab') {
    const split = page.locator(`button[aria-label^="Split "][aria-label$=" ${SPLIT}"]`).first();
    await split
      .locator('xpath=ancestor::*[contains(concat(" ", @class, " "), " group ")][1]')
      .hover();
    await page.waitForTimeout(300);
    await split.click();
    await page.waitForTimeout(4000);
  }
  await paneOf(page).waitFor({ timeout: 15000 });
  await showPanel(page);
}

async function showPanel(page) {
  const pane = paneOf(page);
  if (!(await pane.locator('[data-threads-mode]').count())) {
    await pane.locator('button[aria-label="Threads"][aria-pressed="false"]').click();
    await page.waitForTimeout(400);
  }
}
const panelMode = (page) =>
  paneOf(page)
    .locator('[data-threads-mode]')
    .getAttribute('data-threads-mode')
    .catch(() => null);
async function setMax(page, want) {
  const pane = paneOf(page);
  const is = (await panelMode(page)) === 'full';
  if (is !== want) {
    await pane.getByRole('button', { name: want ? 'Maximize threads' : 'Restore threads' }).click();
    await page.waitForTimeout(500);
  }
}
const row = (page, id) => paneOf(page).locator(`[data-thread-row="${id}"]`);
async function openThread(page, id) {
  const r = row(page, id);
  // a short pane shows the open thread instead of the list
  if (!(await r.count())) {
    const back = paneOf(page).getByRole('button', { name: 'Back to the list (thread stays open)' });
    if ((await back.count()) && (await back.isVisible())) await back.click();
    await page.waitForTimeout(300);
  }
  if ((await r.getAttribute('aria-current')) !== 'true') {
    await r.click();
    await page.waitForTimeout(500);
  }
}
/** Texts of the chat items in the main log or in the open thread */
const logTexts = (page, where) =>
  paneOf(page).evaluate((pane, where) => {
    const aside = pane.querySelector('aside[aria-label="Threads"]');
    const log =
      where === 'thread'
        ? aside?.querySelector('section [class*="overflow-y-auto"]')
        : [...pane.querySelectorAll('[role=log]')].find((l) => !aside?.contains(l));
    if (!log) return [];
    return [...log.querySelectorAll('article, [data-agent-message], div.items-end.my-3')]
      .filter((e) => !e.closest('[data-thread-parent]'))
      .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim());
  }, where);
const rowTitles = (page) =>
  paneOf(page)
    .locator('[data-thread-row] span.truncate')
    .evaluateAll((els) => els.filter((e) => !e.closest('.mt-0\\.5')).map((e) => e.textContent));

// ---- AC-7 backfill (before any page polls this orchestrator) ------------------------------
async function ac7() {
  const file = threadFile(ORCH);
  const before = (await entriesOf()).threads;
  const beforeIds = new Set(before.map((t) => t.id));
  const beforeJson = JSON.stringify(
    JSON.parse(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{"threads":[]}').threads
  );
  // two senders no thread links: finished demo sessions in this data dir (never messaged)
  const { sessions } = await api('/agents?all=1');
  const linked = new Set(before.flatMap((t) => t.agents ?? []));
  const senders = sessions
    .filter((s) => s.id !== ORCH && s.id !== ORCH2 && !linked.has(s.id))
    .filter((s) => s.displayState === 'completed' && (s.cwd || '').startsWith(path.dirname(DATA)))
    .slice(0, 2)
    .map((s) => s.id);
  check('ac7: two unlinked senders available', senders.length === 2, senders.join(' '));
  const t0 = Date.now();
  for (const [i, s] of senders.entries()) {
    const since = Date.now();
    const r = cli(s, 'send', ORCH, `Backfill probe ${RUN}-${i}: build ${i + 1} is green. Reply exactly: noted ${i + 1}`);
    check(`ac7: orkumo send from ${s}`, r.code === 0, r.out);
    await waitAnswer(since);
  }
  // first load: one thread per sender, opened at or before its first message
  const first = await loadThreads();
  const fileAfter1 = sha(file);
  const made = first.threads.filter((t) => !beforeIds.has(t.id));
  const { entries } = await entriesOf();
  for (const s of senders) {
    const mine = made.filter((t) => (t.agents ?? []).includes(s));
    const firstMsg = entries.find((e) => e.kind === 'user' && e.text.includes(`[from agent ${s}`));
    check(
      `ac7: one thread for ${s} (${mine.map(title).join(', ')})`,
      mine.length === 1 && (!firstMsg || mine[0].createdAt <= firstMsg.ts),
      JSON.stringify({ created: mine[0]?.createdAt, first: firstMsg?.ts })
    );
    const routed = entries.filter((e) => e.thread === mine[0]?.id).map((e) => e.kind);
    check(`ac7: sender message and answer in its thread`, routed.includes('user') && routed.includes('answer'), routed.join(','));
  }
  // existing threads untouched, second load writes nothing
  const kept = JSON.parse(fs.readFileSync(file, 'utf8')).threads.filter((t) => beforeIds.has(t.id));
  const was = JSON.parse(beforeJson).filter((t) => beforeIds.has(t.id));
  check('ac7: threads that existed stay byte-identical', JSON.stringify(kept) === JSON.stringify(was));
  await loadThreads();
  check('ac7: second load creates nothing, file unchanged', sha(file) === fileAfter1);
  console.log(`  ac7 took ${Math.round((Date.now() - t0) / 1000)} s`);
  return { senders, made };
}

// ---- AC-5 agent start from the orchestrator -------------------------------------------------
let worker = null;
async function ac5(page) {
  const before = new Set((await entriesOf()).threads.map((t) => t.id));
  const r = cli(ORCH, 'start', '--project', PROJECT, '--harness', 'omp', 'Reply exactly: ready. Do not run any tools.');
  check('ac5: orkumo start from the orchestrator', r.code === 0, r.out);
  worker = r.out.match(/Started (omp-[\w-]+)/)?.[1] ?? null;
  const thread = await waitFor(async () => {
    const { threads } = await entriesOf();
    return threads.find((t) => !before.has(t.id) && (t.agents ?? []).includes(worker));
  }, 15000);
  const projectName = path.basename(PROJECT);
  check(
    `ac5: thread linked to the agent, named after project/agent ("${thread ? title(thread) : '-'}")`,
    !!thread && thread.name.project === projectName && !!thread.name.task && !/^Thread$/.test(thread.name.task),
    JSON.stringify(thread?.name)
  );
  if (!thread) return null;
  await waitFor(() => row(page, thread.id).count(), 8000);
  check('ac5: row visible in the panel without reload', (await row(page, thread.id).count()) === 1);
  // let the agent finish its first turn, then it reports
  await waitFor(async () => {
    const { sessions } = await api('/agents');
    return sessions.find((s) => s.id === worker && s.displayState !== 'working');
  }, 120000, 2000);
  const since = Date.now();
  const s = cli(worker, 'send', ORCH, `Checkout tests ${RUN} are green. Reply exactly: thanks, noted`);
  check('ac5: orkumo send from the agent', s.code === 0, s.out);
  await waitAnswer(since);
  const { entries } = await entriesOf();
  const msg = entries.find((e) => e.kind === 'user' && e.text.includes(`Checkout tests ${RUN}`));
  const answer = entries.find((e) => e.kind === 'answer' && e.ts > (msg?.ts ?? since));
  check(
    'ac5: agent message and the answer routed into its thread',
    msg?.thread === thread.id && answer?.thread === thread.id,
    JSON.stringify({ msg: msg?.thread, answer: answer?.thread, want: thread.id })
  );
  await page.waitForTimeout(4000);
  await openThread(page, thread.id);
  await page.waitForTimeout(800);
  const inThread = await logTexts(page, 'thread');
  const inMain = await logTexts(page, 'main');
  await shot(page, 'ac5-agent-thread');
  check(
    'ac5: UI shows the message and answer in the thread, not in the main chat',
    inThread.some((x) => x.includes(`Checkout tests ${RUN}`)) &&
      inThread.some((x) => /thanks, noted/i.test(x)) &&
      !inMain.some((x) => x.includes(`Checkout tests ${RUN}`)),
    JSON.stringify({ thread: inThread.length, main: inMain.length })
  );
  return thread;
}

// ---- AC-6 `orkumo thread open` ---------------------------------------------------------------
async function ac6(page) {
  const times = [];
  const ids = [];
  for (const topic of [`beispiel-shop · Payments ${RUN}`, `beispiel-shop · Search ${RUN}`, `Docs · Onboarding ${RUN}`]) {
    const t0 = Date.now();
    const r = cli(ORCH, 'thread', 'open', topic);
    const id = r.out.match(/\(id ([\w-]+)\)/)?.[1];
    const seen = await waitFor(() => (id ? row(page, id).count() : 0), 6000, 100);
    times.push(Date.now() - t0);
    ids.push(id);
    check(`ac6: "${topic}" opened by CLI shows in the panel`, r.code === 0 && !!seen, r.out.split('\n')[0]);
  }
  check('ac6: each row within 3 s, no reload', Math.max(...times) <= 3000, `${times.join(', ')} ms`);
  await shot(page, 'ac6-opened');
  return ids;
}

// ---- AC-9 names ------------------------------------------------------------------------------
async function ac9(page) {
  const file = threadFile(ORCH);
  // an answer that names a known project, as the parent of a legacy thread
  const since = Date.now();
  const main = paneOf(page).locator('textarea[aria-label="Message"]');
  if ((await panelMode(page)) === 'overlay')
    await paneOf(page).getByRole('button', { name: 'Hide threads panel' }).click();
  await main.click();
  await page.keyboard.type(`Status ${RUN}? Reply exactly: beispiel-shop checkout is green.`);
  await page.keyboard.press(ENTER_SENDS ? 'Enter' : `${MOD}+Enter`);
  await waitAnswer(since);
  const { entries } = await entriesOf();
  const answer = entries.filter((e) => e.kind === 'answer' && e.ts > since).pop();
  // inject legacy client-named threads (the old UI wrote "Answer HH:MM"), one renamed by the user
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const legacy = (id, name, extra = {}) => ({
    id,
    tag: `[thread: ${name.project} · ${name.task}]`,
    name,
    binding: null,
    parentKey: answer?.key ?? null,
    agents: [],
    createdAt: since,
    readAt: since,
    closed: false,
    ...extra,
  });
  const L1 = crypto.randomUUID();
  const L2 = crypto.randomUUID();
  doc.threads.push(
    legacy(L1, { project: 'Answer 18:39', task: '**Stand** - Briefing' }),
    legacy(L2, { project: 'Kept by hand', task: `Mine ${RUN}` }, { renamed: true, autoName: true })
  );
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(doc, null, 2));
  fs.renameSync(`${file}.tmp`, file);
  const { threads } = await loadThreads();
  const l1 = threads.find((t) => t.id === L1);
  const l2 = threads.find((t) => t.id === L2);
  check(
    `ac9: legacy "Answer 18:39" renamed on load ("${l1 ? title(l1) : '-'}")`,
    !!l1 && !/^Answer /.test(title(l1)) && /beispiel-shop/.test(title(l1)),
    JSON.stringify(l1?.name)
  );
  check('ac9: a user-renamed thread keeps its name', l2 && title(l2) === `Kept by hand · Mine ${RUN}`, JSON.stringify(l2?.name));
  const r = cli(ORCH, 'thread', 'rename', L2, 'Other · Name');
  check('ac9: CLI rename of a user-renamed thread is refused', r.code !== 0 && /renamed by the user/i.test(r.out), r.out);
  await page.waitForTimeout(4000);
  const titles = await rowTitles(page);
  const bad = [...threads.map(title), ...titles].filter((x) => /^Answer |\*\*|^- |#|`/.test(x));
  check('ac9: no title starts with "Answer " or holds Markdown (API + UI rows)', bad.length === 0, JSON.stringify(bad));
  const text = await paneOf(page).textContent();
  check('ac9: "Not bound to a status task" not shown', !/Not bound to a status task/.test(text));
  await shot(page, 'ac9-names');
  return { L1, L2 };
}

// ---- AC-4 list on the left -------------------------------------------------------------------
async function ac4(page) {
  const pane = paneOf(page);
  await setMax(page, true);
  const layout = () => pane.locator('[data-threads-layout]').getAttribute('data-threads-layout');
  check('ac4: maximised, list on the left by default', (await layout()) === 'sidebar', await layout());
  await shot(page, 'ac4-max-default');
  await pane.getByRole('button', { name: 'Thread list on the left' }).click();
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForTimeout(5000);
  await openAgent(page, ORCH);
  await showPanel(page);
  await setMax(page, true);
  check('ac4: switched off, still off after a reload', (await layout()) === 'top', await layout());
  await pane.getByRole('button', { name: 'Thread list on the left' }).click();
  await page.waitForTimeout(300);
  check('ac4: switched on again', (await layout()) === 'sidebar');
  await setMax(page, false);
}

// ---- AC-1 rename -----------------------------------------------------------------------------
async function renameVia(page, id, how, text, key) {
  const pane = paneOf(page);
  // a short pane shows the open thread or the list: back to the list for a row action
  if (how.startsWith('row') && !(await row(page, id).isVisible()))
    await pane.getByRole('button', { name: 'Back to the list (thread stays open)' }).click();
  if (how === 'row-dblclick') {
    await row(page, id).locator('span.truncate').first().dblclick();
  } else if (how === 'row-menu') {
    await row(page, id).hover();
    await row(page, id).locator('xpath=..').getByRole('button', { name: 'Thread actions' }).click();
    await pane.getByRole('menuitem', { name: 'Rename' }).click();
  } else {
    await openThread(page, id);
    const head = pane.locator('aside section > div').first();
    if (how === 'header-dblclick') await head.locator('span.truncate').first().dblclick();
    else {
      await head.getByRole('button', { name: 'Thread actions' }).click();
      await pane.getByRole('menuitem', { name: 'Rename' }).click();
    }
  }
  const field = pane.locator(`[data-thread-rename="${id}"]`);
  await field.waitFor({ timeout: 3000 }).catch((e) => {
    throw new Error(`rename via ${how}: no name field (${e.message.split('\n')[0]})`);
  });
  await page.keyboard.type(text);
  if (key === 'blur') await pane.locator('[data-testid="threads-header"] span.font-medium').click();
  else await page.keyboard.press(key);
  await page.waitForTimeout(800);
}
async function ac1(page, id) {
  const pane = paneOf(page);
  const t0 = (await loadThreads()).threads.find((t) => t.id === id);
  await openThread(page, id);
  await page.waitForTimeout(800);
  const items0 = (await logTexts(page, 'thread')).length;
  const project = t0.name.project;
  const steps = [
    ['row-dblclick', `Renamed A ${RUN}`, 'Enter', true],
    ['header-dblclick', 'Discarded B', 'Escape', false],
    ['row-menu', `Renamed C ${RUN}`, 'blur', true],
    ['header-menu', `Renamed D ${RUN}`, 'Enter', true],
    ['row-dblclick', 'Discarded E', 'Escape', false],
  ];
  let want = t0.name.task;
  for (const [how, text, key, saves] of steps) {
    await renameVia(page, id, how, text, key);
    if (saves) want = text;
    const t = (await loadThreads()).threads.find((x) => x.id === id);
    // a short pane shows the list or the open thread's header: the name is in one of them
    const shown = await pane.locator('aside[aria-label="Threads"]').textContent();
    check(
      `ac1: ${how} + ${key} ${saves ? 'saves' : 'cancels'} ("${t?.name.task}")`,
      t && t.name.task === want && t.tag === t0.tag && shown.includes(want) && (await pane.locator('[data-thread-rename]').count()) === 0,
      JSON.stringify({ name: t?.name, renamed: t?.renamed })
    );
  }
  // Esc in the field leaves the maximised panel maximised
  await setMax(page, true);
  await renameVia(page, id, 'header-dblclick', 'Discarded F', 'Escape');
  check('ac1: Esc in the name field keeps the panel maximised', (await panelMode(page)) === 'full');
  await shot(page, 'ac1-renamed-max');
  await setMax(page, false);
  const t1 = (await loadThreads()).threads.find((x) => x.id === id);
  check('ac1: same id, same tag, marked renamed by the user', t1.tag === t0.tag && t1.renamed === true && t1.name.project === project);
  // reload: name and messages stay
  await page.reload();
  await page.waitForTimeout(5000);
  await openAgent(page, ORCH);
  await showPanel(page);
  await openThread(page, id);
  await page.waitForTimeout(1500);
  const items1 = (await logTexts(page, 'thread')).length;
  check(
    'ac1: after a reload the panel shows the new name, the thread keeps its messages',
    (await pane.locator('aside[aria-label="Threads"]').textContent()).includes(want) && items1 === items0,
    `${items0} -> ${items1}`
  );
  // a new message in the renamed thread (it carries the old tag) and its answer land in it
  const since = Date.now();
  await pane.locator('textarea[aria-label="Reply in thread"]').click();
  await page.keyboard.type(`Rename probe ${RUN}. Reply exactly: still here`);
  await page.keyboard.press(ENTER_SENDS ? 'Enter' : `${MOD}+Enter`);
  await waitAnswer(since);
  const { entries } = await entriesOf();
  const sent = entries.find((e) => e.kind === 'user' && e.text.includes(`Rename probe ${RUN}`));
  const ans = entries.find((e) => e.kind === 'answer' && e.ts > (sent?.ts ?? since));
  check(
    'ac1: a new message with the old tag and its answer still land in the renamed thread',
    sent?.thread === id && ans?.thread === id,
    JSON.stringify({ sent: sent?.thread, answer: ans?.thread, want: id })
  );
  await page.waitForTimeout(3000);
  await shot(page, 'ac1-renamed');
}

// ---- AC-3 attachments per composer -----------------------------------------------------------
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mPQqDhBEmIY1TCqYfhqAADDSmgQB35GTAAAAABJRU5ErkJggg==';
async function chips(page) {
  return paneOf(page).evaluate((pane) => {
    const aside = pane.querySelector('aside[aria-label="Threads"]');
    const all = [...pane.querySelectorAll('button[aria-label^="Remove "]')].filter(
      (b) => !/quote/i.test(b.getAttribute('aria-label'))
    );
    const thread = all.filter((b) => aside?.contains(b)).length;
    return { thread, main: all.length - thread };
  });
}
async function clearChips(page) {
  for (let k = 0; k < 10; k++) {
    const b = paneOf(page).locator('button[aria-label^="Remove "]:not([aria-label*="quote" i])').first();
    if (!(await b.count())) return;
    // cleanup only: a main chip can sit under the open drawer
    await b.dispatchEvent('click');
    await page.waitForTimeout(150);
  }
}
async function dropOn(page, selector) {
  await paneOf(page).locator(selector).first().evaluate((el, b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bin], 'dropped.png', { type: 'image/png' }));
    for (const type of ['dragenter', 'dragover', 'drop'])
      el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, PNG);
  await page.waitForTimeout(400);
}
async function ac3(page, id) {
  const pane = paneOf(page);
  const ctx = page.context();
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await openThread(page, id);
  await clearChips(page);
  const png = path.join(OUT, 'attach.png');
  fs.writeFileSync(png, Buffer.from(PNG, 'base64'));
  const expect = async (name, want) => {
    const c = await chips(page);
    check(`ac3: ${name}`, c.thread === want.thread && c.main === want.main, JSON.stringify(c));
    return c;
  };
  const threadBox = 'aside textarea[aria-label="Reply in thread"]';
  const mainBox = 'textarea[aria-label="Message"]';
  const focusMain = async () => {
    if ((await panelMode(page)) === 'overlay') await pane.locator(mainBox).focus();
    else await pane.locator(mainBox).click();
  };
  // Attach button in the thread composer
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    pane.locator('aside').getByRole('button', { name: 'Attach', exact: true }).click(),
  ]);
  await chooser.setFiles(png);
  await page.waitForTimeout(400);
  await expect('Attach in the thread → only the thread composer', { thread: 1, main: 0 });
  await shot(page, 'ac3-thread-attach');
  await clearChips(page);
  // real clipboard: an image, then Meta/Ctrl+V
  await page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }, PNG);
  await pane.locator(threadBox).click();
  await page.keyboard.press(`${MOD}+KeyV`);
  await page.waitForTimeout(500);
  await expect(`${MOD}+V in the thread → only the thread composer`, { thread: 1, main: 0 });
  await clearChips(page);
  await focusMain();
  await page.keyboard.press(`${MOD}+KeyV`);
  await page.waitForTimeout(500);
  await expect(`${MOD}+V in the main composer → only the main composer`, { thread: 0, main: 1 });
  await shot(page, 'ac3-main-paste');
  await clearChips(page);
  // drop on the thread input, elsewhere on the panel, on the main input
  await showPanel(page);
  await dropOn(page, threadBox);
  await expect('drop on the thread input → only the thread composer', { thread: 1, main: 0 });
  await clearChips(page);
  await dropOn(page, 'aside [data-testid="threads-header"]');
  await expect('drop elsewhere on the panel → in no composer', { thread: 0, main: 0 });
  await dropOn(page, mainBox);
  await expect('drop on the main input → only the main composer', { thread: 0, main: 1 });
  await clearChips(page);
  // maximised: paste in the thread, restore, the main composer stays empty
  await showPanel(page);
  await setMax(page, true);
  await pane.locator(threadBox).click();
  await page.keyboard.press(`${MOD}+KeyV`);
  await page.waitForTimeout(500);
  await setMax(page, false);
  await expect(`maximised ${MOD}+V in the thread, restored → main composer empty`, { thread: 1, main: 0 });
  await clearChips(page);
}

// ---- AC-2 footer geometry --------------------------------------------------------------------
const geometry = (page) =>
  paneOf(page).evaluate((pane) => {
    const r = (e) => e && e.getBoundingClientRect();
    const p = r(pane);
    const footer = pane.querySelector('[data-chat-footer]');
    const f = r(footer);
    const aside = pane.querySelector('aside[aria-label="Threads"]');
    const a = r(aside);
    const mode = pane.querySelector('[data-threads-mode]')?.getAttribute('data-threads-mode') ?? null;
    // footer content: inside the footer box, nothing cut unless it truncates with an ellipsis
    const cut = footer
      ? [...footer.querySelectorAll('button, span, [role=meter], svg')]
          .filter((e) => r(e).width > 0 && r(e).height > 0)
          .filter((e) => {
            const b = r(e);
            const out = b.left < f.left - 1 || b.right > f.right + 1 || b.top < f.top - 1 || b.bottom > f.bottom + 1;
            const st = getComputedStyle(e);
            const clipped = e.scrollWidth > e.clientWidth + 1 && st.overflowX !== 'visible' && st.textOverflow !== 'ellipsis';
            return out || clipped;
          })
          .map((e) => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30))
      : ['no footer'];
    // panel content that pokes out of the panel's bottom (onto the footer)
    const below = aside
      ? [...aside.querySelectorAll('button, textarea, span')]
          .filter((e) => r(e).width > 0 && r(e).height > 0 && !e.closest('[role=menu]'))
          .filter((e) => {
            let bottom = r(e).bottom;
            for (let x = e.parentElement; x && x !== aside; x = x.parentElement)
              if (getComputedStyle(x).overflowY !== 'visible') bottom = Math.min(bottom, r(x).bottom);
            return bottom > a.bottom + 1 && r(e).top < a.bottom + 200;
          })
          .map((e) => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30))
      : [];
    return {
      mode,
      pane: [Math.round(p.left), Math.round(p.right), Math.round(p.bottom)],
      footer: f ? [Math.round(f.left), Math.round(f.right), Math.round(f.top), Math.round(f.bottom), Math.round(f.width)] : null,
      panelBottom: a ? Math.round(a.bottom) : null,
      cut,
      below,
    };
  });
async function geometryCheck(page, label) {
  await paneOf(page)
    .locator('[data-chat-footer]')
    .waitFor({ state: 'visible', timeout: 15000 })
    .catch(() => {});
  const g = await geometry(page);
  await shot(page, `ac2-${label}-${g.mode}`);
  const f = g.footer;
  const border = 1; // the pane's own 1 px border
  check(
    `ac2 ${label} [${g.mode}]: footer spans the pane (left/right ±1 px), panel ends above it, nothing clipped`,
    !!f &&
      f[4] > 0 &&
      Math.abs(f[0] - (g.pane[0] + border)) <= 1 &&
      Math.abs(f[1] - (g.pane[1] - border)) <= 1 &&
      f[3] <= g.pane[2] &&
      (g.panelBottom === null || g.panelBottom <= f[2] + 1) &&
      g.cut.length === 0 &&
      g.below.length === 0,
    JSON.stringify(g)
  );
  return g.mode;
}
async function ac2(page) {
  const modes = new Set();
  await showPanel(page);
  modes.add(await geometryCheck(page, 'panel'));
  await setMax(page, true);
  modes.add(await geometryCheck(page, 'maximised'));
  await setMax(page, false);
  // a stacked or side-by-side split: squeeze this pane to its minimum (drawer where too narrow)
  if (SPLIT !== 'tab') {
    const div = await page.evaluate(() => {
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
      return hit && { x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 };
    });
    const first = await paneOf(page).evaluate(
      (p) => [...document.querySelectorAll('[data-chat-pane]')].filter((x) => x.getBoundingClientRect().width > 0)[0] === p
    );
    if (div) {
      const d = first ? -2000 : 2000;
      await page.mouse.move(div.x, div.y, { steps: 3 });
      await page.mouse.down();
      await page.mouse.move(SPLIT === 'down' ? div.x : div.x + d, SPLIT === 'down' ? div.y + d : div.y, { steps: 15 });
      await page.mouse.up();
      await page.waitForTimeout(500);
      await showPanel(page);
      modes.add(await geometryCheck(page, 'squeezed'));
      await page.mouse.dblclick(div.x, div.y);
      await page.waitForTimeout(300);
    }
  }
  console.log(`  ac2 modes seen: ${[...modes].join(', ')}`);
}

// ---- AC-10 tidy-up ---------------------------------------------------------------------------
/** entry key → thread (null = main), every entry, as the CLI lists them */
async function assignment() {
  const { entries, threads } = await entriesOf();
  const map = Object.fromEntries(entries.map((e) => [e.key, e.thread ?? null]));
  return { map, entries, threads };
}
/** UI items: the main log plus every listed thread's log */
async function uiCount(page) {
  const pane = paneOf(page);
  // the main log pages its history: everything loaded before counting
  for (let k = 0; k < 10; k++) {
    const more = pane.getByRole('button', { name: 'Load earlier messages' });
    if (!(await more.count())) break;
    await more.first().click();
    await page.waitForTimeout(800);
  }
  let n = (await logTexts(page, 'main')).length;
  const per = { main: n };
  const ids = await pane.locator('[data-thread-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-thread-row')));
  for (const id of ids) {
    await openThread(page, id);
    // a thread's log fills in once its history is loaded: read until two reads agree
    let last = -1;
    for (let k = 0; k < 10; k++) {
      await page.waitForTimeout(400);
      const c = (await logTexts(page, 'thread')).length;
      if (c === last) break;
      last = c;
    }
    n += last;
    per[id] = last;
  }
  return { items: n, threads: ids.length, per };
}
async function ac10(page) {
  const start = await assignment();
  const ui0 = await uiCount(page);
  // where the UI and the CLI disagree before the tidy-up (an item the UI does not show)
  const apiPer = {};
  for (const e of start.entries) apiPer[e.thread ?? 'main'] = (apiPer[e.thread ?? 'main'] ?? 0) + 1;
  const off = Object.keys({ ...apiPer, ...ui0.per }).filter((k) => (apiPer[k] ?? 0) !== (ui0.per[k] ?? 0));
  if (off.length) console.log(`  ac10 UI vs CLI before: ${off.map((k) => `${k.slice(0, 8)} ${ui0.per[k] ?? 0}/${apiPer[k] ?? 0}`).join(', ')}`);
  const listed = start.threads.filter((t) => !t.mergedInto && !t.closed);
  check(`ac10: ≥ 6 threads before the tidy-up`, listed.length >= 6, `${listed.length}`);
  await shot(page, 'ac10-before');
  // group by project: merge each group into its oldest thread; main entries naming a group's
  // project move into it
  const groups = new Map();
  for (const t of listed.sort((a, b) => a.createdAt - b.createdAt)) {
    const k = t.name.project.toLowerCase();
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  let actions = 0;
  for (const [, ts] of groups) {
    if (ts.length < 2) continue;
    const r = cli(ORCH, 'thread', 'merge', ts[0].id, ...ts.slice(1).map((t) => t.id));
    check(`ac10: merge into ${title(ts[0])}`, r.code === 0, r.out);
    actions++;
  }
  const shop = groups.get('beispiel-shop')?.[0];
  const loose = start.entries.filter((e) => !e.thread && /beispiel-shop/i.test(e.text)).map((e) => e.key);
  if (shop && loose.length) {
    const r = cli(ORCH, 'thread', 'move', ...loose, shop.id);
    check(`ac10: move ${loose.length} main entries into ${title(shop)}`, r.code === 0, r.out);
    actions++;
  }
  // the UI regroups without a reload
  const want = groups.size;
  const regrouped = await waitFor(async () => (await paneOf(page).locator('[data-thread-row]').count()) === want, 8000);
  await shot(page, 'ac10-tidied');
  check('ac10: UI regroups without a reload (one row per project)', !!regrouped, `${await paneOf(page).locator('[data-thread-row]').count()} rows, want ${want}`);
  const after = await assignment();
  const perProject = new Map();
  for (const t of after.threads.filter((x) => !x.mergedInto && !x.closed))
    perProject.set(t.name.project.toLowerCase(), (perProject.get(t.name.project.toLowerCase()) ?? 0) + 1);
  check('ac10: exactly one thread per project', [...perProject.values()].every((n) => n === 1), JSON.stringify([...perProject]));
  check('ac10: entry count unchanged (CLI)', after.entries.length === start.entries.length, `${start.entries.length} -> ${after.entries.length}`);
  const ui1 = await uiCount(page);
  check('ac10: item count unchanged (UI, main + threads)', ui1.items === ui0.items, `${ui0.items} -> ${ui1.items}, rows ${ui0.threads} -> ${ui1.threads}`);
  // undo: the panel button once (real mouse), the rest by CLI
  const undo = paneOf(page).getByRole('button', { name: 'Undo tidy-up' });
  check('ac10: panel offers "Undo tidy-up"', (await undo.count()) === 1);
  if (await undo.count()) {
    await undo.click();
    actions--;
  }
  await page.waitForTimeout(1500);
  for (; actions > 0; actions--) {
    const r = cli(ORCH, 'thread', 'undo');
    check('ac10: orkumo thread undo', r.code === 0, r.out);
  }
  const back = await assignment();
  const diff = Object.keys(start.map).filter((k) => start.map[k] !== back.map[k]);
  check('ac10: undo restores every entry to its thread', diff.length === 0, JSON.stringify(diff.slice(0, 5)));
  const rowsBack = await waitFor(async () => (await paneOf(page).locator('[data-thread-row]').count()) === ui0.threads, 8000);
  await shot(page, 'ac10-undone');
  check('ac10: UI shows the start state again without a reload', !!rowsBack);
}

// ---- AC-11 scroll: a real wheel up during a real streaming answer keeps the reader's place -------
const logSel = (where) =>
  where === 'thread'
    ? 'aside[aria-label="Threads"] section [class*="overflow-y-auto"]'
    : '[role=log]';
/** Geometry of the main log (outside the threads panel) or the open thread's log */
const logGeo = (page, where) =>
  paneOf(page).evaluate(
    (pane, [where, sel]) => {
      const aside = pane.querySelector('aside[aria-label="Threads"]');
      const log =
        where === 'thread'
          ? pane.querySelector(sel)
          : [...pane.querySelectorAll(sel)].find((l) => !aside?.contains(l));
      if (!log) return null;
      const probe = document.querySelector('[data-scroll-probe]');
      const r = log.getBoundingClientRect();
      return {
        top: log.scrollTop,
        height: log.scrollHeight,
        client: log.clientHeight,
        fromBottom: Math.round(log.scrollHeight - log.scrollTop - log.clientHeight),
        anchor: getComputedStyle(log).overflowAnchor,
        box: { x: r.x, y: r.y, w: r.width, h: r.height },
        probeTop: probe ? probe.getBoundingClientRect().top : null,
        probeConnected: probe ? probe.isConnected && log.contains(probe) : false,
        probeText: probe ? (probe.textContent || '').slice(0, 40) : null,
        button: [...pane.querySelectorAll('button')].some(
          (b) =>
            /New messages/.test(b.textContent || '') &&
            (where === 'thread') === !!aside?.contains(b) &&
            b.offsetParent !== null
        ),
      };
    },
    [where, logSel(where)]
  );
/** Marks the first row whose top is inside the log: the reader's place */
const markFirstVisible = (page, where) =>
  paneOf(page).evaluate(
    (pane, [where, sel]) => {
      document.querySelectorAll('[data-scroll-probe]').forEach((e) => e.removeAttribute('data-scroll-probe'));
      const aside = pane.querySelector('aside[aria-label="Threads"]');
      const log =
        where === 'thread'
          ? pane.querySelector(sel)
          : [...pane.querySelectorAll(sel)].find((l) => !aside?.contains(l));
      const rows = [...(log.children.length === 1 ? log.firstElementChild.children : log.children)];
      const top = log.getBoundingClientRect().top;
      const row = rows.find((r) => r.getBoundingClientRect().top >= top && r.offsetHeight > 0);
      row?.setAttribute('data-scroll-probe', '1');
      return row ? (row.textContent || '').slice(0, 40) : null;
    },
    [where, logSel(where)]
  );
const isWorking = async () =>
  (await api('/agents')).sessions.find((x) => x.id === ORCH)?.displayState === 'working';

async function scrollCheck(page, where) {
  const pane = paneOf(page);
  const box =
    where === 'thread' ? pane.locator('aside textarea[aria-label="Reply in thread"]') : pane.locator('textarea[aria-label="Message"]');
  const send = async (text) => {
    await box.click();
    await page.keyboard.type(text);
    await page.keyboard.press(ENTER_SENDS ? 'Enter' : `${MOD}+Enter`);
  };
  const g0 = await logGeo(page, where);
  check(`ac11 ${where}: live bundle (overflow-anchor: none on the log)`, g0?.anchor === 'none', g0?.anchor);
  // the log must overflow well before the wheel: seed it with one long real answer
  if (g0 && g0.height - g0.client < 1500) {
    const since = Date.now();
    await send(`Scroll seed ${RUN} (${where}). Reply with a numbered list from 1 to 60, one line each: the number and one fruit. No tools.`);
    await waitAnswer(since);
    await page.waitForTimeout(3000);
  }
  // the streaming answer: text parts between real tool calls arrive over ~30 s
  const since = Date.now();
  await send(
    `Scroll probe ${RUN} (${where}). Do 6 rounds. In each round first write a paragraph of about 50 words ` +
      'about round N of baking bread, then run the shell command `sleep 5` as its own tool call. ' +
      'After round 6 reply with a numbered list from 1 to 30, one line each: the number and one vegetable.'
  );
  const started = await waitFor(isWorking, 30000, 300);
  // wait for the answer to start: the log grew past the sent message
  const h1 = (await logGeo(page, where)).height;
  await waitFor(async () => (await logGeo(page, where)).height > h1, 30000, 200);
  const atEnd = await logGeo(page, where);
  check(
    `ac11 ${where}: at the end while the answer starts, no "New messages"`,
    !!started && atEnd.fromBottom <= 40 && !atEnd.button,
    JSON.stringify({ working: !!started, fromBottom: atEnd.fromBottom, button: atEnd.button })
  );
  // a real wheel up over the log, short of the top (no older page)
  await page.mouse.move(atEnd.box.x + atEnd.box.w / 2, atEnd.box.y + atEnd.box.h / 2);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -150);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(400);
  const probe = await markFirstVisible(page, where);
  const up = await logGeo(page, where);
  check(
    `ac11 ${where}: wheel up let go of the end`,
    up.fromBottom > 40 && up.top > 0 && !!probe,
    JSON.stringify({ fromBottom: up.fromBottom, scrollTop: up.top, probe })
  );
  // ≥ 10 s at 250 ms, longer until content arrived below at least twice (max 60 s)
  const samples = [];
  const t0 = Date.now();
  const growthsOf = () => samples.filter((x, i) => i && x.height > samples[i - 1].height + 1).length;
  for (;;) {
    const g = await logGeo(page, where);
    samples.push({ t: Date.now() - t0, ...g });
    if ((Date.now() - t0 >= 10250 && growthsOf() >= 2) || Date.now() - t0 > 60000) break;
    await page.waitForTimeout(250);
  }
  const dev = Math.max(...samples.map((x) => Math.abs(x.probeTop - samples[0].probeTop)));
  const growths = growthsOf();
  const firstGrowth = samples.findIndex((x) => x.height > samples[0].height + 1);
  fs.writeFileSync(path.join(OUT, `${tag}-ac11-${where}-samples.json`), JSON.stringify(samples, null, 1));
  const secs = (samples.at(-1).t - samples[0].t) / 1000;
  check(
    `ac11 ${where}: ≥ 41 samples over ≥ 10 s, the same row throughout`,
    samples.length >= 41 && secs >= 10 && samples.every((x) => x.probeConnected),
    `${samples.length} samples, ${secs.toFixed(1)} s, probe "${probe}"`
  );
  check(
    `ac11 ${where}: content arrived below during the window (≥ 2 times, streaming)`,
    growths >= 2,
    `${growths} growth events, +${samples.at(-1).height - samples[0].height} px`
  );
  check(
    `ac11 ${where}: first visible row stays in place (≤ 2 px)`,
    dev <= 2,
    `max deviation ${dev.toFixed(1)} px (top ${samples[0].probeTop.toFixed(1)}), fromBottom ${samples[0].fromBottom} -> ${samples.at(-1).fromBottom}`
  );
  check(
    `ac11 ${where}: "New messages" shows once content arrived`,
    firstGrowth > 0 && samples.slice(firstGrowth + 2).every((x) => x.button),
    `first growth at sample ${firstGrowth}, button at last sample: ${samples.at(-1).button}`
  );
  await shot(page, `ac11-${where}-scrolled-up`);
  // a real click on the button: back at the end, button gone, following again
  const btn = pane.locator(where === 'thread' ? 'aside button' : 'button:not(aside button)', { hasText: 'New messages' });
  await btn.click();
  await page.waitForTimeout(800);
  const back = await logGeo(page, where);
  check(
    `ac11 ${where}: click on "New messages" → end, button gone`,
    back.fromBottom <= 40 && !back.button,
    JSON.stringify({ fromBottom: back.fromBottom, button: back.button })
  );
  await shot(page, `ac11-${where}-after-button`);
  // the rest of the turn (or, if it already ended, one more real turn): followed at the end
  const hb = back.height;
  const later = [];
  const follow = async () => {
    while ((await isWorking()) && later.length < 600) {
      await page.waitForTimeout(250);
      later.push(await logGeo(page, where));
    }
  };
  await follow();
  await waitAnswer(since);
  if ((await logGeo(page, where)).height <= hb + 1) {
    const again = Date.now();
    await send(`Scroll follow ${RUN} (${where}). Reply exactly: following`);
    await waitFor(isWorking, 30000, 300);
    await follow();
    await waitAnswer(again);
  }
  await page.waitForTimeout(2500);
  const end = await logGeo(page, where);
  later.push(end);
  const grewAfter = end.height > hb + 1;
  check(
    `ac11 ${where}: content after the click is followed (≤ 40 px from the end)`,
    grewAfter && later.every((x) => x.fromBottom <= 40),
    `+${end.height - hb} px after the click, end fromBottom ${end.fromBottom}, max ${Math.max(...later.map((x) => x.fromBottom))}`
  );
  check(`ac11 ${where}: at the end after the turn`, end.fromBottom <= 40 && !end.button, `${end.fromBottom}`);
}

const stepsBtn = (page) => paneOf(page).locator('button[aria-label="Show thinking and tool calls"]').first();
async function ac11(page, id) {
  // thinking and tool calls on: the orchestrator's turn then arrives step by step (omp writes
  // its transcript per message), a real stream into the log
  const stepsWas = (await stepsBtn(page).getAttribute('aria-pressed')) === 'true';
  if (!stepsWas) await stepsBtn(page).click();
  await setMax(page, false);
  await showPanel(page);
  if ((await panelMode(page)) === 'overlay') check('ac11: side panel (not overlay) for main + thread', false);
  await openThread(page, id);
  await page.waitForTimeout(1000);
  await scrollCheck(page, 'thread');
  await scrollCheck(page, 'main');
  if (!stepsWas) await stepsBtn(page).click();
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(`${m.text()} ${m.location()?.url ?? ''}`.trim()));
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    if (on('ac7')) await ac7();
    await openLayout(page);
    await shot(page, 'start');
    let agentThread = null;
    if (on('ac5')) agentThread = await ac5(page);
    if (on('ac6')) await ac6(page);
    if (on('ac9')) await ac9(page);
    if (on('ac4')) await ac4(page);
    // a thread with messages for rename and attachments: the agent's, else the first listed
    const target =
      agentThread?.id ??
      (await paneOf(page).locator('[data-thread-row]').first().getAttribute('data-thread-row').catch(() => null));
    if (on('ac1')) target ? await ac1(page, target) : check('ac1: a thread to rename', false);
    if (on('ac3')) target ? await ac3(page, target) : check('ac3: a thread to attach in', false);
    if (on('ac2')) await ac2(page);
    if (on('ac10')) await ac10(page);
    if (on('ac11')) target ? await ac11(page, target) : check('ac11: a thread to scroll in', false);
  } catch (e) {
    const at = (e.stack || '').split('\n').find((l) => l.includes('threads-v3-e2e'))?.trim() ?? '';
    check('run', false, `${e.message.split('\n')[0]} ${at}`);
    await shot(page, 'error').catch(() => {});
  } finally {
    if (worker) console.log(`  stop ${worker}: ${cli(ORCH, 'stop', worker).out}`);
  }
  check('0 console errors', errors.length === 0, JSON.stringify(errors.slice(0, 5)));
  await ctx.close();
  await browser.close();
  console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
