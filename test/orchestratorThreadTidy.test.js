import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Thread names (AC-9) and the tidy-up layer (AC-10) over the real path: `orkumo` CLI entry ->
 * HTTP -> server -> thread file, on a real Claude transcript fixture. Only the `claude` binary is
 * a stub at the process boundary (`agents --json` lists the sessions, `--bg` starts a job).
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'server/orchestrator/orkumo.mjs');

const ORCH = '0a0a0a0a-0000-4000-8000-0000000000a1';
const WORKER = '0b0b0b0b-0000-4000-8000-0000000000b2';
const JOB = 'job77777';
const JOB_SESSION = '0c0c0c0c-0000-4000-8000-0000000000c3';
const ROLE = 'lead';
const id = (n) => `11111111-0000-4000-8000-00000000000${n}`;
const [T1, T2, T3, T4, T5, T6, T7] = [1, 2, 3, 4, 5, 6, 7].map(id);

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

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orkumo-tidy-')));
const home = path.join(tmp, 'home');
const data = path.join(tmp, 'data');
const projects = path.join(tmp, 'projects');
const ws = path.join(tmp, 'ws');
const shop = path.join(projects, 'demo-shop');
const weather = path.join(projects, 'weather-app');
const docs = path.join(projects, 'docs-site');
// threads are kept per orchestrator session (a Claude terminal: its transcript uuid)
const threadFile = path.join(data, 'orchestrator-reports/threads', `${ORCH}.json`);
const transcript = path.join(
  home,
  '.claude/projects',
  ws.replace(/[^a-zA-Z0-9]/g, '-'),
  `${ORCH}.jsonl`
);
let server;
let api;

/** The CLI as an agent runs it: its session in ORKUMO_AGENT_ID */
const cli = (args, agentId = ORCH) =>
  spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: home,
      ORKUMO_API_URL: api,
      ...(agentId ? { ORKUMO_AGENT_ID: agentId } : {}),
    },
  });
const cliJson = (args) => {
  const run = cli([...args, '--json']);
  expect(run.stderr).toBe('');
  return JSON.parse(run.stdout);
};

