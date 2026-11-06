// #236 e2e: real app, real rail, real /api/pty. The claude stub lists one respawned background
// job and two processes on its transcripts, and logs every argv it is started with.
// Usage: NODE_PATH=<dir with playwright> node scripts/review/236-e2e.cjs <baseUrl> <outDir> <argvLog>
const { chromium } = require('playwright');
const fs = require('fs');
const [base, out, argvLog] = process.argv.slice(2);
const JOB = 'fa4e0236';
const NAME = 'MACC demo-landing#10';
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
/** argv lines the stub logged after `from` (agents/--version polls left out) */
const calls = (from = 0) =>
  fs
    .readFileSync(argvLog, 'utf8')
    .split('\n')
    .slice(from)
    .filter((l) => l && !/^(agents|--version|daemon|logs)\b/.test(l));
const mark = () => fs.readFileSync(argvLog, 'utf8').split('\n').length - 1;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({
    viewport: { width: 1400, height: 860 },
    recordVideo: { dir: out, size: { width: 1400, height: 860 } },
  });
  const p = await ctx.newPage();
  await p.goto(`${base}/agents`, { waitUntil: 'load' });
  const rows = p.locator('[role="option"]').filter({ hasText: NAME });
  await rows.first().waitFor({ timeout: 90000 });
  await p.waitForTimeout(1500);

  // AC-4: one row for the job and its two copies
  const rowCount = await rows.count();
  const badge = rows.first().getByTestId('copy-badge');
  const badgeText = (await badge.count()) ? await badge.textContent() : null;
  check('AC-4 one rail row for job + 2 copies', rowCount === 1, `rows=${rowCount}`);
  check('AC-4 row marks the copies', /\+2 copies/.test(badgeText || ''), `badge=${badgeText}`);
  await p.screenshot({ path: `${out}/rail-desktop.png` });

  // AC-1/AC-2: open the job with the default settings (agentOpenView: chat)
  const before = mark();
  await rows.first().dblclick();
  const pane = p.locator(`[data-agent-pane="${JOB}"]`);
  await pane.waitFor({ timeout: 15000 });
  await p.waitForTimeout(3000);
  await p.waitForFunction(
    (el) => /attached fa4e0236/.test(el.textContent || ''),
    await pane.locator('.xterm').elementHandle(),
    { timeout: 15000 }
  );
  await p.waitForTimeout(800);
  const opened = calls(before);
  check(
    'AC-1 open runs `claude attach fa4e0236`',
    opened.some((l) => l === `attach ${JOB}`),
    JSON.stringify(opened)
  );
  check(
    'AC-1 no --resume / -p (no new process on the session)',
    !opened.some((l) => /--resume|(^| )-p( |$)/.test(l))
  );
  check('AC-2 the job is not stopped', !opened.some((l) => /^stop\b/.test(l)));
  const tabId = await p.getByTestId('tab-session-id').first().textContent();
  check('AC-5 tab shows the session id', tabId === JOB, `tab=${tabId}`);
  await p.screenshot({ path: `${out}/tab-attached-desktop.png` });

  // AC-5: opening it again focuses the tab, no second process
  const again = mark();
  await rows.first().dblclick();
  await p.waitForTimeout(1200);
  const tabs = await p.getByTestId('tab-session-id').filter({ hasText: JOB }).count();
  check('AC-5 second open: still one tab', tabs === 1, `tabs=${tabs}`);
  check(
    'AC-5 second open: no new claude process',
    calls(again).length === 0,
    JSON.stringify(calls(again))
  );

  // AC-3: "Open as chat" on a background job warns first; Cancel starts nothing
  const openAsChat = async () => {
    const direct = pane.getByTitle(/^Open as chat/);
    if (await direct.count()) return direct.first().click();
    await pane.getByRole('button', { name: /more/i }).first().click();
    await p.getByRole('menuitem', { name: /Open as chat/ }).click();
  };
  const cancelMark = mark();
  await openAsChat();
  const dialog = p.getByRole('alertdialog');
  await dialog.waitFor({ timeout: 5000 });
  check('AC-3 warning dialog "Erzeugt Kopie"', /Erzeugt Kopie/.test(await dialog.textContent()));
  await p.screenshot({ path: `${out}/copy-warning-desktop.png` });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await p.waitForTimeout(1200);
  check(
    'AC-3 Cancel starts no process and stops nothing',
    calls(cancelMark).length === 0,
    JSON.stringify(calls(cancelMark))
  );

  // Confirm: exactly one chat process, on the transcript the job writes now
  const okMark = mark();
  await openAsChat();
  await p.getByRole('alertdialog').getByRole('button', { name: 'Create copy' }).click();
  await p.waitForTimeout(2500);
  const confirmed = calls(okMark);
  const chats = confirmed.filter((l) => /(^| )-p( |$)/.test(l));
  check(
    'AC-3 confirm starts one chat on the current transcript',
    chats.length === 1 && chats[0].includes('--resume b0b00236-0000-4000-8000-000000000002'),
    JSON.stringify(confirmed)
  );

  // AC-3: "Open in terminal" on that chat warns as well; Cancel starts nothing, confirm one resume
  const toTerminal = () => p.getByRole('button', { name: 'Open in terminal' }).last().click();
  await p.getByRole('button', { name: 'Open in terminal' }).last().waitFor({ timeout: 15000 });
  const termCancel = mark();
  await toTerminal();
  const termDialog = p.getByRole('alertdialog');
  await termDialog.waitFor({ timeout: 5000 });
  check(
    'AC-3 chat → terminal warns "Erzeugt Kopie"',
    /Erzeugt Kopie/.test(await termDialog.textContent())
  );
  await termDialog.getByRole('button', { name: 'Cancel' }).click();
  await p.waitForTimeout(1200);
  check(
    'AC-3 chat → terminal Cancel starts nothing',
    calls(termCancel).length === 0,
    JSON.stringify(calls(termCancel))
  );
  const termOk = mark();
  await toTerminal();
  await p.getByRole('alertdialog').getByRole('button', { name: 'Create copy' }).click();
  await p.waitForTimeout(2500);
  const resumed = calls(termOk).filter((l) => /^--resume b0b00236/.test(l));
  check(
    'AC-3 chat → terminal confirm: exactly one `claude --resume`',
    resumed.length === 1,
    JSON.stringify(calls(termOk))
  );

  // Mobile width: rail with the copy badge
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(`${base}/agents`, { waitUntil: 'load' });
  await m.locator('[role="option"]').filter({ hasText: NAME }).first().waitFor({ timeout: 60000 });
  await m.waitForTimeout(1200);
  await m.screenshot({ path: `${out}/rail-mobile.png` });
  await m.close();

  await ctx.close();
  await b.close();
  const video = fs.readdirSync(out).find((f) => f.endsWith('.webm'));
  if (video) fs.renameSync(`${out}/${video}`, `${out}/flow.webm`);
  console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
  process.exit(fails ? 1 : 0);
})().catch((err) => {
  console.error(err);
  console.error(
    'argv log:\n' +
      fs
        .readFileSync(argvLog, 'utf8')
        .split('\n')
        .filter((l) => !/^agents/.test(l))
        .join('\n')
  );
  process.exit(1);
});
