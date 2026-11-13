/* DevHub-pro#8 against the packaged app: started with ORKUMO_REMOTE it runs no server of its own, shows the
   remote server's project and agent and opens a terminal on that server; a wrong token gets nothing.
   Usage: NODE_PATH=<dir with playwright> node scripts/review/pro8-app-e2e.cjs <Orkumo binary> <outDir> <home> <server port> <token> <mark> <unused port> */
const { _electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const [bin, out, home, port, token, mark, ownPort] = process.argv.slice(2);
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};
const listening = (p) =>
  new Promise((resolve) => {
    const s = net.connect(Number(p), '127.0.0.1');
    s.on('connect', () => (s.destroy(), resolve(true)));
    s.on('error', () => resolve(false));
  });
// Stand-in for `tailscale serve`: relays to the server and marks the request as forwarded, so the
// server treats the app as a remote client and checks the token on every request and upgrade.
const FORWARDED = { 'x-forwarded-for': '100.64.0.7' };
const relay = http.createServer((req, res) => {
  const up = http.request(
    {
      host: '127.0.0.1',
      port,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, ...FORWARDED },
    },
    (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    }
  );
  up.on('error', () => res.destroy());
  req.pipe(up);
});
relay.on('upgrade', (req, socket, head) => {
  const up = net.connect(Number(port), '127.0.0.1', () => {
    const headers = Object.entries({ ...req.headers, ...FORWARDED }).map(
      ([k, v]) => `${k}: ${v}\r\n`
    );
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers.join('')}\r\n`);
    up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});
let relayPort;

const launch = (name, linkToken) => {
  const h = path.join(home, name);
  fs.mkdirSync(h, { recursive: true });
  const link = `devorbit://pair?${new URLSearchParams({ url: `http://127.0.0.1:${relayPort}`, token: linkToken })}`;
  const env = {
    ...process.env,
    HOME: h,
    CFFIXED_USER_HOME: h,
    ORKUMO_REMOTE: link,
    SERVER_PORT: ownPort,
    ORKUMO_DISABLE_UPDATES: '1',
    ORKUMO_QUICK_SHORTCUT: 'Alt+Shift+F9',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return _electron.launch({ executablePath: bin, env });
};
const apiStatus = (win) =>
  win.evaluate(
    (p) =>
      fetch(`http://127.0.0.1:${p}/api/config`).then(
        (r) => r.status,
        () => 'blocked'
      ),
    relayPort
  );

(async () => {
  await new Promise((r) => relay.listen(0, '127.0.0.1', r));
  relayPort = relay.address().port;
  let app = await launch('paired', token);
  try {
    const main = await app.firstWindow();
    const row = main.getByText('pro8-worker', { exact: true }).first();
    await row.waitFor({ timeout: 90000 });
    check('app shows the agent of the remote server', true);
    check('app started no server of its own', !(await listening(ownPort)));
    check('renderer is the packaged file:// page', main.url().startsWith('file://'));
    check('API answers the paired renderer', (await apiStatus(main)) === 200);
    await main.waitForTimeout(1500);
    check(
      'project of the remote server is listed',
      (await main.getByText('pro8-projekt').count()) > 0
    );
    await main.screenshot({ path: path.join(out, 'pro8-1-projects.png') });

    await row.click({ button: 'right' });
    const item = main.getByRole('menuitem', { name: 'Open terminal here' });
    await item.waitFor();
    await main.waitForTimeout(400);
    await item.click();
    const xterm = main.locator('[data-agent-pane^="shell:"]').first().locator('.xterm');
    await xterm.waitFor();
    await main.waitForFunction(
      (el) => /\(PID \d+\)/.test(el.textContent || ''),
      await xterm.elementHandle(),
      {
        timeout: 15000,
      }
    );
    await main.waitForTimeout(800);
    await xterm.click();
    await main.keyboard.type('echo "[[$PRO8_MARK]]"\n', { delay: 15 });
    const answered = await main
      .waitForFunction(
        (args) => (args[0].textContent || '').includes(`[[${args[1]}]]`),
        [await xterm.elementHandle(), mark],
        {
          timeout: 10000,
        }
      )
      .then(
        () => true,
        () => false
      );
    check('terminal runs on the remote server and answers', answered);
    await main.screenshot({ path: path.join(out, 'pro8-2-terminal.png') });
  } finally {
    await app.close().catch(() => {});
  }

  app = await launch('wrong-token', 'not-the-token');
  try {
    const main = await app.firstWindow();
    await main.waitForTimeout(8000);
    check('wrong token: API refuses the renderer', (await apiStatus(main)) === 401);
    check(
      'wrong token: no agent shown',
      (await main.getByText('pro8-worker', { exact: true }).count()) === 0
    );
    await main.screenshot({ path: path.join(out, 'pro8-3-wrong-token.png') });
  } finally {
    await app.close().catch(() => {});
  }
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
