/* global document, window, getComputedStyle, Node */
// e2e for the thread hotfix (H-1 … H-5), real mouse and keyboard on an isolated Orkumo instance:
// H-1 `/` in a thread composer lists the main composer's commands and skills (argument hints);
// H-2 a command sent from a thread reaches the PTY without the thread tag, runs, and its turn
//     lands in the thread (also after a reload); a plain thread message keeps its tag;
// H-4 two orchestrators sharing a role, one thread each: each lists only its own, after a reload,
//     a tab switch and in a split;
// H-5 threads the role-keyed store left in `threads/<role>.json` go back to the orchestrator whose
//     transcript proves them, an unprovable one stays; a second load (server restart) moves nothing.
// Needs: two Claude terminal orchestrators A and B with role ROLE and an omp orchestrator C, running
// in the instance's orchestrator workspace; the instance must be the only reader of DATA.
// Usage: NODE_PATH=<dir with playwright> A=<uuid> B=<uuid> C=<omp uuid> \
//   RESTART="<command that restarts the API server>" \
//   node scripts/review/thread-hotfix-e2e.cjs <baseUrl> <apiUrl> <dataDir> <outDir>
// (CHROME=<path> for a given Chromium; ROLE (default demo); PHASES=h5,h1,h2,h4 to run a subset;
// HARNESS=claude or omp runs H-1/H-2 on that orchestrator only)
const pw = (() => {
  try {
    return require('playwright');
  } catch {
    return require('playwright-core');
  }
})();
const { chromium } = pw;
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const [BASE, API, DATA, OUT] = process.argv.slice(2);
if (!OUT) {
  console.error('usage: thread-hotfix-e2e.cjs <baseUrl> <apiUrl> <dataDir> <outDir>');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const { A, B, C } = process.env;
const ROLE = process.env.ROLE || 'demo';
const PHASES = (process.env.PHASES || 'h5,h1,h2,h4').split(',');
const ORCHS = [
  ['claude', A],
  ['omp', C],
].filter(([h]) => !process.env.HARNESS || process.env.HARNESS === h);
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const RUN = Date.now().toString(36).slice(-5);
const THREADS = path.join(DATA, 'orchestrator-reports', 'threads');
const WORKSPACE = path.join(DATA, 'orchestrator');
const claudeTranscript = (uuid) =>
  path.join(
    os.homedir(),
    '.claude',
    'projects',
    WORKSPACE.replace(/[^a-zA-Z0-9]/g, '-'),
    `${uuid}.jsonl`
  );
const ompTranscript = (uuid) => {
  const dir = path.join(os.homedir(), '.omp', 'agent', 'sessions');
  for (const d of fs.readdirSync(dir)) {
    const f = fs
      .readdirSync(path.join(dir, d))
      .find((n) => n.endsWith(`_${uuid}.jsonl`) && !n.startsWith('.'));
    if (f) return path.join(dir, d, f);
  }
  return null;
};
const records = (file) =>
  fs
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
    .filter(Boolean);

let fails = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const wait = (page, ms) => page.waitForTimeout(ms);
const readThreads = (key) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(THREADS, `${key}.json`), 'utf8')).threads ?? [];
  } catch {
    return [];
  }
};
const hashThreads = () =>
  fs.existsSync(THREADS)
    ? fs
        .readdirSync(THREADS)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map(
          (f) =>
            `${f}:${crypto
              .createHash('sha1')
              .update(fs.readFileSync(path.join(THREADS, f)))
              .digest('hex')}`
        )
        .join(' ')
    : '';
const errors = [];
/** Restarts the API server; what the page saw fail while it was down is no finding */
const restartServer = async (page) => {
  const seen = errors.length;
  execSync(process.env.RESTART, { stdio: 'ignore' });
  for (
    let i = 0;
    i < 60 &&
    !(await fetch(`${API}/agents`).then(
      (r) => r.ok,
      () => false
    ));
    i++
  )
    await new Promise((r) => setTimeout(r, 1000));
  await page.reload();
  await wait(page, 5000);
  errors.length = seen;
};

/** Row id of an orchestrator (a Claude terminal's row is `interactive-<pid>`) */
async function rowId(uuid) {
  const { sessions } = await (await fetch(`${API}/agents`)).json();
  return sessions.find((s) => s.sessionId === uuid || s.id === uuid)?.id ?? null;
}

