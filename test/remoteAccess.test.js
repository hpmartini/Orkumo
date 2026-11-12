import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createServer, request } from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import * as remoteAccess from '../server/services/remoteAccess.js';

// Mirrors the wiring in server/index.js: token middleware for HTTP, verifyClient for /api/pty.
// A request relayed by `tailscale serve` reaches the server from loopback with X-Forwarded-For,
// so that header stands in for "remote client" here.
const REMOTE = { 'X-Forwarded-For': '100.64.0.7' };

let server;
let base;
let dataDir;

beforeAll(async () => {
  const app = express();
  app.use(cors());
  app.use(remoteAccess.requireRemoteToken);
  app.get('/api/ping', (req, res) => res.json({ ok: true }));
  server = createServer(app);
  new WebSocketServer({
    server,
    path: '/api/pty',
    verifyClient: ({ req }) => remoteAccess.isAuthorized(req),
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((r) => server.close(r)));

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-access-'));
  process.env.DEVORBIT_DATA_PATH = dataDir;
  process.env.DEVORBIT_REMOTE = 'true';
  remoteAccess.resetTokenCache();
});

afterEach(() => {
  delete process.env.DEVORBIT_REMOTE;
  delete process.env.DEVORBIT_TRUST_LOOPBACK;
  delete process.env.DEVORBIT_DATA_PATH;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const get = (url, headers = {}) => fetch(`http://${base}${url}`, { headers });

function wsOutcome(query, headers = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${base}/api/pty${query}`, { headers });
    ws.on('open', () => {
      ws.close();
      resolve('open');
    });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
    ws.on('error', () => resolve('error'));
  });
}

describe('remote access token', () => {
  it('rejects a remote request without token', async () => {
    expect((await get('/api/ping', REMOTE)).status).toBe(401);
  });

  it('rejects a remote request with a wrong token', async () => {
    remoteAccess.getToken();
    const res = await get('/api/ping', { ...REMOTE, 'X-DevOrbit-Token': 'wrong' });
    expect(res.status).toBe(401);
  });

  it('accepts a remote request with the right token in the header', async () => {
    const token = remoteAccess.getToken();
    expect((await get('/api/ping', { ...REMOTE, 'X-DevOrbit-Token': token })).status).toBe(200);
  });

  it('accepts the token as query param only for SSE, not for plain requests', async () => {
    const token = remoteAccess.getToken();
    expect((await get(`/api/ping?token=${token}`, REMOTE)).status).toBe(401);
    const sse = { ...REMOTE, Accept: 'text/event-stream' };
    expect((await get(`/api/ping?token=${token}`, sse)).status).toBe(200);
  });

  it('lets a direct localhost request through without token', async () => {
    expect((await get('/api/ping')).status).toBe(200);
  });

  it('asks loopback for the token too when DEVORBIT_TRUST_LOOPBACK=false (shared machine)', async () => {
    process.env.DEVORBIT_TRUST_LOOPBACK = 'false';
    const token = remoteAccess.getToken();
    expect((await get('/api/ping')).status).toBe(401);
    expect((await get('/api/ping', { 'X-DevOrbit-Token': token })).status).toBe(200);
    expect(await wsOutcome('?sessionId=x')).toBe(401);
    expect(await wsOutcome(`?sessionId=x&token=${token}`)).toBe('open');
    process.env.DEVORBIT_TRUST_LOOPBACK = 'true';
    expect((await get('/api/ping')).status).toBe(200);
  });

  it('treats loopback with a foreign Host as remote (tailscale serve, DNS rebinding)', async () => {
    const status = (host) =>
      new Promise((resolve, reject) => {
        const [hostname, port] = base.split(':');
        request({ hostname, port, path: '/api/ping', headers: { Host: host } }, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
          .on('error', reject)
          .end();
      });
    expect(await status('mac.tail1.ts.net')).toBe(401);
    expect(await status('evil.example:1234')).toBe(401);
    expect(await status(`localhost:${base.split(':')[1]}`)).toBe(200);
  });

  it('changes nothing when remote access is off', async () => {
    delete process.env.DEVORBIT_REMOTE;
    expect((await get('/api/ping', REMOTE)).status).toBe(200);
  });

  it('rejects a remote WebSocket upgrade without token and accepts it with token', async () => {
    expect(await wsOutcome('?sessionId=x', REMOTE)).toBe(401);
    const token = remoteAccess.getToken();
    expect(await wsOutcome(`?sessionId=x&token=${token}`, REMOTE)).toBe('open');
  });

  it('takes the serve path secret off the URL and remembers the request', () => {
    const secret = remoteAccess.getServeSecret();
    expect(fs.statSync(path.join(dataDir, 'serve-secret')).mode & 0o777).toBe(0o600);
    const take = (url) => {
      const req = { url };
      remoteAccess.takeServePrefix(req);
      return [req.url, remoteAccess.isViaServe(req)];
    };
    expect(take(`/${secret}/api/x?y=1`)).toEqual(['/api/x?y=1', true]);
    expect(take(`/${secret}`)).toEqual(['/', true]);
    expect(take(`/${secret}?a=1`)).toEqual(['/?a=1', true]);
    // not the secret: longer segment, wrong value of the same length, plain API path
    expect(take(`/${secret}x/api/x`)).toEqual([`/${secret}x/api/x`, false]);
    const wrong = `/${'A'.repeat(secret.length)}/api/x`;
    expect(take(wrong)).toEqual([wrong, false]);
    expect(take('/api/x')).toEqual(['/api/x', false]);

    process.env.DEVORBIT_REMOTE = '';
    expect(take(`/${secret}/api/x`)).toEqual([`/${secret}/api/x`, false]);
  });

  it('persists the token with owner-only permissions', () => {
    const token = remoteAccess.getToken();
    const file = path.join(dataDir, 'remote-token');
    expect(fs.readFileSync(file, 'utf8')).toBe(token);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    remoteAccess.resetTokenCache();
    expect(remoteAccess.getToken()).toBe(token);
  });

  it('builds a pairing deep link with url and token', () => {
    const link = new URL(remoteAccess.pairingLink('https://mac.tail1.ts.net'));
    expect(link.protocol).toBe('devorbit:');
    expect(link.searchParams.get('url')).toBe('https://mac.tail1.ts.net');
    expect(link.searchParams.get('token')).toBe(remoteAccess.getToken());
  });
});
