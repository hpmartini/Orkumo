/* global location, performance */
// #280 chat history e2e against the packaged app: import the invented exports of both
// providers by folder, count, search, filter, group by topic, read, continue as an Orkumo chat;
// then 5 000 generated conversations for the search time, cold (after a restart) and warm.
// Usage: NODE_PATH=<dir with playwright> node scripts/review/280-e2e.cjs <Orkumo binary> <outDir> <home> <port>
const { _electron } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const [bin, out, home, port] = process.argv.slice(2);
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const api = `http://localhost:${port}/api/chat-history`;
let log = '';

async function launch() {
  const env = {
    ...process.env,
    HOME: home,
    CFFIXED_USER_HOME: home, // own userData: the installed app's single-instance lock stays untouched
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    CLAUDE_CLI_PATH: path.resolve(__dirname, '../../test/fixtures/fake-gh/claude'),
    SERVER_PORT: port,
    DEVHUB_PREMIUM_DIR: path.join(home, 'no-modules'),
    ORKUMO_DISABLE_UPDATES: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: bin, env });
  for (const stream of [app.process().stdout, app.process().stderr])
    stream.on('data', (chunk) => (log += chunk));
  const main = await app.firstWindow();
  await main.getByRole('group', { name: 'Mode' }).waitFor({ timeout: 60000 });
  return { app, main };
}
async function quit(app) {
  await Promise.race([app.close(), new Promise((r) => setTimeout(r, 10000))]);
  try {
    app.process().kill('SIGKILL');
  } catch {
    // already gone
  }
  // the app's server child outlives the killed app; a restart must not find the old one
  execSync(`lsof -ti tcp:${port} -sTCP:LISTEN | xargs kill 2>/dev/null || true`, {
    shell: '/bin/bash',
  });
  await new Promise((r) => setTimeout(r, 1500));
}
const timedSearch = (main, word) =>
  main.evaluate(
    async ([url, q]) => {
      const start = performance.now();
      const result = await (await fetch(`${url}?q=${q}`)).json();
      return {
        ms: Math.round(performance.now() - start),
        total: result.total,
        server: result.tookMs,
      };
    },
    [api, word]
  );