const pane = (page, i = 0) => page.locator('[data-chat-pane]:visible').nth(i);
const aside = (page, i = 0) => pane(page, i).locator('aside[aria-label="Threads"]');

/** Opens the orchestrator in a tab of its own (card click + Enter), UI view */
async function openAgent(page, uuid) {
  const id = await rowId(uuid);
  const card = page.locator(`[role="option"][data-session-id="${id}"]`);
  if (!(await card.count())) {
    await page.locator('[role="option"]', { hasText: 'Orchestrators' }).first().click();
    await wait(page, 800);
  }
  await card.first().click();
  await page.keyboard.press('Enter');
  await wait(page, 3500);
}

async function showPanel(page, i = 0) {
  const toggle = pane(page, i).locator('button[aria-label="Threads"][aria-pressed="false"]');
  if (await toggle.count()) {
    await toggle.click();
    await wait(page, 500);
  }
}

/** Thread names the panel lists */
const listedThreads = (page, i = 0) =>
  pane(page, i)
    .locator('[data-thread-row]')
    .evaluateAll((rows) => rows.map((r) => (r.textContent || '').replace(/\s+/g, ' ').trim()));

/** Back to the panel's list (a thread may be open) */
async function toList(page, i = 0) {
  const back = aside(page, i).getByRole('button', { name: /Back to the list|All threads/ });
  if (await back.count()) {
    await back.first().click();
    await wait(page, 400);
  }
}

/** A new thread without a task; it gets its name from the first message */
async function newThread(page, i = 0) {
  await showPanel(page, i);
  await pane(page, i).getByRole('button', { name: 'New thread' }).click();
  await page.getByRole('menuitem', { name: /Thread without a task/ }).click();
  await wait(page, 600);
}

/** Option labels of the `/` popup of a composer, with the hint of the first option with one */
async function slashList(page, textarea) {
  await textarea.click();
  await page.keyboard.type('/');
  await wait(page, 700);
  const list = page.locator('[role="listbox"][aria-label="Commands"]');
  const labels = (await list.count())
    ? await list.locator('[role="option"] span.font-mono').allTextContents()
    : [];
  return labels;
}

/** Walks the popup with ArrowDown until an option shows an argument hint; its label and hint */
async function hintedOption(page, max) {
  for (let i = 0; i < max; i++) {
    const hint = await page.evaluate(() => {
      const lb = document.querySelector('[role="listbox"][aria-label="Commands"]');
      const detail = lb?.nextElementSibling;
      const sel = lb?.querySelector('[aria-selected="true"] span.font-mono')?.textContent;
      const args = detail?.querySelector('.mt-1\\.5')?.textContent;
      return args ? { label: sel, hint: args } : null;
    });
    if (hint) return hint;
    await page.keyboard.press('ArrowDown');
    await wait(page, 120);
  }
  return null;
}

/** Popup box inside the viewport and not cut by an overflow ancestor */
const popupBox = (page) =>
  page.evaluate(() => {
    const lb = document.querySelector('[role="listbox"][aria-label="Commands"]');
    const box = lb?.parentElement;
    if (!box) return null;
    const b = box.getBoundingClientRect();
    let [top, left, right] = [b.top, b.left, b.right];
    for (let a = box.parentElement; a; a = a.parentElement) {
      const st = getComputedStyle(a);
      if (st.overflow === 'visible' && st.overflowY === 'visible') continue;
      const r = a.getBoundingClientRect();
      [top, left, right] = [Math.max(top, r.top), Math.max(left, r.left), Math.min(right, r.right)];
    }
    // the detail column (label, argument hint, description) wraps instead of running out
    const detail = lb.nextElementSibling;
    return {
      detailOverflow: !!detail && detail.scrollWidth > detail.clientWidth + 1,
      height: Math.round(b.height),
      visibleHeight: Math.round(b.bottom - top),
      cut: top > b.top + 1 || left > b.left + 1 || right < b.right - 1,
      inViewport: b.top >= 0 && b.left >= 0 && b.right <= window.innerWidth,
    };
  });

async function clearComposer(page) {
  await page.keyboard.press('Escape');
  await page.keyboard.press(`${MOD}+A`);
  await page.keyboard.press('Backspace');
}

