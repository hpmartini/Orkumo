// code-server through the API (docs/MODULES.md, "Backend target"): a fake upstream stands in for
// code-server, on 127.0.0.1 (trusted loopback) and on a Unix socket (DEVORBIT_TRUST_LOOPBACK=false);
// a plain http server mounts the proxy like server/index.js does.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import WebSocket, { WebSocketServer } from 'ws';
import {
  codeServerArgs,
  codeServerStatus,
  codeServerTarget,
  createCodeServerProxy,
  isRelayedProxyPath,
  singleFlight,
  upstreamPath,
} from '../server/services/codeServerProxy.js';

const listen = (server, at = 0) =>
  new Promise((resolve) => {
    const done = () => resolve(server.address().port);
    if (typeof at === 'string') server.listen(at, done);
    else server.listen(at, '127.0.0.1', done);
  });

/**
 * Fake code-server: echoes HTTP, echoes WebSocket messages, refuses upgrades under /refuse, never
 * answers upgrades under /hang, aborts HTTP responses under /abort halfway
 */
function fakeCodeServer(seen) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ url: req.url, headers: req.headers, body });
      if (req.url.startsWith('/abort')) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write('half');
        setTimeout(() => res.destroy(), 20);
        return;
      }
      res.writeHead(201, {
        'content-type': 'text/plain',
        'set-cookie': ['a=1', 'b=2'],
        'x-upstream': 'yes',
        // Hop-by-hop by naming in Connection: ends at the proxy
        connection: 'close, x-hop',
        'x-hop': '1',
      });
      res.end(`echo ${req.method} ${req.url}`);
    });
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    seen.push({ url: req.url, headers: req.headers, upgrade: true });
    if (req.url.startsWith('/refuse')) {
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    if (req.url.startsWith('/hang')) {
      const entry = seen[seen.length - 1];
      // The proxy dropping its request shows as end (the server socket is half-open)
      socket.on('end', () => {
        entry.closed = true;
        socket.end();
      });
      socket.resume();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => ws.on('message', (data) => ws.send(`echo:${data}`)));
  });
  server.on('close', () => wss.close());
  return server;
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orkumo-cs-'));
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('code-server target', () => {
  it('listens on loopback when it is trusted, else on a socket of mode 600 in the data dir', () => {
    const tcp = codeServerTarget({ trustLoopback: true, port: 8080, dataPath: '/d' });
    expect(tcp).toEqual({ host: '127.0.0.1', port: 8080 });
    expect(codeServerArgs(tcp)).toEqual([
      '--bind-addr',
      '127.0.0.1:8080',
      '--auth',
      'none',
      '--disable-telemetry',
    ]);

    const sock = codeServerTarget({ trustLoopback: false, port: 8080, dataPath: '/d' });
    expect(sock).toEqual({ socketPath: path.join('/d', 'code-server.sock') });
    expect(codeServerArgs(sock)).toEqual([
      '--socket',
      path.join('/d', 'code-server.sock'),
      '--socket-mode',
      '600',
      '--auth',
      'none',
      '--disable-telemetry',
    ]);
    expect(codeServerArgs(sock)).not.toContain('--bind-addr');
  });

  it('status on a socket: running by connecting to it, no direct URL', async () => {
    const target = codeServerTarget({ trustLoopback: false, port: 8080, dataPath: tmpDir });
    const down = await codeServerStatus({ path: '/bin/cs', target, managedByUs: false });
    expect(down).toMatchObject({ installed: true, running: false, url: null, socket: true });

    const server = fakeCodeServer([]);
    await listen(server, target.socketPath);
    try {
      expect(await codeServerStatus({ path: '/bin/cs', target, managedByUs: true })).toEqual({
        installed: true,
        path: '/bin/cs',
        running: true,
        url: null,
        port: null,
        socket: true,
        managedByUs: true,
      });
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it('status on loopback reports the direct URL', async () => {
    const server = fakeCodeServer([]);
    const port = await listen(server);
    try {
      const target = codeServerTarget({ trustLoopback: true, port, dataPath: tmpDir });
      expect(await codeServerStatus({ path: '/bin/cs', target, managedByUs: false })).toEqual({
        installed: true,
        path: '/bin/cs',
        running: true,
        url: `http://127.0.0.1:${port}`,
        port,
        socket: false,
        managedByUs: false,
      });
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

it('maps the URL: prefix stripped, query kept, token dropped, escapes refused', () => {
  expect(upstreamPath('/api/code-server/proxy/')).toBe('/');
  expect(upstreamPath('/api/code-server/proxy/static/x.js?v=1')).toBe('/static/x.js?v=1');
  expect(upstreamPath('/api/code-server/proxy/?folder=%2FUsers%2Fx&token=t')).toBe(
    '/?folder=%2FUsers%2Fx'
  );
  expect(upstreamPath('/api/code-server/proxy/../../agents')).toBeNull();
  expect(upstreamPath('/api/code-server/proxy/%2e%2e/%2e%2e/agents')).toBeNull();
  expect(upstreamPath('/api/agents')).toBeNull();
});

describe.each([
  ['loopback', true],
  ['Unix socket', false],
])('code-server proxy on %s', (_, trustLoopback) => {
  const seen = [];
  let upstream;
  let front;
  let frontPort;
  let target;
  // Host and Origin code-server sees
  let authority;

  beforeAll(async () => {
    upstream = fakeCodeServer(seen);
    if (trustLoopback) {
      const port = await listen(upstream);
      target = codeServerTarget({ trustLoopback, port, dataPath: tmpDir });
      authority = `127.0.0.1:${port}`;
    } else {
      target = codeServerTarget({ trustLoopback, port: 8080, dataPath: tmpDir });
      await listen(upstream, target.socketPath);
      authority = 'localhost';
    }
    const proxy = createCodeServerProxy({ getTarget: () => target });
    front = http.createServer(proxy.handleHttp);
    front.on('upgrade', proxy.handleUpgrade);
    frontPort = await listen(front);
  });

  afterAll(async () => {
    await new Promise((r) => upstream.close(r));
    front.close();
  });

  const last = () => seen[seen.length - 1];

  it('forwards HTTP with path, query, method and body; passes status and headers back', async () => {
    const res = await fetch(
      `http://127.0.0.1:${frontPort}/api/code-server/proxy/static/a.js?v=1&token=secret`,
      {
        method: 'POST',
        body: 'payload',
        headers: {
          'x-devorbit-token': 'secret',
          'x-orkumo-renderer': 'r'.repeat(64),
          cookie: 'session=abc',
          origin: 'http://localhost:3001',
        },
      }
    );
    expect(res.status).toBe(201);
    expect(await res.text()).toBe('echo POST /static/a.js?v=1');
    expect(res.headers.get('x-upstream')).toBe('yes');
    expect(res.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(res.headers.get('x-hop')).toBeNull();

    const { url, headers, body } = last();
    expect(url).toBe('/static/a.js?v=1');
    expect(body).toBe('payload');
    expect(headers.cookie).toBe('session=abc');
    expect(headers['x-devorbit-token']).toBeUndefined();
    expect(headers['x-orkumo-renderer']).toBeUndefined();
    expect(headers.host).toBe(authority);
    expect(headers.origin).toBe(`http://${authority}`);
  });

  it('redirects the bare prefix to the directory, so relative URLs resolve', async () => {
    const res = await fetch(`http://127.0.0.1:${frontPort}/api/code-server/proxy?folder=%2Fx`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('proxy/?folder=%2Fx');
  });

  it('answers 404 for paths outside the prefix', async () => {
    const res = await fetch(`http://127.0.0.1:${frontPort}/api/agents`);
    expect(res.status).toBe(404);
  });

  it('passes a WebSocket upgrade through both ways', async () => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${frontPort}/api/code-server/proxy/stable-1?reconnectionToken=r&token=secret`,
      { headers: { origin: 'http://localhost:3001', 'x-devorbit-token': 'secret' } }
    );
    const reply = await new Promise((resolve, reject) => {
      ws.on('open', () => ws.send('hello'));
      ws.on('message', (data) => resolve(String(data)));
      ws.on('error', reject);
    });
    ws.close();
    expect(reply).toBe('echo:hello');
    const { url, headers, upgrade } = last();
    expect(upgrade).toBe(true);
    expect(url).toBe('/stable-1?reconnectionToken=r');
    expect(headers['x-devorbit-token']).toBeUndefined();
    expect(headers.origin).toBe(`http://${authority}`);
    expect(headers.host).toBe(authority);
  });

  it('passes a refused upgrade on as its status', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${frontPort}/api/code-server/proxy/refuse`);
    const status = await new Promise((resolve) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      ws.on('error', () => resolve('error'));
    });
    expect(status).toBe(403);
  });

  it('ends the browser response when code-server aborts mid-response', async () => {
    const res = await fetch(`http://127.0.0.1:${frontPort}/api/code-server/proxy/abort`);
    expect(res.status).toBe(200);
    await expect(res.text()).rejects.toThrow();
  });

  it('drops the upstream request when the browser leaves before the handshake', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${frontPort}/api/code-server/proxy/hang-early`);
    ws.on('error', () => {});
    await expect.poll(() => seen.some((s) => s.url === '/hang-early')).toBe(true);
    const entry = seen.find((s) => s.url === '/hang-early');
    ws.terminate();
    await expect.poll(() => entry.closed).toBe(true);
  });

  it('answers 504 when code-server does not complete the handshake in time', async () => {
    const proxy = createCodeServerProxy({ getTarget: () => target, handshakeMs: 100 });
    const slow = http.createServer();
    slow.on('upgrade', proxy.handleUpgrade);
    const slowPort = await listen(slow);
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${slowPort}/api/code-server/proxy/hang-slow`);
      const status = await new Promise((resolve) => {
        ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
        ws.on('error', () => resolve('error'));
      });
      expect(status).toBe(504);
      const entry = seen.find((s) => s.url === '/hang-slow');
      await expect.poll(() => entry.closed).toBe(true);
    } finally {
      slow.close();
    }
  });
});

it('skips the rate limiter only for the proxy through a module relay', () => {
  for (const ok of [
    '/api/modules/mesh/peer/darkbook/code-server/proxy/',
    '/api/modules/mesh/peer/darkbook.tail1.ts.net/code-server/proxy/static/x.js',
    '/api/modules/mesh/peer/k/code-server/proxy',
  ]) {
    expect(isRelayedProxyPath(ok)).toBe(true);
  }
  for (const bad of [
    '/api/modules/mesh/peer/k/agents',
    '/api/modules/mesh/peer/k/code-server/proxyx',
    '/api/modules/mesh/../../code-server/proxy/',
    '/api/modules/mesh/peer/./code-server/proxy/',
    '/api/agents/code-server/proxy/',
    '/api/modules/Mesh/code-server/proxy/',
    '/x/api/modules/mesh/code-server/proxy/',
  ]) {
    expect(isRelayedProxyPath(bad)).toBe(false);
  }
});

it('singleFlight: concurrent calls share one run, the next call runs again', async () => {
  let runs = 0;
  let release;
  const start = singleFlight(async () => {
    runs++;
    await new Promise((r) => (release = r));
    return runs;
  });
  const first = start();
  const second = start();
  await Promise.resolve();
  await Promise.resolve();
  release();
  expect(await Promise.all([first, second])).toEqual([1, 1]);
  expect(runs).toBe(1);
  const third = start();
  await expect.poll(() => runs).toBe(2);
  release();
  expect(await third).toBe(2);
});

it('answers 502 when code-server is not running', async () => {
  const closed = http.createServer();
  const freePort = await listen(closed);
  await new Promise((r) => closed.close(r));
  for (const target of [
    codeServerTarget({ trustLoopback: true, port: freePort, dataPath: tmpDir }),
    codeServerTarget({ trustLoopback: false, port: 0, dataPath: path.join(tmpDir, 'none') }),
  ]) {
    const proxy = createCodeServerProxy({ getTarget: () => target });
    const down = http.createServer(proxy.handleHttp);
    const downPort = await listen(down);
    try {
      const res = await fetch(`http://127.0.0.1:${downPort}/api/code-server/proxy/`);
      expect(res.status).toBe(502);
    } finally {
      down.close();
    }
  }
});
