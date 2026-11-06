/* global document */
// #207 e2e: real app, real rail menus, real /api/pty shell. Right-click a project group and a
// session row, type into the opened shell, check `pwd -P`, close the pane and check the shell died.
// Usage: NODE_PATH=<dir with playwright> node scripts/review/207-e2e.cjs <baseUrl> <outDir> <projectDir> <worktreeDir>
const { chromium } = require('playwright');
const fs = require('fs');
const [base, out, projectDir, worktreeDir] = process.argv.slice(2);
const root = fs.realpathSync(projectDir);
const wt = fs.realpathSync(worktreeDir);
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({
    viewport: { width: 1400, height: 860 },
    recordVideo: { dir: out, size: { width: 1400, height: 860 } },
  });
  const p = await ctx.newPage();
  await p.goto(`${base}/agents`, { waitUntil: 'load' });
  const row = p.getByText('e2e-worker', { exact: true }).first();
  await row.waitFor({ timeout: 90000 });
  await p.waitForTimeout(1500); // contexts (repo root of the worktree) load after the list

  /** Open the shell from `target`'s context menu, run `pwd -P`, return { cwd, pid, pane } */
  const openShellFrom = async (target, shot) => {
    const before = await p.locator('[data-agent-pane^="shell:"]').count();
    await target.click({ button: 'right' });
    const item = p.getByRole('menuitem', { name: 'Open terminal here' });
    await item.waitFor();
    if (shot) await p.screenshot({ path: `${out}/${shot}-menu.png` });
    await p.waitForTimeout(400);
    await item.click();
    const pane = p.locator('[data-agent-pane^="shell:"]').nth(before);
    await pane.waitFor();
    const xterm = pane.locator('.xterm');
    // ready = the server's "connected" banner (`# <shell> in <cwd> (PID n)`) plus a prompt
    await p.waitForFunction(
      (el) => /\(PID \d+\)/.test(el.textContent || ''),
      await xterm.elementHandle(),
      { timeout: 15000 }
    );
    await p.waitForTimeout(800);
    await xterm.click();
    await p.keyboard.type('echo "<<$(pwd -P)>>" "[[$$]]"\n', { delay: 15 });
    await p.waitForFunction((el) => /\[\[\d+\]\]/.test(el.textContent || ''), await xterm.elementHandle(), {
      timeout: 10000,
    });
    await p.waitForTimeout(300);
    const text = await xterm.evaluate((el) =>
      Array.from(el.querySelectorAll('.xterm-rows > div'))
        .map((d) => d.textContent)
        .join('') // rows joined without a break, so a wrapped long path stays whole
    );
    if (shot) await p.screenshot({ path: `${out}/${shot}-shell.png` });
    // markers only match the output: the typed command still shows `$(pwd -P)` and `$$`
    const cwd = /<<(\/[^>]*)>>/.exec(text)?.[1]?.trim() ?? null;
    const pid = Number(/\[\[(\d+)\]\]/.exec(text)?.[1] ?? 0);
    return { cwd, pid, pane, id: await pane.getAttribute('data-agent-pane') };
  };

  // AC-1: project group header (project grouping: the group is the repo's main checkout)
  const headers = p.locator('[role="option"]').filter({
    has: p.locator('button[aria-label^="Collapse "], button[aria-label^="Expand "]'),
  });
  const header = headers.filter({ hasText: /e2e207-proj/ }).first();
  const g = await openShellFrom(header, 'ac1');
  check('AC-1 group menu opens a shell in the project folder', g.cwd === root, `pwd=${g.cwd} want=${root}`);

  // AC-4: closing the pane ends the shell
  check('AC-4 shell alive while the pane is open', g.pid > 0 && alive(g.pid), `pid=${g.pid}`);
  await g.pane.getByRole('button', { name: /^Close / }).click();
  await p.waitForTimeout(1500);
  check('AC-4 closing the pane kills the shell', g.pid > 0 && !alive(g.pid), `pid=${g.pid}`);

  // AC-2: session row in a linked worktree opens there, not in the project root
  const s = await openShellFrom(row, 'ac2');
  check('AC-2 session menu opens a shell in the session worktree', s.cwd === wt, `pwd=${s.cwd} want=${wt}`);
  check('AC-2 not the project root', s.cwd !== root);
  await s.pane.getByRole('button', { name: /^Close / }).click();
  await p.waitForTimeout(1000);
  check('AC-4 second shell also ends on close', !alive(s.pid), `pid=${s.pid}`);

  const video = p.video();
  await ctx.close();
  if (video) fs.renameSync(await video.path(), `${out}/flow.webm`);
  await b.close();
  console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
  process.exit(fails ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
