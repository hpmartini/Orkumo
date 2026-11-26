import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { stopRefusal, roleHeldRefusal } from '../server/services/orchestratorService.js';
import * as remoteAccess from '../server/services/remoteAccess.js';

// C4: one live holder per role, and agents cannot stop an orchestrator; only the UI (or the
// orchestrator itself) can. Units first, then the real server + CLI with a stub `claude`.

const settings = {
  orchestrators: ['chief-job'],
  orchestratorRoles: { 'chief-job': 'ceo' },
};
const chief = {
  id: 'chief-job',
  kind: 'background',
  name: 'chief',
  state: 'working',
  paneId: null,
};
const pane = {
  id: 'interactive-9',
  sessionId: 'uuid-9',
  kind: 'interactive',
  name: 'boss',
  paneId: 'orch-1',
  state: null,
};

describe('stopRefusal', () => {
  const marked = { ...settings, orchestrators: ['uuid-9'] };
  const agent = { ui: false, paneId: 'work-2' };

  it('refuses an agent stopping a marked orchestrator, naming it', () => {
    expect(stopRefusal({ session: pane, caller: agent, settings: marked })).toEqual({
      status: 403,
      error: 'boss is an orchestrator; agents may not stop it. Only Hape can, in the Orkumo UI.',
    });
  });
  it('allows the UI, the orchestrator itself (its own pane) and workers', () => {
    expect(stopRefusal({ session: pane, caller: { ui: true }, settings: marked })).toBeNull();
    expect(
      stopRefusal({ session: pane, caller: { ui: false, paneId: 'orch-1' }, settings: marked })
    ).toBeNull();
    const worker = { id: 'w', kind: 'background', state: 'working', paneId: null };
    expect(stopRefusal({ session: worker, caller: agent, settings: marked })).toBeNull();
  });
  it('a pane of a server-started orchestrator (orch-…) counts before it is marked', () => {
    expect(
      stopRefusal({ session: null, paneId: 'orch-77', caller: agent, settings: marked })
    ).toMatchObject({ status: 403 });
    expect(
      stopRefusal({ session: null, paneId: 'work-77', caller: agent, settings: marked })
    ).toBeNull();
  });
  it('a finished orchestrator may be removed', () => {
    expect(
      stopRefusal({ session: { ...pane, state: 'done' }, caller: agent, settings: marked })
    ).toBeNull();
  });
  it('a spoofed pane header of another pane does not pass', () => {
    expect(
      stopRefusal({ session: pane, caller: { ui: false, paneId: 'orch-2' }, settings: marked })
    ).toMatchObject({ status: 403 });
  });
});

describe('roleHeldRefusal', () => {
  it('409 with the holder named when a live session holds the role', () => {
    expect(roleHeldRefusal('ceo', { sessions: [chief], settings })).toEqual({
      status: 409,
      error:
        'Role ceo is already held by chief. Use that session; reset it with Handoff + Reset instead of starting a second one.',
    });
  });
  it('names the pane of a pane holder', () => {
    const s = { orchestrators: ['uuid-9'], orchestratorRoles: { 'uuid-9': 'ceo' } };
    expect(roleHeldRefusal('ceo', { sessions: [pane], settings: s }).error).toBe(
      'Role ceo is already held by boss (pane orch-1). Use that session; reset it with Handoff + Reset instead of starting a second one.'
    );
  });
  it('free when the holder ended or the role differs', () => {
    expect(
      roleHeldRefusal('ceo', { sessions: [{ ...chief, state: 'done' }], settings })
    ).toBeNull();
    expect(roleHeldRefusal('cto', { sessions: [chief], settings })).toBeNull();
  });
  const held = (who) =>
    `Role playmaker is already held by ${who}. Use that session; reset it with Handoff + Reset instead of starting a second one.`;
  const pm = { id: 'pm', kind: 'background', name: 'playmaker', state: 'working' };
  const pmMarked = { orchestrators: ['pm'], orchestratorRoles: {} };
  it('a live orchestrator is held by its name too (25.11.: stop + start --name playmaker)', () => {
    expect(roleHeldRefusal('playmaker', { sessions: [pm], settings: pmMarked })).toEqual({
      status: 409,
      error: held('playmaker'),
    });
    expect(roleHeldRefusal(' Playmaker ', { sessions: [pm], settings: pmMarked })).not.toBeNull();
  });
  it('a role id equals a name: the requested name matches the role of a holder', () => {
    expect(roleHeldRefusal('chief', { sessions: [chief], settings }).status).toBe(409);
  });
  it('a server-started orchestrator pane (orch-…) holds its name before it is marked', () => {
    const row = { id: 'interactive-5', paneId: 'orch-5', name: 'playmaker', state: null };
    expect(
      roleHeldRefusal('playmaker', { sessions: [row], settings: { orchestrators: [] } }).error
    ).toBe(held('playmaker (pane orch-5)'));
  });
  it('workers, stopped orchestrators and other names are free', () => {
    expect(roleHeldRefusal('playmaker', { sessions: [{ ...pm }], settings: {} })).toBeNull();
    expect(
      roleHeldRefusal('playmaker', {
        sessions: [{ ...pm, state: 'stopped' }],
        settings: pmMarked,
      })
    ).toBeNull();
    expect(roleHeldRefusal('other', { sessions: [pm], settings: pmMarked })).toBeNull();
  });
});

