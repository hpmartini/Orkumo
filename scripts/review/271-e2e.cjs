// #271 e2e: switch Task/Agent/Chat/Issue inside the open dialog; the draft moves along.
// Usage: NODE_PATH=<dir with playwright> node scripts/review/271-e2e.cjs <baseUrl> <outDir>
const { chromium } = require('playwright');
const [base, out] = process.argv.slice(2);
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(`${base}/agents`, { waitUntil: 'load' });
  await p.getByRole('button', { name: /New task/ }).first().click();
  const dialog = p.getByRole('dialog');
  const heading = () => dialog.getByRole('heading').innerText();
  const selected = () => dialog.getByRole('tab', { selected: true }).innerText();
  const tab = (name) => dialog.getByRole('tab', { name });
  await dialog.waitFor();
  check('New task opens with Task selected', (await heading()) === 'New task' && (await selected()) === 'Task');
  await dialog.locator('textarea').fill('Login reparieren\n\nSchritte:\n1. öffnen');
  await p.screenshot({ path: `${out}/1-task.png` });

  await tab('Agent').click();
  check('-> Agent keeps the text', (await heading()) === 'New agent' && (await dialog.locator('textarea').inputValue()).startsWith('Login reparieren'));
  check('Agent has its own action', await dialog.getByRole('button', { name: 'Start agent' }).isVisible());
  await tab('Chat').click();
  check('-> Chat keeps the text', (await heading()) === 'New chat' && (await dialog.locator('textarea').inputValue()).startsWith('Login reparieren'));
  await p.screenshot({ path: `${out}/2-chat.png` });

  await tab('Issue').click();
  await dialog.getByLabel('Titel').waitFor();
  check('-> Issue: first line is the title', (await dialog.getByLabel('Titel').inputValue()) === 'Login reparieren');
  check('-> Issue: the rest is the description', (await dialog.getByLabel('Beschreibung').inputValue()) === 'Schritte:\n1. öffnen');
  check('Issue is selected', (await heading()) === 'Neues Issue' && (await selected()) === 'Issue');
  check('only one dialog is open', (await p.getByRole('dialog').count()) === 1);
  await p.screenshot({ path: `${out}/3-issue.png` });

  await dialog.getByLabel('Titel').fill('Logout reparieren');
  await tab('Task').click();
  await dialog.locator('textarea').waitFor();
  check('-> Task: edited title and description come back', (await dialog.locator('textarea').inputValue()) === 'Logout reparieren\n\nSchritte:\n1. öffnen', JSON.stringify(await dialog.locator('textarea').inputValue()));
  check('Task is selected again', (await heading()) === 'New task' && (await selected()) === 'Task');
  await p.screenshot({ path: `${out}/4-back-to-task.png` });

  // the menu entry "New issue" leads to the same switch
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: /More: new agent/ }).click();
  await p.getByRole('menuitem', { name: /New issue/ }).click();
  check('New issue from the menu offers the switch', (await selected()) === 'Issue');
  await tab('Chat').click();
  check('Issue -> Chat', (await heading()) === 'New chat');

  await b.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