(async () => {
  const exportDir = path.join(home, 'Downloads', 'exports');
  fs.cpSync(path.resolve(__dirname, '../../test/fixtures/chat-exports'), exportDir, {
    recursive: true,
  });
  let { app, main } = await launch();
  try {
    const view = main.locator('[data-chat-history]');
    const rows = view.locator('ul.divide-y button');
    await main.getByRole('group', { name: 'Mode' }).getByTitle('Chats').click();
    await view.getByText('No chats imported yet.').waitFor({ timeout: 20000 });
    check('Chats mode opens, empty state names both export paths', true);

    // AC-1: both exports from one folder, counted
    await view.getByLabel('Folder of the unpacked export').fill('~/Downloads/exports');
    await view.getByRole('button', { name: 'Import' }).click();
    const report = view.getByRole('list', { name: 'Import result' });
    await report.waitFor({ timeout: 20000 });
    const lines = await report.locator('li').allTextContents();
    check(
      'AC-1 import report per file: found, imported, skipped',
      lines.length === 2 &&
        lines.some((l) => /\(Claude\): 3 of 4 imported, skipped: 1 no messages/.test(l)) &&
        lines.some((l) => /\(ChatGPT\): 3 of 4 imported, skipped: 1 no messages/.test(l)),
      lines.join(' | ')
    );
    await view.getByTestId('chat-counts').getByText('6 shown · Claude 3 · ChatGPT 3').waitFor();
    check('AC-1 counts in the view: Claude 3, ChatGPT 3', true);
    const titles = await rows.evaluateAll((els) =>
      els.map((el) => el.querySelector('.truncate').textContent)
    );
    check(
      'AC-3 sorted by last activity (Mar, Feb, 7 Jan, 6 Jan, …)',
      titles.slice(0, 4).join(' | ') ===
        'Nenne eine Brot Sorte aus Norddeutschland | Fahrrad Kette wechseln | Zeig mir ein Bild von einem Zebra | Fahrrad Reifen flicken',
      titles.join(' | ')
    );
    await view.screenshot({ path: path.join(out, '280-1-liste.png') });

    // Search: a word that only occurs inside an answer
    await view.getByLabel('Search chats').fill('stockgare');
    await view.getByText('1 shown').waitFor({ timeout: 10000 });
    check(
      'search finds the conversation by a word from a message',
      (await rows.first().textContent()).includes('Sauerteig Brot backen'),
      await rows.first().textContent()
    );
    await view.screenshot({ path: path.join(out, '280-2-suche.png') });
    await view.getByLabel('Search chats').fill('');

    // AC-3: provider, project, period
    await view.getByLabel('Provider').selectOption('chatgpt');
    await view.getByText('3 shown').waitFor({ timeout: 10000 });
    check('AC-3 provider filter: 3 ChatGPT chats', (await rows.count()) === 3);
    await view.getByLabel('Project').selectOption({ index: 1 });
    await view.getByText('1 shown').waitFor({ timeout: 10000 });
    check(
      'AC-3 project filter (ChatGPT project gizmo)',
      (await rows.first().textContent()).includes('Fahrrad Reifen flicken')
    );
    await view.screenshot({ path: path.join(out, '280-3-filter.png') });
    await view.getByLabel('Project').selectOption('');
    await view.getByLabel('Provider').selectOption('');
    await view.getByLabel('Active from').fill('2026-02-01');
    await view.getByLabel('Active until').fill('2026-02-28');
    await view.getByText('1 shown').waitFor({ timeout: 10000 });
    check(
      'AC-3 period filter: February 2026',
      (await rows.first().textContent()).includes('Fahrrad Kette wechseln')
    );
    await view.getByLabel('Active from').fill('');
    await view.getByLabel('Active until').fill('');
    await view.getByText('6 shown').waitFor({ timeout: 10000 });

    // AC-4: topics, computed in the server process
    await view.getByLabel('Group by topic').check();
    const bread = await view.getByRole('region', { name: 'brot' }).locator('button').count();
    const bike = await view.getByRole('region', { name: 'fahrrad' }).locator('button').count();
    check(
      'AC-4 grouped by topic: brot 3, fahrrad 2',
      bread === 3 && bike === 2,
      `${bread}/${bike}`
    );
    await view.screenshot({ path: path.join(out, '280-4-themen.png') });

    // Read and continue
    await rows.filter({ hasText: 'Brot ohne Hefe' }).click();
    await view.getByText('Ja, mit Backpulver oder Sauerteig; Stichwort Sodabrot.').waitFor();
    check(
      'conversation opens: current branch only',
      (await view.getByText('Verworfene Fassung').count()) === 0
    );
    await view.screenshot({ path: path.join(out, '280-5-verlauf.png') });
    await view.getByRole('button', { name: /Continue in Orkumo/ }).click();
    await main
      .getByText(/We continue a conversation from ChatGPT/)
      .first()
      .waitFor({ timeout: 15000 });
    check(
      '"Continue in Orkumo" opens the chat composer with the conversation',
      (await main.evaluate(() => location.hash)) === '#/agents'
    );
    await main.screenshot({ path: path.join(out, '280-6-fortsetzen.png') });

    // AC-2: 5 000 conversations
    const filler =
      'lorem ipsum dolor sit amet consetetur sadipscing elitr sed diam nonumy eirmod '.repeat(40);
    const bigDir = path.join(home, 'Downloads', 'gross');
    fs.mkdirSync(bigDir, { recursive: true });
    fs.writeFileSync(
      path.join(bigDir, 'conversations.json'),
      JSON.stringify(
        Array.from({ length: 5000 }, (_, n) => ({
          uuid: `gen-${n}`,
          name: `Verlauf ${n}`,
          updated_at: new Date(1.7e12 + n * 60000).toISOString(),
          chat_messages: Array.from({ length: 6 }, (_, m) => ({
            sender: m % 2 ? 'assistant' : 'human',
            text: filler + (n === 3210 && m === 5 ? ' quittenmarmelade' : ''),
          })),
        }))
      )
    );
    const imported = await main.evaluate(
      async ([url, dir]) =>
        (
          await fetch(`${url}/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: dir }),
          })
        ).json(),
      [api, bigDir]
    );
    check('5 000 generated conversations imported', imported.counts.claude === 5003);
    const store = execSync(`find "${home}/Library" -name conversations.jsonl`).toString().trim();
    const storeMb = (fs.statSync(store).size / 1e6).toFixed(1);
    await quit(app);
    ({ app, main } = await launch());
    const cold = await timedSearch(main, 'quittenmarmelade');
    const warm = await timedSearch(main, 'quittenmarmelade');
    check(
      `AC-2 search over 5 006 conversations (${storeMb} MB store), word from one message, < 1 s`,
      cold.total === 1 && warm.total === 1 && cold.ms < 1000 && warm.ms < 1000,
      `cold after restart ${cold.ms} ms (server ${cold.server} ms), warm ${warm.ms} ms (server ${warm.server} ms)`
    );
    await main.getByRole('group', { name: 'Mode' }).getByTitle('Chats').click();
    const view2 = main.locator('[data-chat-history]');
    await view2.getByText('5006 shown').waitFor({ timeout: 20000 });
    const typed = Date.now();
    await view2.getByLabel('Search chats').fill('quittenmarmelade');
    await view2.getByText('Verlauf 3210').waitFor({ timeout: 10000 });
    check(
      'AC-2 in the view: typed word to visible hit',
      Date.now() - typed < 1000,
      `${Date.now() - typed} ms`
    );
    await view2.screenshot({ path: path.join(out, '280-7-5000.png') });

    // AC-5 / privacy: no conversation text in the app's output
    check(
      'no conversation content in the app log',
      !/stockgare|sodabrot|quittenmarmelade|Sauerteig/i.test(log),
      `${log.length} bytes of log checked`
    );
  } finally {
    await quit(app);
  }
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
