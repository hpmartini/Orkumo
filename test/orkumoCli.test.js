// `orkumo` CLI of orchestrator sessions (server/orchestrator/orkumo.mjs) against a fake API
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  parseArgs,
  loadConfig,
  findAgent,
  sendRoute,
  stopRoute,
  resolveProject,
  guardDecision,
  formatAgent,
  run,
} from '../server/orchestrator/orkumo.mjs';

const NOW = Date.parse('2026-11-13T12:00:00Z');
const agent = (partial) => ({
  id: 'job1',
  sessionId: 'uuid-job1',
  name: 'fix login',
  harness: 'claude',
  kind: 'background',
  cwd: '/p/app',
  project: 'app',
  branch: 'feat/login',
  state: 'working',
  displayState: 'working',
  waitingFor: null,
  lastActivity: new Date(NOW - 120_000).toISOString(),
  prs: [],
  lastText: null,
  paneId: null,
  pid: null,
  orchestrator: false,
  ...partial,
});
const AGENTS = [
  agent({}),
  agent({
    id: 'interactive-77',
    sessionId: 'uuid-tty',
    kind: 'interactive',
    paneId: 'work-1',
    name: 'tty',
  }),
  agent({
    id: 'omp-u3',
    sessionId: 'u3',
    kind: 'interactive',
    harness: 'omp',
    paneId: null,
    name: 'omp',
  }),
  agent({
    id: 'interactive-88',
    sessionId: 'uuid-x',
    kind: 'interactive',
    paneId: null,
    name: 'elsewhere',
    pid: 88,
  }),
];
const PROJECTS = [
  { name: 'App', path: '/p/app', agents: 1 },
  { name: 'Api', path: '/p/api', agents: 0 },
];

/** Fake Orkumo API: records calls, answers by route */
function fakeApi(routes = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const route = url.replace('http://api.test/api', '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, route, body, headers: init.headers });
    const key = `${init.method} ${route.split('?')[0]}`;
    const handler = routes[key];
    const reply = (status, data) => new globalThis.Response(JSON.stringify(data), { status });
    if (!handler) return reply(404, { error: `no route ${key}` });
    return reply(...handler(body, route));
  };
  return { fetch, calls };
}

const baseRoutes = {
  'GET /orchestrator/overview': () => [200, { generatedAt: '', workspace: '/ws', agents: AGENTS }],
  'GET /orchestrator/projects': () => [200, { projects: PROJECTS, defaultHarness: 'claude' }],
};

async function cli(argv, routes = {}, extra = {}) {
  const api = fakeApi({ ...baseRoutes, ...routes });
  const out = [];
  const err = [];
  const code = await run(argv, {
    fetch: api.fetch,
    env: { ORKUMO_API_URL: 'http://api.test/api', ...extra.env },
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    readStdin: async () => extra.stdin ?? '',
    cwd: '/home/hape',
    now: NOW,
    scriptDir: extra.scriptDir ?? '/nowhere/bin',
  });
  return { code, out: out.join('\n'), err: err.join('\n'), calls: api.calls };
}

describe('parseArgs', () => {
  it('reads commands, flags with and without "="', () => {
    expect(parseArgs(['agents', '--all', '--json'])).toEqual({
      command: 'agents',
      args: [],
      flags: { all: true, json: true },
    });
    expect(parseArgs(['show', 'job1', '--last=5'])).toEqual({
      command: 'show',
      args: ['job1'],
      flags: { last: '5' },
    });
    expect(parseArgs([])).toEqual({ command: 'help', args: [], flags: {} });
    expect(parseArgs(['-h']).flags.help).toBe(true);
  });

  it('takes the message and prompt verbatim once they start', () => {
    expect(parseArgs(['send', 'job1', 'run', 'it', '--force', '-h']).args).toEqual([
      'job1',
      'run',
      'it',
      '--force',
      '-h',
    ]);
    expect(
      parseArgs(['start', '--project', 'app', '--harness', 'omp', 'fix', '--name', 'x'])
    ).toEqual({
      command: 'start',
      args: ['fix', '--name', 'x'],
      flags: { project: 'app', harness: 'omp' },
    });
    expect(parseArgs(['send', 'job1', '--', '--literal']).args).toEqual(['job1', '--literal']);
  });

  it('rejects unknown commands, unknown options and missing values (exit 2)', () => {
    for (const argv of [
      ['launch'],
      ['agents', '--last', '3'],
      ['show', 'x', '--last'],
      ['agents', '--json=1'],
    ]) {
      expect(() => parseArgs(argv)).toThrow(expect.objectContaining({ code: 2 }));
    }
  });
});