const list = async () => (await fetch(`${api}/orchestrator/threads?session=${ORCH}`)).json();
const send = (method, route, body) =>
  fetch(`${api}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const fileState = () => fs.readFileSync(threadFile, 'utf8');
const byId = (threads, tid) => threads.find((t) => t.id === tid);

// ---- transcript fixture ------------------------------------------------------------------
const T0 = Date.parse('2026-11-24T09:00:00Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const user = (uuid, text, s) => ({
  type: 'user',
  uuid,
  timestamp: at(s),
  message: { role: 'user', content: text },
});
const answer = (msgId, text, s) => ({
  type: 'assistant',
  uuid: crypto.randomUUID(),
  timestamp: at(s),
  message: { id: msgId, role: 'assistant', content: [{ type: 'text', text }] },
});
const done = (s) => ({
  type: 'system',
  subtype: 'turn_duration',
  durationMs: 900,
  timestamp: at(s),
});
const header = (sid, name) => `[from agent ${sid} "${name}" via orkumo send]\n\n`;

const RECORDS = [
  user('u-01', 'hello', 1),
  answer('msg_01', '- **Stand:** Das Briefing for demo shop is ready.', 2),
  done(3),
  user('u-02', 'what about the plan?', 4),
  answer('msg_02', 'Plan: three steps, nothing decided yet.', 5),
  done(6),
  user('u-03', '[Thread: Weather Station · Cache]\nship the cache?', 7),
  answer('msg_03', '[Thread: Weather Station · Cache]\nYes.', 8),
  done(9),
  user('u-04', '[Thread: Weather Station · Cache 2]\nand offline?', 10),
  // untagged: the turn of the thread prompt before it
  answer('msg_04', 'Offline works too.', 11),
  done(12),
  user('u-05', `${header(WORKER, 'checkout-fix')}Tests pass.`, 13),
  answer('msg_05', 'Good, merge it.', 14),
  done(15),
  user('u-06', '[Thread: docs-site · Guide]\nwrite the guide', 16),
  answer('msg_06', '[Thread: docs-site · Guide]\nDone.', 17),
  done(18),
  user('u-07', 'Is the Demo Shop checkout merged?', 19),
  answer('msg_07', 'Checkout of Demo Shop is merged.', 20),
  done(21),
  user('u-08', '[Thread: Answer 18:39 · Stand: Das Briefing]\nmore detail', 22),
  answer('msg_08', '[Thread: Answer 18:39 · Stand: Das Briefing]\nDetail.', 23),
  done(24),
];
const ENTRIES = 16;

const legacy = (tid, project, task, extra = {}) => ({
  id: tid,
  tag: `[Thread: ${project} · ${task}]`,
  name: { project, task },
  binding: null,
  parentKey: null,
  agents: [],
  createdAt: T0 - 1000,
  readAt: T0 - 1000,
  closed: false,
  ...extra,
});
const LEGACY = [
  {
    ...legacy(T1, 'Answer 18:39', 'Stand: Das Briefing', { parentKey: 'msg_01' }),
    name: { project: 'Answer 18:39', task: '- **Stand:** Das Briefing…' },
  },
  // an older history page's prefix on the key
  legacy(T2, 'Answer 18:40', 'Plan', { parentKey: 'h40:msg_02' }),
  legacy(T3, 'Answer 18:41', 'Kept by hand', { parentKey: 'msg_07', renamed: true }),
  legacy(T4, 'demo-shop', 'checkout-fix', { agents: [WORKER] }),
  legacy(T5, 'Weather Station', 'Cache'),
  legacy(T6, 'Weather Station', 'Cache 2'),
  legacy(T7, 'docs-site', 'Guide'),
];

function gitProject(dir, pkgName) {
  fs.mkdirSync(dir, { recursive: true });
  spawnSync('git', ['init', '-q', dir]);
  if (pkgName) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: pkgName }));
}

beforeAll(async () => {
  for (const d of [data, home, ws]) fs.mkdirSync(d, { recursive: true });
  gitProject(shop, 'Demo Shop');
  gitProject(weather, 'Weather Station');
  gitProject(docs);
  const sessions = [
    { kind: 'interactive', sessionId: ORCH, cwd: ws, pid: 4242, status: 'idle', name: 'Lead' },
    {
      kind: 'interactive',
      sessionId: WORKER,
      cwd: shop,
      pid: 4343,
      status: 'idle',
      name: 'checkout-fix',
    },
    { kind: 'background', id: JOB, sessionId: JOB_SESSION, cwd: weather, name: 'cache-job' },
  ];
  fs.writeFileSync(
    path.join(home, 'claude'),
    `#!/bin/sh\ncase " $* " in\n  *" --bg "*) echo "backgrounded · ${JOB} · cache-job" ;;\n  *) echo '${JSON.stringify(sessions)}' ;;\nesac\n`,
    { mode: 0o755 }
  );
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ directories: [projects] }));
  fs.writeFileSync(
    path.join(data, 'settings.json'),
    JSON.stringify({ agentView: { orchestrators: [ORCH], orchestratorRoles: { [ORCH]: ROLE } } })
  );
  fs.mkdirSync(path.dirname(threadFile), { recursive: true });
  fs.writeFileSync(threadFile, JSON.stringify({ threads: LEGACY }));
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  fs.writeFileSync(transcript, RECORDS.map((r) => `${JSON.stringify(r)}\n`).join(''));

  const port = await freePort();
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: home,
      CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
      SERVER_PORT: String(port),
      DEVORBIT_DATA_PATH: data,
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