// ---------------------------------------------------------------------------------------------
async function h1(page, uuid, name) {
  await openAgent(page, uuid);
  await showPanel(page);
  const main = await slashList(page, pane(page).locator('textarea[aria-label="Message"]'));
  await clearComposer(page);
  await newThread(page);
  const input = aside(page).locator('textarea[aria-label="Reply in thread"]');
  const inThread = await slashList(page, input);
  const box = await popupBox(page);
  const hinted = await hintedOption(page, inThread.length);
  await shot(page, `h1-${name}-thread-popup`);
  const missing = main.filter((l) => !inThread.includes(l));
  check(
    `H-1 ${name}: thread popup lists the main composer's commands (${main.length})`,
    main.length > 0 && missing.length === 0 && inThread.length === main.length,
    missing.length ? `missing ${missing.join(' ')}` : `${inThread.length} options`
  );
  const wanted = name === 'omp' ? '/skill:status-report' : '/status-report';
  check(`H-1 ${name}: ${wanted} offered in the thread`, inThread.includes(wanted));
  check(
    `H-1 ${name}: an argument hint shows in the thread popup`,
    !!hinted,
    hinted ? `${hinted.label} → ${hinted.hint}` : ''
  );
  check(
    `H-1 ${name}: popup not clipped`,
    !!box &&
      !box.cut &&
      !box.detailOverflow &&
      box.inViewport &&
      box.visibleHeight >= box.height - 1,
    JSON.stringify(box)
  );
  await clearComposer(page);
  return inThread;
}

/**
 * Where the command's chip is (a message starting with it; thread rows, markers and the quoted
 * parent leave out) and whether an answer follows it there
 */
const placement = (page, cmd) =>
  pane(page).evaluate((p, cmd) => {
    const side = p.querySelector('aside[aria-label="Threads"]');
    const log = [...p.querySelectorAll('[role=log]')].find((l) => !side || !side.contains(l));
    const chips = (root) =>
      root
        ? [...root.querySelectorAll('*')].filter(
            (e) =>
              !e.children.length &&
              (e.textContent || '').trim().startsWith(cmd) &&
              !e.closest('[data-thread-row], [data-thread-marker], [data-thread-parent]')
          )
        : [];
    const inThread = chips(side);
    const last = inThread[inThread.length - 1];
    return {
      thread: inThread.length > 0,
      main: chips(log).length > 0,
      answered:
        !!last &&
        [...side.querySelectorAll('article')].some(
          (a) => last.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING
        ),
    };
  }, cmd);

