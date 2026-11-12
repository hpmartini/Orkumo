/* global localStorage */
// #212 e2e: real app, real shell panes (/api/pty), real HTML5 drag and drop. Starts from a
// workspace stored in the flat shape before the split tree (AC-4), drops a tab below pane A
// (AC-1/2/6), drags a browser pane onto the tab strip (AC-5) and reloads.
// Usage: NODE_PATH=<dir with playwright> node scripts/review/212-e2e.cjs <baseUrl> <outDir> <dir with A B C D> <browserUrl>
const { chromium } = require('playwright');
const fs = require('fs');
const [base, out, dirs, browserUrl] = process.argv.slice(2);
const root = fs.realpathSync(dirs);
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const shell = (n, name) => `shell:${n}:${root}/${name}`;
const BROWSER = `browser:1:${browserUrl}`;
const STORED = {
  tabs: [
    {
      id: 't1',
      panes: [shell(1, 'A'), shell(2, 'B')],
      layout: 'columns',
      activeSessionId: shell(1, 'A'),
    },
    { id: 't2', panes: [shell(3, 'C')], layout: 'single', activeSessionId: shell(3, 'C') },
    {
      id: 't3',
      panes: [shell(4, 'D'), BROWSER],
      layout: 'columns',
      activeSessionId: shell(4, 'D'),
    },
  ],
  activeTabId: 't1',
};
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({
    viewport: { width: 1600, height: 900 },
    recordVideo: { dir: out, size: { width: 1600, height: 900 } },
  });
  await ctx.addInitScript((stored) => {
    if (!localStorage.getItem('e2e212')) {
      localStorage.setItem('e2e212', '1');
      localStorage.setItem('devOrbitAgentWorkspace.v2', JSON.stringify(stored));
    }
  }, STORED);
  const p = await ctx.newPage();
  const sockets = [];
  p.on('websocket', (ws) => sockets.push({ url: decodeURIComponent(ws.url()), at: Date.now() }));
  await p.goto(`${base}/agents`, { waitUntil: 'load' });

  const pane = (name) => p.locator(`[data-agent-pane$="/${name}"]`);
  const rect = async (loc) => {
    const r = await loc.boundingBox();
    return (
      r && {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      }
    );
  };
  const strip = p.getByRole('tablist', { name: 'Attached agents' });
  const tabs = () => strip.getByRole('tab').allTextContents();
  const stored = () =>
    p.evaluate(() => JSON.parse(localStorage.getItem('devOrbitAgentWorkspace.v2')));
  const tree = (n) =>
    'pane' in n
      ? n.pane.replace(/^shell:\d+:.*\//, '').replace(/^browser.*/, 'browser')
      : `${n.dir}(${n.children.map(tree).join(',')})`;
  /** Real drag: press on `from`, move to the point in steps (dragover needs several moves), release */
  const drag = async (from, x, y) => {
    const f = await from.boundingBox();
    await p.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
    await p.mouse.down();
    await p.mouse.move(f.x + f.width / 2 + 12, f.y + f.height / 2 + 12, { steps: 4 });
    await p.mouse.move(x, y, { steps: 15 });
    await p.waitForTimeout(250);
    await p.mouse.move(x, y + 1);
    await p.waitForTimeout(250);
    await p.mouse.up();
    await p.waitForTimeout(700);
  };

  // AC-4: the flat shape loads, every tab is there
  await pane('A').waitFor({ timeout: 30000 });
  await pane('B').waitFor();
  await p.waitForTimeout(2500); // shells connect
  check(
    'AC-4 old flat workspace: 3 tabs after load',
    (await tabs()).length === 3,
    (await tabs()).join(' | ')
  );
  const migrated = await stored();
  check(
    'AC-4 stored again as trees',
    migrated.tabs.map((t) => tree(t.root)).join(' ') === 'row(A,B) C row(D,browser)',
    migrated.tabs.map((t) => tree(t.root)).join(' ')
  );
  check('AC-4 active tab kept', migrated.activeTabId === 't1');

  // Resize first: the split must not reset the sizes of panes it does not touch
  const sep = await p.locator('[role="tabpanel"]:visible [role="separator"]').first().boundingBox();
  await p.mouse.move(sep.x + sep.width / 2, sep.y + sep.height / 2);
  await p.mouse.down();
  await p.mouse.move(sep.x + 150, sep.y + sep.height / 2, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(300);
  const body = await rect(p.locator('[role="tabpanel"]:visible'));
  const a0 = await rect(pane('A'));
  const b0 = await rect(pane('B'));
  check('pane B resized by hand before the drop', b0.w < a0.w - 200, `A ${a0.w}px, B ${b0.w}px`);
  console.log(
    `before: body ${JSON.stringify(body)} A ${JSON.stringify(a0)} B ${JSON.stringify(b0)}`
  );
  await p.screenshot({ path: `${out}/212-1-vorher.png` });

  // AC-1: drop tab C on the bottom edge of pane A
  const dropAt = Date.now();
  await drag(strip.getByRole('tab', { name: /C/ }).first(), a0.x + a0.w / 2, a0.y + a0.h - 30);
  await pane('C').waitFor({ timeout: 5000 });
  const a1 = await rect(pane('A'));
  const b1 = await rect(pane('B'));
  const c1 = await rect(pane('C'));
  console.log(`after:  A ${JSON.stringify(a1)} C ${JSON.stringify(c1)} B ${JSON.stringify(b1)}`);
  check(
    'AC-1 tree is row(column(A,C),B)',
    tree((await stored()).tabs[0].root) === 'row(column(A,C),B)',
    tree((await stored()).tabs[0].root)
  );
  check(
    'AC-1 B spans the full tab body height',
    near(b1.h, body.h - 8),
    `B ${b1.h}px, body ${body.h}px - 8px padding`
  );
  check(
    "AC-1 A + C stacked left fill B's height",
    near(a1.h + c1.h + 4, b1.h, 3) && near(a1.x, c1.x) && c1.y > a1.y,
    `A ${a1.h} + C ${c1.h} + 4 separator vs B ${b1.h}`
  );
  check(
    'AC-2 rect of the uninvolved pane B unchanged',
    JSON.stringify(b0) === JSON.stringify(b1),
    `${JSON.stringify(b0)} -> ${JSON.stringify(b1)}`
  );
  // AC-6: B's terminal was not remounted: no new PTY socket for it, and it still answers
  const reopened = sockets
    .filter((s) => s.at > dropAt && s.url.includes('/api/pty'))
    .map((s) => /cwd=([^&]*)/.exec(s.url)?.[1]);
  console.log(
    `pty sockets: ${sockets.filter((s) => s.url.includes('/api/pty')).length} before the drop, after: ${JSON.stringify(reopened)}`
  );
  check(
    'AC-6 no new PTY connection for B (nor A) after the drop',
    !reopened.some((cwd) => /\/[AB]$/.test(cwd || ''))
  );
  await pane('B').locator('.xterm').click();
  await p.keyboard.type('echo "alive-$((6*7))"\n', { delay: 15 });
  await p.waitForFunction(
    (el) => /alive-42/.test(el.textContent || ''),
    await pane('B').elementHandle(),
    { timeout: 10000 }
  );
  check('AC-6 B still answers on its old shell', true);
  await p.screenshot({ path: `${out}/212-2-nach-drop.png` });

  // AC-5: browser pane header onto the empty end of the tab strip
  await strip.getByRole('tab', { name: /D/ }).first().click();
  await pane('D').waitFor();
  const browserHandle = p
    .locator('[role="tabpanel"]:visible [draggable="true"]:not([data-agent-pane] *)')
    .first();
  const end = await strip.locator('> div:last-child').boundingBox();
  await drag(browserHandle, end.x + end.width - 40, end.y + end.height / 2);
  const afterDetach = await stored();
  check(
    'AC-5 browser pane is its own, active tab',
    afterDetach.tabs.map((t) => tree(t.root)).join(' ') === 'row(column(A,C),B) D browser' &&
      tree(afterDetach.tabs.find((t) => t.id === afterDetach.activeTabId).root) === 'browser',
    afterDetach.tabs.map((t) => tree(t.root)).join(' ')
  );
  check(
    'AC-5 its tab shows in the strip',
    (await tabs()).length === 3 &&
      (await strip.getByRole('tab', { selected: true }).textContent()).includes(
        new URL(browserUrl).host
      ),
    (await tabs()).join(' | ')
  );
  await p.screenshot({ path: `${out}/212-3-browser-tab.png` });

  await p.reload({ waitUntil: 'load' });
  await strip.getByRole('tab').first().waitFor({ timeout: 30000 });
  await p.waitForTimeout(2000);
  check(
    'AC-5 browser tab still there after reload',
    (await tabs()).length === 3 &&
      (await strip.getByRole('tab', { selected: true }).textContent()).includes(
        new URL(browserUrl).host
      ),
    (await tabs()).join(' | ')
  );
  await strip.getByRole('tab').first().click();
  await pane('B').waitFor();
  await p.waitForTimeout(500);
  const b2 = await rect(pane('B'));
  check(
    'AC-4 nested layout survives the reload',
    near(b2.h, body.h - 8) && tree((await stored()).tabs[0].root) === 'row(column(A,C),B)',
    `B ${JSON.stringify(b2)}`
  );
  await p.screenshot({ path: `${out}/212-4-nach-reload.png` });

  await ctx.close();
  await b.close();
  const video = fs.readdirSync(out).find((f) => f.endsWith('.webm'));
  if (video) fs.renameSync(`${out}/${video}`, `${out}/flow.webm`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
