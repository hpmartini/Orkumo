// Security review H1 proof: a file:// page in an Electron window marked by electron/rendererSecret.js
// (as electron/main.js does) calls (1) a header-echo server and (2) the real server/index.js with
// ELECTRON_MODE and the secret; a sandboxed iframe in the same page does the same. Prints JSON.
// Run: node_modules/.bin/electron scripts/review/renderer-secret/fixture-main.mjs
// Own userData dir and no single-instance lock: never touches a running Orkumo.
import { app, BrowserWindow, session } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  createRendererSecret,
  markRendererRequests,
  RENDERER_SECRET_HEADER,
} from '../../../electron/rendererSecret.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '../../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orkumo-h1-'));
app.setPath('userData', path.join(tmp, 'userData'));

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const HEADER = RENDERER_SECRET_HEADER.toLowerCase();
const seen = [];
const pick = (h) => ({
  origin: h.origin ?? null,
  secFetchSite: h['sec-fetch-site'] ?? null,
  secret: h[HEADER] ? 'present' : 'absent',
});

async function echoServer(port) {
  const server = http.createServer((req, res) => {
    seen.push({ kind: req.method, url: req.url, ...pick(req.headers) });
    res.writeHead(req.method === 'OPTIONS' ? 204 : 200, {
      'Access-Control-Allow-Origin': req.headers.origin ?? '*',
      'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '',
      'Access-Control-Allow-Methods': 'GET, POST',
    });
    res.end('{}');
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => {
    seen.push({ kind: 'WS', url: req.url, ...pick(req.headers) });
    ws.close();
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return server;
}

async function realServer(port, secret) {
  const child = spawn('node', ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      HOME: tmp,
      SERVER_PORT: String(port),
      DEVORBIT_DATA_PATH: path.join(tmp, 'data'),
      DEVHUB_PREMIUM_DIR: '/nonexistent-orkumo-modules',
      CLAUDE_CLI_PATH: path.join(ROOT, 'test/fixtures/fake-gh/claude'),
      ELECTRON_MODE: 'true',
      DEVORBIT_RENDERER_SECRET: secret,
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 120; i++) {
    const up = await fetch(`http://127.0.0.1:${port}/api/config`).then(
      (r) => r.ok,
      () => false
    );
    if (up) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return child;
}

app.on('window-all-closed', () => {}); // one window per probe: do not quit in between
app.whenReady().then(async () => {
  const secret = createRendererSecret();
  const [echoPort, apiPort] = await Promise.all([freePort(), freePort()]);
  const echo = await echoServer(echoPort);
  const api = await realServer(apiPort, secret);
  const out = { electron: process.versions.electron };
  try {
    for (const [label, port] of [
      ['echo', echoPort],
      ['api', apiPort],
    ]) {
      const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
      const ids = new Set([win.webContents.id]);
      markRendererRequests(session.defaultSession, {
        secret,
        port,
        isTrustedContents: (id) => ids.has(id),
      });
      await win.loadFile(path.join(HERE, 'page.html'), { query: { base: `127.0.0.1:${port}` } });
      out[label] = await win.webContents.executeJavaScript('window.results');
      win.destroy();
    }
    out.echoSeen = seen;
  } finally {
    api.kill();
    echo.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(JSON.stringify(out, null, 2));
  app.exit(0);
});
