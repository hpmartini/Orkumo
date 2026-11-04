// Real-Electron smoke test for #182: wires a sandboxed BrowserView exactly like electron/main.js
// and drives it with real input. Run: node_modules/.bin/electron scripts/review/182-smoke.mjs
import { app, BrowserWindow, BrowserView } from 'electron';
import { createServer } from 'http';
import os from 'os';
import path from 'path';
import { wireBrowserViewNav, goHistory } from '../../electron/browserViewNav.js';

app.setPath('userData', path.join(os.tmpdir(), `devorbit-182-smoke-${process.pid}`));

const hits = {};
const server = createServer((req, res) => {
  hits[req.url] = (hits[req.url] || 0) + 1;
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><title>${req.url}</title><body style="height:100vh">page ${req.url}`);
});

const results = [];
const check = (id, name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name}${detail ? ` (${detail})` : ''}`);
};
const until = (emitter, event, ms = 5000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    emitter.once(event, (...args) => {
      clearTimeout(t);
      resolve(args);
    });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const win = new BrowserWindow({ width: 900, height: 700, show: true });
  await win.loadURL(`data:text/html,<title>shell</title>app shell`);
  let shellNavigations = 0;
  win.webContents.on('did-start-navigation', ({ isMainFrame }) => isMainFrame && shellNavigations++);

  // same webPreferences as electron/main.js
  const view = new BrowserView({
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'smoke-182' },
  });
  const states = [];
  wireBrowserViewNav(view.webContents, (s) => states.push(s));
  win.addBrowserView(view);
  view.setBounds({ x: 0, y: 0, width: 900, height: 700 });
  const wc = view.webContents;

  try {
    await wc.loadURL(`${base}/a`);
    await wc.loadURL(`${base}/b`);
    let s = states.at(-1);
    check('AC-2', 'navigation reports url + history', s.url === `${base}/b` && s.canGoBack && !s.canGoForward, JSON.stringify(s));

    // AC-1: the IPC handler path (goHistory) on a real navigationHistory
    let nav = until(wc, 'did-navigate');
    goHistory(wc, 'back');
    await nav;
    s = states.at(-1);
    check('AC-1', 'back button goes back', s.url === `${base}/a` && !s.canGoBack && s.canGoForward, s.url);
    nav = until(wc, 'did-navigate');
    goHistory(wc, 'forward');
    await nav;
    check('AC-1', 'forward button goes forward', states.at(-1).url === `${base}/b`, states.at(-1).url);

    // AC-3: real mouse back/forward button presses, dispatched as native input via CDP
    const click = async (target, button) => {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await target.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: 100, y: 100, button, clickCount: 1 });
      }
    };
    await wc.loadURL(`${base}/c`);
    wc.debugger.attach('1.3');
    nav = until(wc, 'did-navigate');
    await click(wc, 'back');
    await nav;
    await sleep(300); // a second (double) navigation would land here
    check('AC-3', 'mouse back button goes back exactly one page', wc.getURL() === `${base}/b`, wc.getURL());
    nav = until(wc, 'did-navigate');
    await click(wc, 'forward');
    await nav;
    check('AC-3', 'mouse forward button navigates forward', wc.getURL() === `${base}/c`, wc.getURL());
    wc.debugger.detach();

    // Chromium handles side buttons itself: an unwired view navigates too, so nothing to add for them
    const bare = new BrowserView({ webPreferences: { sandbox: true, partition: 'smoke-182-bare' } });
    win.addBrowserView(bare);
    bare.setBounds({ x: 0, y: 0, width: 900, height: 700 });
    await bare.webContents.loadURL(`${base}/a`);
    await bare.webContents.loadURL(`${base}/b`);
    bare.webContents.debugger.attach('1.3');
    await click(bare.webContents, 'back');
    await sleep(800);
    check('AC-3', 'control: Chromium handles side buttons natively', bare.webContents.getURL() === `${base}/a`, bare.webContents.getURL());
    bare.webContents.debugger.detach();
    win.removeBrowserView(bare);
    bare.webContents.close();

    // AC-3: mouse tools on macOS send the browser shortcuts Cmd+[ / Cmd+] (Alt+Arrow elsewhere)
    wc.focus();
    const mac = process.platform === 'darwin';
    for (const [label, input, expected] of [
      ['back shortcut', mac ? { keyCode: '[', modifiers: ['meta'] } : { keyCode: 'Left', modifiers: ['alt'] }, `${base}/b`],
      ['forward shortcut', mac ? { keyCode: ']', modifiers: ['meta'] } : { keyCode: 'Right', modifiers: ['alt'] }, `${base}/c`],
    ]) {
      const navigated = until(wc, 'did-navigate');
      wc.sendInputEvent({ type: 'keyDown', ...input });
      wc.sendInputEvent({ type: 'keyUp', ...input });
      await navigated;
      check('AC-3', label, wc.getURL() === expected, wc.getURL());
    }

    // AC-5 / AC-6: reload shortcuts with focus in the view reload the view only
    wc.focus();
    for (const [label, input] of [
      [process.platform === 'darwin' ? 'Cmd+R' : 'Ctrl+R', { keyCode: 'R', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] }],
      ['F5', { keyCode: 'F5', modifiers: [] }],
    ]) {
      const before = hits['/c'];
      const loaded = until(wc, 'did-finish-load');
      wc.sendInputEvent({ type: 'keyDown', ...input });
      wc.sendInputEvent({ type: 'keyUp', ...input });
      await loaded;
      check('AC-5', `${label} in the view reloads the view`, hits['/c'] === before + 1, `/c hits ${before} -> ${hits['/c']}`);
    }
    // plain typing must not reload
    const before = hits['/c'];
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'R', modifiers: [] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'R', modifiers: [] });
    await sleep(500);
    check('AC-5', 'plain "r" does not reload', hits['/c'] === before);
    check('AC-6', 'app shell was not reloaded by any of it', shellNavigations === 0, `shell navigations ${shellNavigations}`);
  } catch (e) {
    check('ERR', e.message, false);
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
  server.closeAllConnections();
  server.close();
  process.exit(failed ? 1 : 0);
});