describe('loadConfig', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orkumo-cli-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reads the API address and token file the server wrote, env first', () => {
    fs.writeFileSync(path.join(dir, 'remote-token'), 'secret\n');
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.writeFileSync(
      path.join(dir, 'bin', 'orkumo.json'),
      JSON.stringify({
        apiUrl: 'http://127.0.0.1:4555/api/',
        tokenFile: path.join(dir, 'remote-token'),
        workspace: dir,
      })
    );
    const scriptDir = path.join(dir, 'bin');
    expect(loadConfig({ env: {}, scriptDir })).toEqual({
      apiUrl: 'http://127.0.0.1:4555/api',
      token: 'secret',
      workspace: dir,
    });
    expect(
      loadConfig({ env: { ORKUMO_API_URL: 'http://x/api', ORKUMO_TOKEN: 't' }, scriptDir })
    ).toMatchObject({ apiUrl: 'http://x/api', token: 't' });
  });

  it('falls back to the default port without a config file', () => {
    expect(loadConfig({ env: {}, scriptDir: path.join(dir, 'bin') })).toEqual({
      apiUrl: 'http://127.0.0.1:3099/api',
      token: null,
      workspace: dir,
    });
  });

  it('sends the token header when it has one', async () => {
    const { calls } = await cli(['agents'], {}, { env: { ORKUMO_TOKEN: 'tok' } });
    expect(calls[0].headers['X-DevOrbit-Token']).toBe('tok');
  });
});

describe('routing helpers', () => {
  it('finds agents by id, uuid, pane id, name or unique prefix', () => {
    expect(findAgent(AGENTS, 'work-1').id).toBe('interactive-77');
    expect(findAgent(AGENTS, 'uuid-job1').id).toBe('job1');
    expect(findAgent(AGENTS, 'omp').id).toBe('omp-u3');
    expect(findAgent(AGENTS, 'jo').id).toBe('job1');
    expect(() => findAgent(AGENTS, 'interactive-')).toThrow(/matches 2 agents/);
    expect(() => findAgent(AGENTS, 'zzz')).toThrow(/No agent "zzz"/);
  });

  it('sends to a job by reply, to a pane agent through its pane, else nowhere', () => {
    expect(sendRoute(AGENTS[0])).toBe('/agents/job1/reply');
    expect(sendRoute(AGENTS[1])).toBe('/agents/panes/work-1/message');
    expect(sendRoute(AGENTS[3])).toBeNull();
    expect(stopRoute(AGENTS[0])).toBe('/agents/job1/stop');
    expect(stopRoute(AGENTS[2])).toBe('/agents/omp-u3/stop');
    expect(stopRoute(AGENTS[1])).toBe('/agents/panes/work-1/stop');
    expect(stopRoute(AGENTS[3])).toBeNull();
  });

  it('resolves projects by path, name, folder or unique prefix', () => {
    const opts = { cwd: '/home/hape', home: '/home/hape' };
    expect(resolveProject(PROJECTS, '~/src/x', opts)).toBe('/home/hape/src/x');
    expect(resolveProject(PROJECTS, './x', opts)).toBe('/home/hape/x');
    expect(resolveProject(PROJECTS, '/abs', opts)).toBe('/abs');
    expect(resolveProject(PROJECTS, 'app', opts)).toBe('/p/app');
    expect(resolveProject(PROJECTS, 'apI', opts)).toBe('/p/api');
    expect(() => resolveProject(PROJECTS, 'a', opts)).toThrow(/several projects/);
    expect(() => resolveProject(PROJECTS, 'web', opts)).toThrow(/No project "web"/);
  });

  it('formats an agent block for the model to read', () => {
    const text = formatAgent(
      agent({
        orchestrator: true,
        displayState: 'needs-input',
        waitingFor: 'approval',
        prs: [{ number: 4, state: 'open', url: 'https://gh/pr/4' }],
        lastText: 'Tests pass.',
        paneId: 'p',
      }),
      NOW
    );
    expect(text).toBe(
      [
        'job1  needs input  claude  app@feat/login  "fix login"  [orchestrator]',
        '  waiting for: approval',
        '  PR #4 open: https://gh/pr/4',
        '  last: Tests pass.',
        '  active 2m ago · Orkumo pane',
      ].join('\n')
    );
  });

  it('caps the PR lines of an agent that touched many', () => {
    const prs = [1, 2, 3, 4, 5].map((n) => ({ number: n, state: 'open', url: `u${n}` }));
    const lines = formatAgent(agent({ prs }), NOW).split('\n');
    expect(lines.filter((l) => l.startsWith('  PR '))).toHaveLength(3);
    expect(lines).toContain('  … 2 more PRs ("orkumo agents --json" lists all)');
  });
});

