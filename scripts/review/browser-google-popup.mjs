/**
 * Repro for the white accounts.google.com/gsi/transform page in the built-in browser.
 *   env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/review/browser-google-popup.mjs [before|after] [claude]
 * Local fixture: the page opens a sized popup that posts to window.opener and closes,
 * which is what Google Identity's gis_transform page does. "before" uses the handler
 * from origin/main (deny + load in the view), "after" the real wireViewPopups.
 * With "claude" it also clicks "Mit Google fortfahren" on claude.ai (no credentials).
 * Screenshots go to $OUT (default: cwd).
 */
import { app, BrowserView, BrowserWindow } from 'electron';
import http from 'node:http';
import fs from 'node:fs';
import { wireViewPopups } from '../../electron/browserViewNav.js';
import { windowOpenRoute } from '../../electron/validation.js';

const mode = process.argv.includes('before') ? 'before' : 'after';
const withClaude = process.argv.includes('claude');
const OUT = process.env.OUT || process.cwd();
const PARTITION = 'review-popup-' + Date.now(); // never the user's persist:browser-preview
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const pages = {
  '/': `<h1 id=s>waiting</h1><button id=b onclick="window.open('/popup','','width=500,height=600')">Mit Google anmelden</button>
    <script>addEventListener('message', e => { document.getElementById('s').textContent = 'got ' + e.data })</script>`,
  '/popup': `<script>if (window.opener) { opener.postMessage('code-123', '*'); window.close() }</script>`,
};
// No top-level await before 'ready': in an ESM entry it holds the ready event back
app
  .whenReady()
  .then(async () => {
    const server = http.createServer((req, res) => res.end(pages[req.url] ?? ''));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;

    const win = new BrowserWindow({ width: 1000, height: 760, show: true });
    const view = new BrowserView({
      webPreferences: { sandbox: true, contextIsolation: true, partition: PARTITION },
    });
    win.addBrowserView(view);
    view.setBounds({ x: 0, y: 0, width: 1000, height: 760 });
    const wc = view.webContents;

    let popups = new Set();
    if (mode === 'before') {
      wc.setWindowOpenHandler(({ url }) => {
        if (windowOpenRoute(url) === 'renderer') wc.loadURL(url).catch(() => {});
        return { action: 'deny' };
      });
    } else {
      popups = wireViewPopups(wc, { parent: win, partition: PARTITION, route: windowOpenRoute });
      wc.on('did-create-window', (p) =>
        console.log('popup session === view session:', p.webContents.session === wc.session)
      );
    }

    await wc.loadURL(base + '/');
    await wc.executeJavaScript(`document.getElementById('b').click()`, true);
    await wait(1500);
    const status = await wc.executeJavaScript(`document.getElementById('s')?.textContent ?? null`);
    console.log(
      `[${mode}] view url: ${wc.getURL()}  status: ${status}  open popups: ${popups.size}`
    );
    fs.writeFileSync(`${OUT}/popup-fixture-${mode}.png`, (await wc.capturePage()).toPNG());
    const ok = status === 'got code-123' && popups.size === 0;
    console.log(
      ok
        ? 'PASS: opener got the result, popup closed'
        : 'FAIL: result lost (view navigated to the popup)'
    );

    if (withClaude) {
      await wc.loadURL('https://claude.ai/login');
      let clicked = 'no button';
      for (let i = 0; i < 20 && clicked === 'no button'; i++) {
        await wait(1000);
        clicked = await wc.executeJavaScript(
          `(() => { const b = [...document.querySelectorAll('button')].find(b => /google/i.test(b.textContent)); b?.click(); return b?.textContent ?? 'no button' })()`,
          true
        );
      }
      console.log('claude click:', clicked);
      await wait(7000);
      console.log('view url:', wc.getURL().slice(0, 80));
      for (const p of popups) {
        console.log('popup url:', p.webContents.getURL().slice(0, 80));
        console.log('popup has opener:', await p.webContents.executeJavaScript('!!window.opener'));
        fs.writeFileSync(
          `${OUT}/claude-google-${mode}.png`,
          (await p.webContents.capturePage()).toPNG()
        );
      }
      if (!popups.size)
        fs.writeFileSync(`${OUT}/claude-google-${mode}.png`, (await wc.capturePage()).toPNG());
    }
    server.close();
    app.exit(ok ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    app.exit(2);
  });