async function waitIdle(uuid, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const { sessions } = await (await fetch(`${API}/agents`)).json();
    const s = sessions.find((x) => x.sessionId === uuid);
    // a Claude terminal's row says `interactive`, its CLI status busy / idle
    if (s && s.displayState !== 'working' && s.status !== 'busy') return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

/** Answers in the thread after its user items (article count grows, the agent idles) */
async function sendInThread(page, uuid, text) {
  const input = aside(page).locator('textarea[aria-label="Reply in thread"]');
  await input.click();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape'); // close the popup, keep the text
  const at = Date.now();
  await page.keyboard.press(`${MOD}+Enter`);
  await wait(page, 6000);
  const until = Date.now() + 6 * 60_000;
  const chip = text.startsWith('/') ? text.split(' ')[0] : text;
  while (Date.now() < until) {
    const p = await placement(page, chip);
    if (p.answered && (await waitIdle(uuid, 1000))) break;
    await wait(page, 4000);
  }
  await wait(page, 3000);
  return at;
}

/** User records of the transcript since `at`: what the PTY got */
function typed(uuid, harness, at) {
  if (harness === 'claude')
    return records(claudeTranscript(uuid))
      .filter((r) => r.type === 'user' && Date.parse(r.timestamp) >= at - 2000)
      .map((r) =>
        typeof r.message?.content === 'string'
          ? r.message.content
          : (r.message?.content ?? []).map((c) => c.text ?? '').join('')
      )
      .filter((t) => t && !t.startsWith('<local-command') && !t.includes('tool_use_id'));
  return records(ompTranscript(uuid))
    .filter((r) => Date.parse(r.timestamp) >= at - 2000)
    .map((r) =>
      r.type === 'custom_message' && r.customType === 'skill-prompt'
        ? r.details?.prompt
        : r.type === 'message' && r.message?.role === 'user'
          ? (r.message.content ?? []).map((c) => c.text ?? '').join('')
          : null
    )
    .filter(Boolean);
}

async function h2(page, uuid, name, commands) {
  const harness = name === 'omp' ? 'omp' : 'claude';
  await openAgent(page, uuid);
  await showPanel(page);
  await newThread(page);
  await waitIdle(uuid, 60_000);
  const report = harness === 'omp' ? '/skill:status-report' : '/status-report';
  const skill =
    harness === 'omp'
      ? '/skill:orkumo-orchestrator'
      : commands.find((c) => c === '/orkumo-orchestrator') || '/orkumo-orchestrator';
  const sends = [
    { text: report, cmd: report },
    { text: `${skill} Antworte nur mit dem Wort SKILL-${RUN}, sonst nichts.`, cmd: skill },
  ];
  for (const s of sends) {
    const at = await sendInThread(page, uuid, s.text);
    const lines = typed(uuid, harness, at);
    const got = lines.find((l) => l.includes(s.cmd.replace('/skill:', '')));
    check(
      `H-2 ${name}: ${s.cmd} reached the PTY without a thread tag`,
      !!got && !lines.some((l) => l.trimStart().startsWith('[Thread:') && l.includes(s.cmd)),
      JSON.stringify(got?.slice(0, 120))
    );
    const p = await placement(page, s.cmd);
    check(
      `H-2 ${name}: ${s.cmd} chip and answer in the thread, not in main`,
      p.thread && !p.main && p.answered,
      JSON.stringify(p)
    );
  }
  await shot(page, `h2-${name}-thread`);
  // a plain message keeps its tag
  const at = await sendInThread(page, uuid, `Antworte nur mit PLAIN-${RUN}.`);
  const plain = typed(uuid, harness, at).find((l) => l.includes(`PLAIN-${RUN}`));
  check(
    `H-2 ${name}: a plain thread message keeps its tag`,
    !!plain && plain.trimStart().startsWith('[Thread:'),
    JSON.stringify(plain?.slice(0, 80))
  );
  const answered = await page
    .locator('aside[aria-label="Threads"] article', { hasText: `SKILL-${RUN}` })
    .count();
  check(`H-2 ${name}: the skill's answer is in the thread`, answered > 0);
  // after a reload, the thread still holds both commands
  await page.reload();
  await wait(page, 5000);
  await openAgent(page, uuid);
  await showPanel(page);
  await toList(page);
  // the thread this run made: the newest of the orchestrator
  const { threads } = await (
    await fetch(`${API}/orchestrator/threads?session=${encodeURIComponent(uuid)}`)
  ).json();
  const newest = threads.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  await pane(page).locator(`[data-thread-row="${newest.id}"]`).click();
  await wait(page, 2500);
  for (const s of sends) {
    const p = await placement(page, s.cmd);
    check(
      `H-2 ${name}: after reload ${s.cmd} and its answer still in the thread only`,
      p.thread && !p.main && p.answered,
      JSON.stringify(p)
    );
  }
  await shot(page, `h2-${name}-after-reload`);
}

// ---------------------------------------------------------------------------------------------
async function h4(page) {
  const names = { [A]: `nur-A-${RUN}`, [B]: `nur-B-${RUN}` };
  for (const uuid of [A, B]) {
    await openAgent(page, uuid);
    await newThread(page);
    const input = aside(page).locator('textarea[aria-label="Reply in thread"]');
    await input.click();
    await page.keyboard.type(`${names[uuid]} antworte nur mit OK`);
    await page.keyboard.press(`${MOD}+Enter`);
    await wait(page, 3000);
  }
  const own = async (label, i, uuid) => {
    await showPanel(page, i);
    await toList(page, i);
    const rows = await listedThreads(page, i);
    const other = uuid === A ? names[B] : names[A];
    check(
      `H-4 ${label}: lists its own thread only`,
      rows.some((r) => r.includes(names[uuid])) && !rows.some((r) => r.includes(other)),
      rows.join(' | ')
    );
    return rows;
  };
  // tab switch: B is the active tab now, then A
  await own('tab B', 0, B);
  await openAgent(page, A);
  await own('tab A after switch', 0, A);
  await page.reload();
  await wait(page, 5000);
  await openAgent(page, B);
  await own('reload, tab B', 0, B);
  await openAgent(page, A);
  await own('reload, tab A', 0, A);
  // split: both side by side
  const split = page.locator('button[aria-label^="Split "][aria-label$=" right"]').first();
  await split
    .locator('xpath=ancestor::*[contains(concat(" ", @class, " "), " group ")][1]')
    .hover();
  await wait(page, 300);
  await split.click();
  await wait(page, 4000);
  const ids = await page
    .locator('[data-chat-pane]:visible')
    .evaluateAll((ps) => ps.map((p) => p.getAttribute('data-agent-pane')));
  console.log('  split panes', JSON.stringify(ids));
  const { sessions } = await (await fetch(`${API}/agents`)).json();
  const ofPane = (id) =>
    sessions.find((x) => [x.id, x.sessionId, x.paneId].includes(id))?.sessionId ?? null;
  check(
    'H-4 split shows A and B',
    [A, B].every((u) => ids.map(ofPane).includes(u))
  );
  for (const [i, id] of ids.entries())
    if ([A, B].includes(ofPane(id))) await own(`split pane ${i}`, i, ofPane(id));
  await shot(page, 'h4-split');
}

// ---------------------------------------------------------------------------------------------
/** The misplaced state: threads/<role>.json holding A's, B's and an unprovable thread */
function writeFixture() {
  const firstAnswer = (uuid) =>
    records(claudeTranscript(uuid)).find((r) => r.type === 'assistant' && r.message?.id)?.message
      .id;
  const [ka, kb] = [firstAnswer(A), firstAnswer(B)];
  if (!ka || !kb) throw new Error('A or B has no answer in its transcript yet');
  const t = (n, task, parentKey) => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    tag: `[Thread: Answer 09:00 · ${task}]`,
    name: { project: 'Answer 09:00', task },
    binding: null,
    parentKey,
    agents: [],
    createdAt: 1,
    readAt: 1,
    closed: false,
  });
  const fixture = [t(1, 'Fixture A', ka), t(2, 'Fixture B', kb), t(3, 'Fixture nowhere', 'msg_0')];
  fs.mkdirSync(THREADS, { recursive: true });
  // a rerun: the fixture threads leave the session files first (the role file is the start state)
  for (const key of [A, B]) {
    const own = readThreads(key).filter((x) => !x.id.startsWith('00000000-'));
    fs.writeFileSync(path.join(THREADS, `${key}.json`), JSON.stringify({ threads: own }));
  }
  fs.writeFileSync(path.join(THREADS, `${ROLE}.json`), JSON.stringify({ threads: fixture }));
}