describe('isUiRequest', () => {
  const SECRET = 'x'.repeat(40);
  const req = (headers) => ({ headers });
  it('renderer secret or a loopback page origin; a bare request (CLI, curl) is an agent', () => {
    remoteAccess.setRendererSecret(SECRET);
    expect(remoteAccess.isUiRequest(req({ 'x-orkumo-renderer': SECRET }))).toBe(true);
    expect(remoteAccess.isUiRequest(req({ origin: 'http://localhost:3098' }))).toBe(true);
    expect(remoteAccess.isUiRequest(req({ origin: 'http://127.0.0.1:3099' }))).toBe(true);
    expect(remoteAccess.isUiRequest(req({}))).toBe(false);
    expect(remoteAccess.isUiRequest(req({ 'x-orkumo-renderer': 'wrong' }))).toBe(false);
    expect(remoteAccess.isUiRequest(req({ origin: 'https://evil.example' }))).toBe(false);
    remoteAccess.setRendererSecret('');
  });
});

// ---------------------------------------------------------------------------------------------
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'server/orchestrator/orkumo.mjs');
const SECRET = 'r'.repeat(40);
// short path: the agent PTY holder listens on a Unix socket in the data dir (path length limit)
const tmp = fs.realpathSync(fs.mkdtempSync(path.join('/tmp', 'og-')));
const home = path.join(tmp, 'home');
const data = path.join(tmp, 'data');
let server;
let api;

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    if (
      await fetch(url).then(
        (r) => r.status < 500,
        () => false
      )
    )
      return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up`);
}

const call = (method, route, { headers = {}, body } = {}) =>
  fetch(`${api}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const asUi = { 'X-Orkumo-Renderer': SECRET };

/** The CLI as an agent runs it */
const cli = (args, env = {}) =>
  spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, ORKUMO_API_URL: api, ...env },
  });

const SESSIONS = [
  { kind: 'background', id: 'chiefjob', name: 'chief', state: 'working', cwd: tmp },
  { kind: 'background', id: 'workerj1', name: 'worker', state: 'working', cwd: tmp },
];
/** What the stub `claude agents --json` lists */
const writeSessions = (list) =>
  fs.writeFileSync(path.join(home, 'sessions.json'), JSON.stringify(list));

beforeAll(async () => {
  fs.mkdirSync(path.join(data, 'orchestrator', 'roles'), { recursive: true });
  fs.writeFileSync(path.join(data, 'orchestrator', 'roles', 'ceo.md'), '# ceo\n');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(
    path.join(home, 'claude'),
    // `claude agents|respawn|stop|--bg …` answer at once (sessions: $HOME/sessions.json); the pane start
    // (an orchestrator session) stays up a moment
    `#!/bin/sh\ncase " $* " in\n  *" --bg "*) echo "backgrounded · newjob1 · bg" ;;\n  *" stop "*) echo stopped ;;\n  *" agents "*|*" respawn "*) cat "$HOME/sessions.json" ;;\n  *) exec sleep 3 ;;\nesac\n`,
    { mode: 0o755 }
  );
  writeSessions(SESSIONS);
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ directories: [tmp] }));
  fs.writeFileSync(
    path.join(data, 'settings.json'),
    JSON.stringify({
      agentView: {
        orchestrators: ['chiefjob'],
        orchestratorRoles: { chiefjob: 'ceo' },
        // the started orchestrator is the stub `claude`, never a real agent
        dispatch: { harness: 'claude' },
      },
    })
  );
  const port = await freePort();
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: home,
      CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
      SERVER_PORT: String(port),
      DEVORBIT_DATA_PATH: data,
      DEVORBIT_RENDERER_SECRET: SECRET,
      CLAUDE_CLI_PATH: path.join(home, 'claude'),
      DEVHUB_PREMIUM_DIR: '/nonexistent-orkumo-modules',
    },
    stdio: 'ignore',
  });
  api = `http://127.0.0.1:${port}/api`;
  await waitFor(`${api}/orchestrator/reports`);
}, 90_000);

