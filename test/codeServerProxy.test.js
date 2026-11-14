// code-server through the API (docs/MODULES.md, "Backend target"): a fake upstream on 127.0.0.1
// stands in for code-server, a plain http server mounts the proxy like server/index.js does.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { createCodeServerProxy, upstreamPath } from '../server/services/codeServerProxy.js';

const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

describe('code-server proxy', () => {
  let upstream;
  let upstreamWss;
  let front;
  let frontPort;
  let upstreamPort;
  const seen = [];

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ url: req.url, headers: req.headers, body });
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
    upstreamWss = new WebSocketServer({ noServer: true });
    upstream.on('upgrade', (req, socket, head) => {
      seen.push({ url: req.url, headers: req.headers, upgrade: true });
      if (req.url.startsWith('/refuse')) {
        socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      upstreamWss.handleUpgrade(req, socket, head, (ws) =>
        ws.on('message', (data) => ws.send(`echo:${data}`))
      );
    });
    upstreamPort = await listen(upstream);

    const proxy = createCodeServerProxy({ getPort: () => upstreamPort });
    front = http.createServer(proxy.handleHttp);
    front.on('upgrade', proxy.handleUpgrade);
    frontPort = await listen(front);
  });

  afterAll(() => {
    upstreamWss.close();
    upstream.close();
    front.close();
  });

  const last = () => seen[seen.length - 1];

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
    expect(headers.host).toBe(`127.0.0.1:${upstreamPort}`);
    expect(headers.origin).toBe(`http://127.0.0.1:${upstreamPort}`);
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

  it('answers 502 when code-server is not running', async () => {
    const closed = http.createServer();
    const port = await listen(closed);
    await new Promise((r) => closed.close(r));
    const proxy = createCodeServerProxy({ getPort: () => port });
    const down = http.createServer(proxy.handleHttp);
    const downPort = await listen(down);
    try {
      const res = await fetch(`http://127.0.0.1:${downPort}/api/code-server/proxy/`);
      expect(res.status).toBe(502);
    } finally {
      down.close();
    }
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
    expect(headers.origin).toBe(`http://127.0.0.1:${upstreamPort}`);
    expect(headers.host).toBe(`127.0.0.1:${upstreamPort}`);
  });

  it('passes a refused upgrade on as its status', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${frontPort}/api/code-server/proxy/refuse`);
    const status = await new Promise((resolve) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      ws.on('error', () => resolve('error'));
    });
    expect(status).toBe(403);
  });
});