describe('commands', () => {
  it('agents: lists blocks, --all and --json pass through', async () => {
    const { code, out, calls } = await cli(['agents']);
    expect(code).toBe(0);
    expect(calls[0].route).toBe('/orchestrator/overview');
    expect(out).toContain('job1  working  claude  app@feat/login  "fix login"');
    const all = await cli(['agents', '--all', '--json']);
    expect(all.calls[0].route).toBe('/orchestrator/overview?all=1');
    expect(JSON.parse(all.out).agents).toHaveLength(4);
  });

  it('agents: says how to see finished ones when nothing runs', async () => {
    const { out } = await cli(['agents'], {
      'GET /orchestrator/overview': () => [200, { agents: [] }],
    });
    expect(out).toMatch(/--all/);
  });

  it('show: resolves the agent, then reads its transcript', async () => {
    const { code, out, calls } = await cli(['show', 'tty', '--last', '3'], {
      'GET /orchestrator/agents/interactive-77/transcript': () => [
        200,
        { agent: { id: 'interactive-77' }, entries: [{ role: 'assistant', text: 'All green.' }] },
      ],
    });
    expect(code).toBe(0);
    expect(calls.map((c) => c.route)).toEqual([
      '/orchestrator/overview?all=1&text=0',
      '/orchestrator/agents/interactive-77/transcript?last=3',
    ]);
    expect(out).toContain('── assistant\nAll green.');
    expect((await cli(['show', 'job1', '--last', '0'])).code).toBe(2);
  });

  it('send: replies to a background job', async () => {
    const { code, out, calls } = await cli(['send', 'job1', 'please', 'rebase'], {
      'POST /agents/job1/reply': () => [200, { delivered: true, mode: 'attach' }],
    });
    expect(code).toBe(0);
    expect(calls[1]).toMatchObject({
      method: 'POST',
      route: '/agents/job1/reply',
      body: { text: 'please rebase' },
    });
    expect(out).toBe('Sent to job1 (fix login).');
  });

  it('send: types into the pane of a pane agent, message from stdin', async () => {
    const { calls } = await cli(
      ['send', 'interactive-77', '-'],
      { 'POST /agents/panes/work-1/message': () => [200, { delivered: true }] },
      { stdin: 'line one\nline two\n' }
    );
    expect(calls[1]).toMatchObject({
      route: '/agents/panes/work-1/message',
      body: { text: 'line one\nline two' },
    });
  });

  it('send: refuses agents outside Orkumo and empty messages', async () => {
    const outside = await cli(['send', 'interactive-88', 'hi']);
    expect(outside.code).toBe(1);
    expect(outside.err).toMatch(/runs outside Orkumo/);
    expect(outside.calls).toHaveLength(1);
    const empty = await cli(['send', 'job1']);
    expect(empty.code).toBe(2);
    expect(empty.err).toMatch(/message is empty/);
  });

  it('start: Claude Code goes to the dispatch route as a background session', async () => {
    const { code, out, calls } = await cli(
      ['start', '--project', 'app', '--name', 'login-fix', 'Fix', 'the', 'login'],
      { 'POST /agents/dispatch': () => [201, { id: 'new1', name: 'login-fix' }] }
    );
    expect(code).toBe(0);
    expect(calls[1]).toMatchObject({
      route: '/agents/dispatch',
      body: { prompt: 'Fix the login', cwd: '/p/app', name: 'login-fix' },
    });
    expect(out).toMatch(/^Started new1 \(login-fix\): background Claude Code session in \/p\/app/);
  });

  it('start: omp goes to an agent pane in the project', async () => {
    const { code, out, err, calls } = await cli(
      ['start', '--project', '/p/api', '--harness', 'omp', '--name', 'x', 'Write', 'tests'],
      {
        'POST /orchestrator/panes': () => [
          201,
          { paneId: 'work-9', sessionId: 'u9', harness: 'omp' },
        ],
      }
    );
    expect(code).toBe(0);
    expect(calls[1]).toMatchObject({
      route: '/orchestrator/panes',
      body: { harness: 'omp', cwd: '/p/api', prompt: 'Write tests' },
    });
    expect(out).toBe('Started omp-u9 in Orkumo pane work-9 (/p/api).');
    expect(err).toMatch(/--name is ignored/);
  });

  it('start: follows the default harness and rejects ones without a pane or bad prompts', async () => {
    const routes = {
      'GET /orchestrator/projects': () => [200, { projects: PROJECTS, defaultHarness: 'omp' }],
      'POST /orchestrator/panes': () => [201, { paneId: 'work-2', sessionId: 'u2' }],
    };
    expect((await cli(['start', '--project', 'app', 'do it now'], routes)).calls[1].route).toBe(
      '/orchestrator/panes'
    );
    expect((await cli(['start', '--project', 'app', '--harness', 'codex', 'do it'])).code).toBe(2);
    expect((await cli(['start', 'do it'])).err).toMatch(/needs --project/);
    expect((await cli(['start', '--project', 'app', 'hi'])).err).toMatch(/too short/);
  });

  it('stop: by id for jobs and omp, by pane for pane agents', async () => {
    const routes = {
      'POST /agents/omp-u3/stop': () => [200, { output: '' }],
      'POST /agents/panes/work-1/stop': () => [200, { stopped: 1 }],
    };
    expect((await cli(['stop', 'omp-u3'], routes)).calls[1].route).toBe('/agents/omp-u3/stop');
    expect((await cli(['stop', 'work-1'], routes)).calls[1].route).toBe(
      '/agents/panes/work-1/stop'
    );
    expect((await cli(['stop', 'interactive-88'])).err).toMatch(/PID 88/);
  });

  it('projects: lists name, path and agent count', async () => {
    const { out } = await cli(['projects']);
    expect(out).toBe('App  /p/app  (1 agent)\nApi  /p/api');
  });

  it('reports API errors with the route and an unreachable server with the fix', async () => {
    const failing = await cli(['agents'], {
      'GET /orchestrator/overview': () => [500, { error: 'claude agents --json failed' }],
    });
    expect(failing.code).toBe(1);
    expect(failing.err).toBe(
      'orkumo: GET /orchestrator/overview failed (500): claude agents --json failed'
    );
    const code = await run(['agents'], {
      fetch: async () => {
        throw new Error('ECONNREFUSED');
      },
      env: { ORKUMO_API_URL: 'http://api.test/api' },
      out: () => {},
      err: (s) =>
        expect(s).toMatch(/not reachable at http:\/\/api.test\/api.*Start the Orkumo app/),
    });
    expect(code).toBe(1);
  });

  it('help: prints usage', async () => {
    expect((await cli(['help'])).out).toMatch(/orkumo agents/);
  });
});

