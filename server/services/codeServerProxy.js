/**
 * code-server through the API (docs/MODULES.md, "Backend target"): `/api/code-server/proxy/<rest>`
 * (HTTP and WebSocket upgrade) goes to code-server's `/<rest>`, so a UI connected to this instance
 * through a module relay reaches its VS Code. code-server uses relative URLs and works under the
 * sub-path.
 *
 * code-server runs with `--auth none`, so where it listens is its access control: 127.0.0.1:<port>
 * when loopback is trusted (the default), else a Unix socket of mode 600 in the data dir
 * (DEVORBIT_TRUST_LOOPBACK=false: other local users or containers reach loopback). The proxy only
 * ever targets that. Orkumo's own credentials (pairing token header and query, renderer secret)
 * are dropped; cookies pass, the proxy is same-origin for the browser. The caller checks origin and
 * auth first, as for every /api route.
 */
import http from 'http';
import { join } from 'path';

export const PROXY_PREFIX = '/api/code-server/proxy';

const LOOPBACK = '127.0.0.1';
const SOCKET_NAME = 'code-server.sock';

/**
 * Where code-server listens: `{ host, port }` on loopback, or `{ socketPath }` when loopback is not
 * trusted
 */
export function codeServerTarget({ trustLoopback, port, dataPath }) {
  return trustLoopback
    ? { host: LOOPBACK, port }
    : { socketPath: join(dataPath, SOCKET_NAME) };
}

/** code-server command line for a target */
export function codeServerArgs(target) {
  const listen = target.socketPath
    ? ['--socket', target.socketPath, '--socket-mode', '600']
    : ['--bind-addr', `${target.host}:${target.port}`];
  return [...listen, '--auth', 'none', '--disable-telemetry'];
}

// Host (and Origin) code-server sees; it compares the two for WebSockets
const authority = (target) => (target.socketPath ? 'localhost' : `${target.host}:${target.port}`);
const connectTo = (target) =>
  target.socketPath ? { socketPath: target.socketPath } : { host: target.host, port: target.port };

/** True when code-server answers on the target */
export function probeCodeServer(target) {
  return new Promise((resolve) => {
    http
      .get({ ...connectTo(target), path: '/', headers: { host: authority(target) } }, (res) => {
        res.resume();
        resolve(res.statusCode < 500);
      })
      .on('error', () => resolve(false));
  });
}

/**
 * Body of GET /api/code-server/status for an installed code-server: on a socket there is no
 * direct URL, only the proxy
 */
export async function codeServerStatus({ path: binary, target, managedByUs }) {
  const running = await probeCodeServer(target);
  const socket = Boolean(target.socketPath);
  return {
    installed: true,
    path: binary,
    running,
    url: running && !socket ? `http://${authority(target)}` : null,
    port: socket ? null : target.port,
    socket,
    managedByUs,
  };
}

// RFC 9110 7.6.1, plus the legacy ones still seen in the wild
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
// Orkumo credentials, and what code-server compares a WebSocket Origin against (set below)
const DROPPED = new Set([
  'x-devorbit-token',
  'x-orkumo-renderer',
  'host',
  'origin',
  'forwarded',
  'x-forwarded-host',
]);

const hopByHop = (headers) => {
  const named = String(headers.connection ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...HOP_BY_HOP, ...named]);
};

/**
 * Upstream path of a proxy URL: prefix stripped, query kept without `token`; null when the
 * normalised path is not under the prefix (`..`, `%2e%2e`)
 */
export function upstreamPath(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl, 'http://x');
  } catch {
    return null;
  }
  const { pathname } = url;
  if (pathname !== PROXY_PREFIX && !pathname.startsWith(`${PROXY_PREFIX}/`)) return null;
  // Re-serialise the query only when it carried the token, so code-server sees it byte for byte
  if (url.searchParams.has('token')) url.searchParams.delete('token');
  return `${pathname.slice(PROXY_PREFIX.length) || '/'}${url.search}`;
}

function upstreamHeaders(headers, target) {
  const skip = hopByHop(headers);
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!skip.has(name) && !DROPPED.has(name)) out[name] = value;
  }
  out.host = authority(target);
  // Checked by the caller; code-server compares it with Host for WebSockets
  if (headers.origin) out.origin = `http://${authority(target)}`;
  return out;
}

function responseHeaders(headers) {
  const skip = hopByHop(headers);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !skip.has(name)));
}

const refuse = (socket, status) => {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
};

/** `getTarget()` is read per request (codeServerTarget): the port can change while the server runs */
export function createCodeServerProxy({ getTarget }) {
  function handleHttp(req, res) {
    const path = upstreamPath(req.url);
    if (path === null) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not found' }));
    }
    // Relative URLs of code-server resolve against the directory: `.../proxy` -> `.../proxy/`
    if (new URL(req.url, 'http://x').pathname === PROXY_PREFIX) {
      res.writeHead(308, { location: `proxy${path}` });
      return res.end();
    }
    const target = getTarget();
    const upstream = http.request(
      {
        ...connectTo(target),
        method: req.method,
        path,
        headers: upstreamHeaders(req.headers, target),
      },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, responseHeaders(upRes.headers));
        upRes.pipe(res);
      }
    );
    upstream.on('error', () => {
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'code-server not reachable' }));
    });
    // A client that goes away takes the upstream request with it
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  }

  function handleUpgrade(req, socket, head) {
    const path = upstreamPath(req.url);
    if (path === null) return refuse(socket, '404 Not Found');
    const target = getTarget();
    const upstream = http.request({
      ...connectTo(target),
      method: req.method,
      path,
      headers: {
        ...upstreamHeaders(req.headers, target),
        connection: 'Upgrade',
        upgrade: req.headers.upgrade,
      },
    });
    socket.on('error', () => upstream.destroy());
    upstream.on('upgrade', (upRes, upSocket, upHead) => {
      const lines = [`HTTP/1.1 101 ${upRes.statusMessage || 'Switching Protocols'}`];
      for (let i = 0; i < upRes.rawHeaders.length; i += 2) {
        lines.push(`${upRes.rawHeaders[i]}: ${upRes.rawHeaders[i + 1]}`);
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (upHead.length) socket.write(upHead);
      if (head.length) upSocket.write(head);
      upSocket.on('error', () => socket.destroy());
      socket.on('close', () => upSocket.destroy());
      upSocket.on('close', () => socket.destroy());
      upSocket.pipe(socket).pipe(upSocket);
    });
    // code-server answered without upgrading (e.g. 403): pass the status on and close
    upstream.on('response', (upRes) => {
      upRes.resume();
      refuse(socket, `${upRes.statusCode} ${upRes.statusMessage ?? ''}`.trim());
    });
    upstream.on('error', () => refuse(socket, '502 Bad Gateway'));
    upstream.end();
  }

  return { handleHttp, handleUpgrade };
}
