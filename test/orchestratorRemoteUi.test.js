import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

// The web UI reached through `tailscale serve` (remote access on, pairing token, the tailnet name
// as Host and Origin) is the UI for the C4 guards; the CLI (token, no Origin) is an agent.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'remote-token-for-test-0123456789abcdef';
const HOST = 'box.example.ts.net';
const tmp = fs.realpathSync(fs.mkdtempSync(path.join('/tmp', 'ru-')));
const home = path.join(tmp, 'home');
const data = path.join(tmp, 'data');
let server;
let port;

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port: p } = s.address();
      s.close(() => resolve(p));
    });
  });

/** A request as the proxy relays it: loopback peer, Host and Origin of the tailnet name */
const send = (method, route, { headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: `/api${route}`,
        headers: { 'Content-Type': 'application/json', ...headers },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode, text }));
      }
    );
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
const remoteUi = { Host: HOST, Origin: `https://${HOST}`, 'X-DevOrbit-Token': TOKEN };

beforeAll(async () => {
  fs.mkdirSync(path.join(data, 'orchestrator', 'roles'), { recursive: true });
  fs.writeFileSync(path.join(data, 'orchestrator', 'roles', 'ceo.md'), '# ceo\n');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(data, 'remote-token'), TOKEN);
  const sessions = [
    { kind: 'background', id: 'chiefjob', name: 'chief', state: 'working', cwd: tmp },
  ];
  fs.writeFileSync(
    path.join(home, 'claude'),
    `#!/bin/sh\ncase " $* " in\n  *" stop "*) echo stopped ;;\n  *" agents "*) echo '${JSON.stringify(sessions)}' ;;\n  *) exec sleep 3 ;;\nesac\n`,
    { mode: 0o755 }
  );
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ directories: [tmp] }));
  fs.writeFileSync(
    path.join(data, 'settings.json'),
    JSON.stringify({
      agentView: {
        orchestrators: ['chiefjob'],
        orchestratorRoles: { chiefjob: 'ceo' },
        dispatch: { harness: 'claude' },
      },
    })
  );
  port = await freePort();
  const env = { ...process.env };
  delete env.ORKUMO_PANE_ID;
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...env,
      HOME: home,
      CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
      SERVER_PORT: String(port),
      DEVORBIT_DATA_PATH: data,
      DEVORBIT_REMOTE: 'true',
      CLAUDE_CLI_PATH: path.join(home, 'claude'),
      DEVHUB_PREMIUM_DIR: '/nonexistent-orkumo-modules',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 120; i++) {
    const r = await send('GET', '/orchestrator/reports', { headers: remoteUi }).catch(() => null);
    if (r && r.status < 500) return;
    await new Promise((r2) => setTimeout(r2, 500));
  }
  throw new Error('server did not come up');
}, 90_000);

afterAll(async () => {
  if (server && server.exitCode === null)
    await new Promise((resolve) => {
      server.once('exit', resolve);
      server.kill();
    });
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('remote web UI (tailscale serve + pairing token)', () => {
  it('stopping an orchestrator: the remote page with the token is the UI', async () => {
    expect((await send('POST', '/agents/chiefjob/stop', { headers: remoteUi })).status).toBe(200);
  });

  it('starting a second holder of a role: the remote page may, the CLI (token, no Origin) may not', async () => {
    const start = (headers) =>
      send('POST', '/orchestrator/start', { headers, body: { role: 'ceo' } });
    expect((await start(remoteUi)).status).toBe(201);
    const cli = await start({ 'X-DevOrbit-Token': TOKEN });
    expect(cli.status).toBe(409);
    expect(cli.text).toContain('Role ceo is already held by chief');
  });

  it('the CLI over a remote token (no Origin) is an agent: 403 on stop', async () => {
    const res = await send('POST', '/agents/chiefjob/stop', {
      headers: { 'X-DevOrbit-Token': TOKEN },
    });
    expect(res.status).toBe(403);
    expect(res.text).toContain('agents may not stop it');
  });

  it('a page of another origin is refused by sameSiteOnly even with the token; no token: 401', async () => {
    const foreign = await send('POST', '/agents/chiefjob/stop', {
      headers: { ...remoteUi, Origin: 'https://evil.example' },
    });
    expect(foreign.status).toBe(403);
    expect(foreign.text).toContain('Cross-origin');
    const bare = await send('POST', '/agents/chiefjob/stop', {
      headers: { Host: HOST, Origin: `https://${HOST}` },
    });
    expect(bare.status).toBe(401);
  });
});