afterAll(async () => {
  if (server && server.exitCode === null)
    await new Promise((resolve) => {
      server.once('exit', resolve);
      server.kill();
    });
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('one live holder per role (server)', () => {
  it('a second start of a held role without UI credentials: 409 with the holder named', async () => {
    const res = await call('POST', '/orchestrator/start', { body: { role: 'ceo' } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      'Role ceo is already held by chief. Use that session; reset it with Handoff + Reset instead of starting a second one.'
    );
  });

  it('the same start with the renderer secret is allowed (Hape decides)', async () => {
    const res = await call('POST', '/orchestrator/start', { headers: asUi, body: { role: 'ceo' } });
    expect({ status: res.status, body: await res.text() }).toMatchObject({ status: 201 });
  });

  it('a loopback page origin counts as the UI too', async () => {
    const res = await call('POST', '/orchestrator/start', {
      headers: { Origin: 'http://localhost:3098' },
      body: { role: 'ceo' },
    });
    expect(res.status).toBe(201);
  });
});

describe('a second orchestrator under the name of a live one (dispatch, 25.11.)', () => {
  const dispatch = (body, headers = {}) =>
    call('POST', '/agents/dispatch', {
      headers,
      body: { cwd: tmp, prompt: 'Survey the agents in Orkumo', ...body },
    });
  const heldBy = (label, who) =>
    `Role ${label} is already held by ${who}. Use that session; reset it with Handoff + Reset instead of starting a second one.`;

  it('profile orchestrator named like a live orchestrator or its role: 409 naming the holder', async () => {
    const byName = await dispatch({ profile: 'orchestrator', name: 'chief' });
    expect(byName.status).toBe(409);
    expect((await byName.json()).error).toBe(heldBy('chief', 'chief'));
    const byRole = await dispatch({ profile: 'orchestrator', name: 'CEO' });
    expect(byRole.status).toBe(409);
    expect((await byRole.json()).error).toBe(heldBy('CEO', 'chief'));
  });

  it('workers keep any name', async () => {
    expect((await dispatch({ profile: 'worker', name: 'chief' })).status).toBe(201);
    expect((await dispatch({ name: 'chief' })).status).toBe(201);
  });

  it('a free name starts, is marked by the server and then counts as held', async () => {
    expect((await dispatch({ profile: 'orchestrator', name: 'playmaker' })).status).toBe(201);
    writeSessions([
      ...SESSIONS,
      { kind: 'background', id: 'newjob1', name: 'playmaker', state: 'working', cwd: tmp },
    ]);
    const again = await dispatch({ profile: 'orchestrator', name: 'playmaker' });
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe(heldBy('playmaker', 'playmaker'));
  });

  it('the UI may start a second one', async () => {
    expect((await dispatch({ profile: 'orchestrator', name: 'chief' }, asUi)).status).toBe(201);
  });

  it('orkumo start --orchestrator --name <live orchestrator>: server text on stderr, exit 1', () => {
    const run = cli(
      ['start', '--project', tmp, '--orchestrator', '--name', 'playmaker', 'Survey the agents'],
      { ORKUMO_AGENT_ID: 'chiefjob' }
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(heldBy('playmaker', 'playmaker'));
  });
});

describe('stopping an orchestrator (server + CLI)', () => {
  it('orkumo stop <orchestrator>: 403 message, exit 1, nothing stopped', () => {
    const run = cli(['stop', 'chiefjob'], { ORKUMO_AGENT_ID: 'workerj1' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      'chief is an orchestrator; agents may not stop it. Only Hape can, in the Orkumo UI.'
    );
  });

  it('a worker stops freely', () => {
    const run = cli(['stop', 'workerj1'], { ORKUMO_AGENT_ID: 'chiefjob' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Stopped workerj1');
  });

  it('the UI can stop the orchestrator', async () => {
    expect((await call('POST', '/agents/chiefjob/stop', { headers: asUi })).status).toBe(200);
  });

  it('delete and respawn are guarded like stop', async () => {
    expect((await call('DELETE', '/agents/chiefjob', { body: {} })).status).toBe(403);
    expect((await call('POST', '/agents/chiefjob/respawn')).status).toBe(403);
    expect((await call('POST', '/agents/chiefjob/respawn', { headers: asUi })).status).not.toBe(
      403
    );
  });

  it('pane stop: an orchestrator pane (orch-…) refuses agents, accepts itself and the UI', async () => {
    const stop = (headers) => call('POST', '/agents/panes/orch-selftest/stop', { headers });
    const refused = await stop({});
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toContain('is an orchestrator; agents may not stop it');
    expect((await stop({ 'X-Orkumo-Pane': 'work-other' })).status).toBe(403);
    expect((await stop({ 'X-Orkumo-Pane': 'orch-selftest' })).status).toBe(200);
    expect((await stop(asUi)).status).toBe(200);
    // a worker pane is free
    expect((await call('POST', '/agents/panes/work-1/stop')).status).toBe(200);
  });
});