async function h5(page) {
  writeFixture();
  await restartServer(page); // the repair runs once per process: a fresh one sees the fixture
  const names = (key) => readThreads(key).map((t) => t.name.task);
  for (const [uuid, mine, other] of [
    [A, 'Fixture A', 'Fixture B'],
    [B, 'Fixture B', 'Fixture A'],
  ]) {
    await openAgent(page, uuid);
    await showPanel(page);
    await toList(page);
    await wait(page, 1500);
    const rows = await listedThreads(page);
    check(
      `H-5 ${uuid === A ? 'A' : 'B'} lists ${mine}, not ${other}`,
      rows.some((r) => r.includes(mine)) && !rows.some((r) => r.includes(other)),
      rows.join(' | ')
    );
    await shot(page, `h5-${uuid === A ? 'A' : 'B'}-list`);
  }
  check(
    'H-5 files: each thread in its session file, the unprovable one stays in the role file',
    names(A).includes('Fixture A') &&
      names(B).includes('Fixture B') &&
      JSON.stringify(names(ROLE)) === '["Fixture nowhere"]',
    JSON.stringify({ A: names(A), B: names(B), role: names(ROLE) })
  );
  const before = hashThreads();
  await restartServer(page);
  for (const uuid of [A, B]) {
    await openAgent(page, uuid);
    await showPanel(page);
    await wait(page, 1500);
  }
  check('H-5 second load (new server process) moves nothing', hashThreads() === before);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || undefined,
    headless: true,
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1600, height: 950 } })
  ).newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${BASE}/agents`);
  await wait(page, 5000);
  try {
    if (PHASES.includes('h5')) await h5(page);
    for (const [name, uuid] of ORCHS) {
      const commands = PHASES.includes('h1') ? await h1(page, uuid, name) : [];
      if (PHASES.includes('h2')) await h2(page, uuid, name, commands);
    }
    if (PHASES.includes('h4')) await h4(page);
  } catch (e) {
    fails++;
    console.log(`FAIL aborted: ${e.message.split('\n')[0]}`);
    await shot(page, 'aborted');
  }
  check('no console errors', errors.length === 0, errors.slice(0, 6).join(' || '));
  await browser.close();
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