describe('guard (PreToolUse hook)', () => {
  let ws;
  beforeEach(() => {
    ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orkumo-ws-')));
  });
  afterEach(() => fs.rmSync(ws, { recursive: true, force: true }));

  it('lets writes inside the workspace pass and blocks the rest', () => {
    expect(guardDecision({ tool_input: { file_path: path.join(ws, 'NOTES.md') } }, ws)).toBeNull();
    expect(guardDecision({ tool_input: { file_path: 'new/plan.md' }, cwd: ws }, ws)).toBeNull();
    expect(guardDecision({ tool_input: { file_path: '/p/app/src/x.ts' } }, ws)).toMatch(
      /never edit files outside/
    );
    expect(
      guardDecision({ tool_input: { notebook_path: path.join(ws, '..', 'x.ipynb') } }, ws)
    ).toMatch(/blocked/);
    expect(guardDecision({ tool_input: {} }, ws)).toBeNull();
  });

  it('blocks a symlink out of the workspace', () => {
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orkumo-out-')));
    fs.symlinkSync(outside, path.join(ws, 'escape'));
    expect(guardDecision({ tool_input: { file_path: path.join(ws, 'escape', 'f') } }, ws)).toMatch(
      /blocked/
    );
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('exits 2 with the reason on stderr, as Claude Code expects', async () => {
    fs.mkdirSync(path.join(ws, 'bin'));
    fs.writeFileSync(path.join(ws, 'bin', 'orkumo.json'), JSON.stringify({ workspace: ws }));
    const blocked = await cli(
      ['guard'],
      {},
      {
        stdin: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: '/etc/hosts' } }),
        scriptDir: path.join(ws, 'bin'),
      }
    );
    expect(blocked.code).toBe(2);
    expect(blocked.err).toMatch(/orkumo send/);
    const allowed = await cli(
      ['guard'],
      {},
      {
        stdin: JSON.stringify({
          tool_name: 'Write',
          tool_input: { file_path: path.join(ws, 'a.md') },
        }),
        scriptDir: path.join(ws, 'bin'),
      }
    );
    expect(allowed.code).toBe(0);
  });
});
