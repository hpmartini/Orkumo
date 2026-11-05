// Real-Electron restart check for #186. Two runs share one throwaway userData folder:
//   PHASE=set   loads a local page that sets a session cookie and a persistent one in a sandboxed BrowserView
//               on the persistent partition (like electron/main.js), closes and reopens the view, quits.
//   PHASE=check starts again on the same folder and lists which cookies survived.
// FIX=off skips persistSessionCookies: the negative control that shows Electron drops session cookies.
// Prints only cookie names and flags, never values.
import { app, BrowserWindow, BrowserView, session } from 'electron';
import { createServer } from 'http';
import { persistSessionCookies } from '../../electron/cookiePersistence.js';

const { PHASE, FIX = 'on', USER_DATA } = process.env;
const PARTITION = 'persist:browser-preview';
app.setPath('userData', USER_DATA);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = (cookies) =>
  cookies
    .filter((c) => c.name === 'login' || c.name === 'pref')
    .map((c) => `${c.name}(session=${c.session})`)
    .sort()
    .join(' ') || '-';

const server = createServer((_req, res) => {
  // login like claude.ai's: no expiry; pref: an ordinary persistent cookie (control, must stay as before)
  res.setHeader('set-cookie', ['login=x; Path=/; HttpOnly; SameSite=Lax', 'pref=y; Path=/; Max-Age=86400']);
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><title>login</title>logged in');
});

const openView = async (win, url) => {
  const view = new BrowserView({
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: PARTITION },
  });
  win.addBrowserView(view);
  view.setBounds({ x: 0, y: 0, width: 400, height: 300 });
  if (url) await view.webContents.loadURL(url);
  return view;
};

app.whenReady().then(async () => {
  const ses = session.fromPartition(PARTITION);
  if (FIX === 'on') persistSessionCookies(ses);
  const win = new BrowserWindow({ width: 400, height: 300, show: false });

  if (PHASE === 'set') {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const view = await openView(win, `http://127.0.0.1:${server.address().port}/`);
    await sleep(500);
    // close the pane like destroyBrowserView in main.js, then open it again
    win.removeBrowserView(view);
    view.webContents.close();
    const reopened = await openView(win);
    console.log(`AFTER_PANE_REOPEN ${report(await ses.cookies.get({}))}`);
    reopened.webContents.close();
    server.closeAllConnections();
    server.close();
  } else {
    console.log(`AFTER_RESTART ${report(await ses.cookies.get({}))}`);
  }
  // shortcut: headless runs hang on quit/exit here; write the cookie store like a normal quit does,
  // print DONE, and let 186.sh end the process
  await ses.cookies.flushStore();
  console.log('DONE');
  app.quit();
});
