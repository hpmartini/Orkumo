// #220 e2e: instance A (mesh module, peer B by manual URL) and C (no module) in Chromium; every
// claude call of A and B lands in their own argv log, so the run proves where each action ran.
// Usage: NODE_PATH=<dir with playwright> node scripts/review/220-e2e.cjs <urlA> <urlC> <apiB> <tmp> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const [urlA, urlC, apiB, tmp, out] = process.argv.slice(2);
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
/** argv lines of an instance's stub, without the list polls */
const calls = (inst) =>
  fs
    .readFileSync(`${tmp}/${inst}/argv.log`, 'utf8')
    .split('\n')
    .filter((l) => l && !/^(agents|--version|daemon)\b/.test(l));
const rowOf = (p, name) => p.locator('[role="option"]').filter({ hasText: name });
const until = async (fn, ms = 15000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 250)))
    if (await fn()) return true;
  return false;
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({
    viewport: { width: 1400, height: 860 },
    recordVideo: { dir: out, size: { width: 1400, height: 860 } },
  });
  const p = await ctx.newPage();
  try {
    await p.goto(`${urlA}/agents`, { waitUntil: 'load' });
    await rowOf(p, 'Lokale Sitzung A').first().waitFor({ timeout: 90000 });
    // A local tab opened before the switch must survive A -> B -> A (no prune on a stale list)
    await rowOf(p, 'Lokale Sitzung A').first().dblclick();
    await p.locator('[data-agent-pane="local-a1"]').waitFor({ timeout: 15000 });
    const picker = p.getByTestId('mesh-picker');
    await picker.waitFor({ timeout: 15000 });
    check('AC-1 picker at the Agents label', /Dieser Rechner/.test(await picker.textContent()));
    await picker.click();
    await p.locator('[data-peer="peer-b"]').waitFor({ timeout: 10000 });
    await p.screenshot({ path: `${out}/picker-open.png` });

    // AC-1: switching lists exactly B's sessions
    await p.locator('[data-peer="peer-b"]').click();
    await rowOf(p, 'Peer-Sitzung B1').first().waitFor({ timeout: 15000 });
    await p.waitForTimeout(1500);
    const peerNames = (await (await fetch(`${apiB}/api/agents`)).json()).sessions.map(
      (s) => s.name
    );
    const listed = await p.locator('[role="option"]').allTextContents();
    check(
      'AC-1 list = GET /api/agents of B',
      peerNames.every((n) => listed.some((t) => t.includes(n))) &&
        !listed.some((t) => t.includes('Lokale Sitzung A')),
      `B=${JSON.stringify(peerNames)}`
    );
    check('AC-1 picker shows the peer', /Peer-B/.test(await picker.textContent()));
    await p.screenshot({ path: `${out}/peer-sessions.png` });

    // AC-2: attach; input goes through A's server to B's PTY
    await rowOf(p, 'Peer-Sitzung B1').first().dblclick();
    const pane = p.locator('[data-agent-pane="peer-b1"]');
    await pane.waitFor({ timeout: 15000 });
    const term = pane.locator('.xterm');
    check(
      'AC-2 attach runs on B',
      await until(async () => /attached peer-b1 on peer-b/.test((await term.textContent()) || '')),
      JSON.stringify(calls('peer-b').filter((l) => l.startsWith('attach')))
    );
    await term.click();
    await p.keyboard.type('hallo mesh');
    await p.keyboard.press('Enter');
    check(
      'AC-2 terminal input reaches the PTY on B',
      await until(async () => /peer-b got: hallo mesh/.test((await term.textContent()) || ''))
    );
    check('AC-2 nothing attached locally', !calls('local-a').includes('attach peer-b1'));
    await p.screenshot({ path: `${out}/peer-terminal.png` });

    // AC-4: peek (logs) of a peer session through the relay
    const b2 = rowOf(p, 'Peer-Sitzung B2').first();
    await b2.hover();
    await b2.getByRole('button', { name: 'Peek' }).click();
    check(
      'AC-4 peek shows B logs',
      await until(async () => (await p.getByText('log of peer-b2 on peer-b').count()) > 0)
    );
    await p.screenshot({ path: `${out}/peer-peek.png` });
    await p.keyboard.press('Escape');

    // AC-3: dispatch, stop and respawn act on B
    await p
      .getByRole('button', { name: /New task/ })
      .first()
      .click();
    const task = p.getByLabel('Task description');
    await task.fill('Remote-Auftrag 220');
    await task.press('Enter');
    const dispatched = () =>
      calls('peer-b').some((l) => l.startsWith('--bg') && l.includes('Remote-Auftrag 220'));
    if (!(await until(async () => dispatched(), 3000))) await task.press('ControlOrMeta+Enter');
    check(
      'AC-3 dispatch runs on B',
      await until(async () => dispatched()),
      JSON.stringify(calls('peer-b').filter((l) => l.startsWith('--bg')))
    );
    await rowOf(p, 'Remote-Auftrag 220').first().waitFor({ timeout: 15000 });
    for (const [label, argv] of [
      ['Stop', 'stop peer-b2'],
      ['Respawn (restart)', 'respawn peer-b2'],
    ]) {
      await rowOf(p, 'Peer-Sitzung B2').first().click({ button: 'right' });
      await p.getByRole('menuitem', { name: label }).click();
      check(
        `AC-3 ${label} runs on B`,
        await until(async () => calls('peer-b').includes(argv)),
        argv
      );
    }
    check(
      'AC-3 nothing of it ran locally',
      !calls('local-a').some((l) => /^(--bg|stop|respawn)\b/.test(l)),
      JSON.stringify(calls('local-a'))
    );

    // AC-4: chat on B (SSE stream through the relay)
    await p
      .getByRole('button', { name: /^\+?\s*Chat$/ })
      .first()
      .click();
    const first = p.getByLabel('Task description');
    await first.fill('ping');
    await p.getByRole('button', { name: 'Start chat' }).click();
    check(
      'AC-4 chat answer streams from B',
      await until(async () => (await p.getByText('pong from peer-b').count()) > 0, 20000),
      JSON.stringify(calls('peer-b').filter((l) => l.startsWith('-p')))
    );
    check('AC-4 no chat started locally', !calls('local-a').some((l) => l.startsWith('-p')));
    await p.screenshot({ path: `${out}/peer-chat.png` });

    // AC-5: back to this machine; the peer tab stays and nothing re-attaches
    const attaches = calls('peer-b').filter((l) => l === 'attach peer-b1').length;
    await picker.click();
    await p.locator('[data-peer="self"]').click();
    await rowOf(p, 'Lokale Sitzung A').first().waitFor({ timeout: 15000 });
    await p.waitForTimeout(1500);
    check('AC-5 peer tab still open', (await p.locator('[data-agent-pane="peer-b1"]').count()) > 0);
    check(
      'AC-5 local tab survived A -> B -> A',
      (await p.locator('[data-agent-pane="local-a1"]').count()) > 0
    );
    check(
      'AC-5 no re-attach on switch',
      calls('peer-b').filter((l) => l === 'attach peer-b1').length === attaches,
      `attaches=${attaches}`
    );
    const tab = p.locator('[data-agent-pane="peer-b1"]');
    await p
      .getByRole('tab', { name: /Peer-Sitzung B1/ })
      .first()
      .click();
    if (await tab.locator('.xterm').count()) {
      await tab.locator('.xterm').click();
      await p.keyboard.type('noch da');
      await p.keyboard.press('Enter');
      check(
        'AC-5 peer tab still talks to B',
        await until(async () => /peer-b got: noch da/.test((await tab.textContent()) || ''))
      );
    }
    await p.screenshot({ path: `${out}/back-local.png` });
  } catch (error) {
    check('e2e A ran through', false, error.message);
    await p.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  }
  await p.close();
  const video = await p.video()?.path();
  if (video) fs.renameSync(video, `${out}/flow.webm`);

  // AC-6: without the module there is no picker, the list is the local one
  const c = await (await b.newContext({ viewport: { width: 1400, height: 860 } })).newPage();
  await c.goto(`${urlC}/agents`, { waitUntil: 'load' });
  await rowOf(c, 'Sitzung ohne Modul').first().waitFor({ timeout: 90000 });
  await c.waitForTimeout(1500);
  check('AC-6 no picker without the module', (await c.getByTestId('mesh-picker').count()) === 0);
  await c.screenshot({ path: `${out}/no-module.png` });
  await b.close();
  console.log(fails ? `${fails} FAIL` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