const MARKDOWN = /\*\*|`|^\s*[-#]/;
const transcriptHash = () =>
  crypto.createHash('sha256').update(fs.readFileSync(transcript)).digest('hex');
const START_HASH = () => transcriptHash();

describe('names after the project (AC-9)', () => {
  it('old "Answer HH:MM" threads are renamed on load, the manual one is kept; idempotent', async () => {
    const { threads } = await list();
    // the answer it was opened on names Demo Shop (case-insensitive): project = task = name
    expect(byId(threads, T1)).toMatchObject({
      name: { project: 'Demo Shop', task: 'Demo Shop' },
      tag: LEGACY[0].tag,
      autoName: true,
    });
    // nothing known in its answer: a neutral provisional name the orchestrator replaces
    expect(byId(threads, T2)).toMatchObject({
      name: { project: 'Lead', task: 'New topic' },
      autoName: true,
      tag: LEGACY[1].tag,
    });
    expect(byId(threads, T3).name).toEqual(LEGACY[2].name);
    // a name the user gave stays, even one that looks like an old automatic one
    for (const t of threads.filter((x) => x.id !== T3)) {
      expect(t.name.project, t.id).not.toMatch(/^Answer /);
      expect(`${t.name.project} ${t.name.task}`).not.toMatch(MARKDOWN);
    }
    const once = fileState();
    const written = fs.statSync(threadFile).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    expect((await list()).threads).toEqual(threads);
    expect(fileState()).toBe(once);
    // a poll that changes nothing does not write the file
    expect(fs.statSync(threadFile).mtimeMs).toBe(written);
  });

  it('an answer thread is named by the first known project its answer mentions, markdown stripped', async () => {
    const create = async (answerText) => {
      const res = await send('POST', '/orchestrator/threads', {
        session: ORCH,
        parentKey: `k-${crypto.randomUUID()}`,
        answerText,
      });
      expect(res.status).toBe(201);
      return (await res.json()).thread;
    };
    const weatherFirst = await create(
      '## **Status:** `weather station` cache done; docs-site and Demo Shop next'
    );
    expect(weatherFirst.name).toEqual({ project: 'Weather Station', task: 'Weather Station' });
    expect(weatherFirst.autoName).toBe(true);
    // earliest position wins; a repo folder name counts too
    const docsFirst = await create('- docs-site first, then demo-shop');
    expect(docsFirst.name.project).toBe('docs-site');
    // word boundaries: "demo-shopper" is no project
    const none = await create('**Stand:** the demo-shopper idea, nothing else');
    expect(none).toMatchObject({ name: { project: 'Lead', task: 'New topic 2' }, autoName: true });
    expect(none.tag).not.toMatch(MARKDOWN);
    for (const t of [weatherFirst, docsFirst, none])
      expect(
        await send('PATCH', `/orchestrator/threads/${t.id}`, { session: ORCH, closed: true })
      ).toHaveProperty('status', 200);
  });

  it('CLI rename names an auto thread for good; a manual UI rename wins over CLI and auto-naming', async () => {
    const run = cli(['thread', 'rename', T2, 'Release', '·', 'Plan']);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    let t = byId((await list()).threads, T2);
    expect(t).toMatchObject({ name: { project: 'Release', task: 'Plan' }, autoName: false });
    expect(t.renamed).toBeFalsy();

    const ui = await send('PATCH', `/orchestrator/threads/${T2}`, {
      session: ORCH,
      name: { project: 'Mine', task: 'Hands off' },
    });
    expect(ui.status).toBe(200);
    expect((await ui.json()).thread).toMatchObject({ renamed: true });
    const refused = cli(['thread', 'rename', T2, 'Other · Name']);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/renamed by the user/);
    t = byId((await list()).threads, T2);
    expect(t.name).toEqual({ project: 'Mine', task: 'Hands off' });
    // the manual rename of T3 is refused the same way
    expect(cli(['thread', 'rename', T3, 'X · Y']).stderr).toMatch(/renamed by the user/);
    // CLI rename is undoable; a refused one pushes nothing
    expect(cli(['thread', 'undo']).status).toBe(0);
    expect(byId((await list()).threads, T2).name).toEqual({ project: 'Mine', task: 'Hands off' });
    expect((await list()).canUndo).toBe(false);
  });
});

describe('entry keys (AC-10)', () => {
  it('the chat stream carries the transcript key of every user message', async () => {
    const { TRANSCRIPT_READERS } = await import('../server/services/chatTranscripts.js');
    const events = TRANSCRIPT_READERS.claude.historyEvents(
      fs.readFileSync(transcript, 'utf8').split('\n')
    );
    const users = events.filter((e) => e.type === 'devorbit_user');
    expect(users.map((e) => e.key)).toEqual([
      'u-01',
      'u-02',
      'u-03',
      'u-04',
      'u-05',
      'u-06',
      'u-07',
      'u-08',
    ]);
  });

  it('thread messages lists the same keys, routed as the UI routes', () => {
    const main = cliJson(['thread', 'messages', 'main']);
    expect(main.entries.map((e) => e.key)).toEqual([
      'u-01',
      'msg_01',
      'u-02',
      'msg_02',
      'u-07',
      'msg_07',
    ]);
    expect(cliJson(['thread', 'messages', T6]).entries.map((e) => e.key)).toEqual([
      'u-04',
      'msg_04',
    ]);
    expect(cliJson(['thread', 'messages', T4]).entries.map((e) => e.key)).toEqual([
      'u-05',
      'msg_05',
    ]);
    const text = cli(['thread', 'messages', 'main']);
    expect(text.status).toBe(0);
    expect(text.stdout).toMatch(/u-07 .*Demo Shop checkout/);
  });
});

describe('tidy-up (AC-10)', () => {
  const count = (l) => l.main.entries + l.threads.reduce((n, t) => n + t.entries, 0);

  it('non-orchestrators and unknown senders are refused, nothing stored', async () => {
    await list();
    const before = fileState();
    const asWorker = cli(['thread', 'merge', T5, T6], WORKER);
    expect(asWorker.status).toBe(1);
    expect(asWorker.stderr).toMatch(/Not an orchestrator chat/);
    expect(cli(['thread', 'list'], WORKER).status).toBe(1);
    expect(cli(['thread', 'undo'], '').status).toBe(1);
    const ui = await send('POST', '/orchestrator/threads/undo', { session: WORKER });
    expect(ui.status).toBe(404);
    expect(fileState()).toBe(before);
  });

  it('one thread per project, every entry kept; undo restores the start exactly', async () => {
    await list();
    const start = fileState();
    const hash = START_HASH();
    const before = cliJson(['thread', 'list']);
    expect(before.threads.filter((t) => !t.closed).length).toBeGreaterThanOrEqual(6);
    expect(count(before)).toBe(ENTRIES);
    expect(before.main.entries).toBe(6);
    const text = cli(['thread', 'list']);
    expect(text.stdout).toMatch(new RegExp(`${T5}\\s+Weather Station · Cache .*2 entries`));

    const steps = [
      ['merge', T5, T6],
      ['merge', T4, T1],
      ['rename', T4, 'Demo Shop · Checkout'],
      ['move', 'msg_01', 'u-07', 'msg_07', T4],
      ['close', T2],
      ['close', T3],
    ];
    for (const step of steps) {
      const run = cli(['thread', ...step]);
      expect(run.stderr, step.join(' ')).toBe('');
      expect(run.status).toBe(0);
    }
    const after = cliJson(['thread', 'list']);
    expect(count(after)).toBe(ENTRIES);
    const open = after.threads.filter((t) => !t.closed && !t.mergedInto);
    const projectsOf = open.map((t) => t.project);
    expect(new Set(projectsOf).size).toBe(projectsOf.length);
    expect(projectsOf.sort()).toEqual(['Demo Shop', 'Weather Station', 'docs-site']);
    expect(byId(after.threads, T5).entries).toBe(4);
    expect(byId(after.threads, T4).entries).toBe(7);
    expect(after.main.entries).toBe(3);
    // the UI gets the layer and the undo flag
    const ui = await list();
    expect(ui.overrides).toEqual({
      entries: { msg_01: T4, 'u-07': T4, msg_07: T4 },
      merged: { [T6]: T5, [T1]: T4 },
    });
    expect(ui.canUndo).toBe(true);

    // last step first: one undo reverts exactly the last action
    expect(cli(['thread', 'undo']).stdout).toMatch(/close/);
    expect(byId((await list()).threads, T3).closed).toBe(false);
    for (let i = 1; i < steps.length - 1; i++) expect(cli(['thread', 'undo']).status).toBe(0);
    // the UI's button: the same stack over the route
    const res = await send('POST', '/orchestrator/threads/undo', { session: ORCH });
    expect(res.status).toBe(200);
    expect((await res.json()).canUndo).toBe(false);
    expect(fileState()).toBe(start);
    expect(cli(['thread', 'undo']).status).toBe(1);
    expect(transcriptHash()).toBe(hash);
  }, 30000); // ~20 CLI processes against a live server; 5 s is too tight in a full parallel run

  it('a manual UI rename after a tidy action survives its undo; bind and unknown keys', async () => {
    expect(cli(['thread', 'close', T7]).status).toBe(0);
    await send('PATCH', `/orchestrator/threads/${T5}`, {
      session: ORCH,
      name: { project: 'Weather Station', task: 'Mine' },
    });
    expect(cli(['thread', 'undo']).status).toBe(0);
    const { threads } = await list();
    expect(byId(threads, T7).closed).toBe(false);
    expect(byId(threads, T5)).toMatchObject({ name: { task: 'Mine' }, renamed: true });

    const bad = cli(['thread', 'move', 'nope-key', T4]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/nope-key/);

    // bind an agent: its messages leave the thread that linked it before
    expect(cli(['thread', 'bind', T7, '--agent', WORKER]).status).toBe(0);
    const bound = cliJson(['thread', 'list']);
    expect(byId(bound.threads, T7).entries).toBe(4);
    expect(byId(bound.threads, T4).entries).toBe(0);
    expect(cli(['thread', 'undo']).status).toBe(0);
    expect(byId(cliJson(['thread', 'list']).threads, T4).entries).toBe(2);
  });
});

describe('orkumo start: registry name and session uuid (AC-9 fix)', () => {
  it('names the thread after the registered project and links job id and session uuid', async () => {
    const run = cli([
      'start',
      '--project',
      'weather-app',
      '--harness',
      'claude',
      '--name',
      'cache-job',
      'Build the offline cache',
    ]);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    const t = (await list()).threads.find((x) => x.agents.includes(JOB));
    expect(t).toMatchObject({ name: { project: 'Weather Station', task: 'cache-job' } });
    expect(t.agents).toContain(JOB_SESSION);
  });
});
