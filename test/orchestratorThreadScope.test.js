import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Threads belong to one orchestrator chat (session), over the real path: HTTP -> server -> files
 * in the data dir, then a server restart on the same dir. Two orchestrators share one role, as
 * in the misplaced-thread report; only `claude agents --json` is a stub.
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orkumo-thread-scope-'));
const home = path.join(tmp, 'home');
const data = path.join(tmp, 'data');
const threadsDir = path.join(data, 'orchestrator-reports', 'threads');
let server;
let api;

async function startServer() {
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
}

const stopServer = () =>
  new Promise((resolve) => {
    server.once('exit', resolve);
    server.kill();
  });

const list = async (session) =>
  (await fetch(`${api}/orchestrator/threads?session=${session}`)).json();
const ids = async (session) => (await list(session)).threads.map((t) => t.id).sort();
const create = async (session, task) => {
  const res = await fetch(`${api}/orchestrator/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session, name: { project: 'Demo', task } }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).thread;
};
const stored = (key) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(threadsDir, `${key}.json`), 'utf8')).threads;
  } catch {
    return [];
  }
};

// Threads as the role-keyed store left them: one file for both orchestrators of the role
const legacyThread = (id, tag, parentKey = null) => ({
  id,
  tag,
  name: { project: 'Answer 10:00', task: id },
  binding: null,
  parentKey,
  agents: [],
  createdAt: 1,
  readAt: 1,
  closed: false,
});
const LEGACY = [
  // the answered message is in A's transcript only
  legacyThread(
    '00000000-0000-4000-8000-00000000000a',
    '[Thread: Answer 10:00 · first]',
    'msg_fixture_a'
  ),
  // its tag was typed into B only
  legacyThread('00000000-0000-4000-8000-00000000000b', '[Thread: Thread 10:05 · second]'),
  // its tag is in both: not provable
  legacyThread('00000000-0000-4000-8000-0000000000ab', '[Thread: Thread 10:10 · both]'),
  // in neither: not provable
  legacyThread('00000000-0000-4000-8000-000000000000', '[Thread: Thread 10:15 · none]'),
];

const claudeRecord = (type, text, id) =>
  JSON.stringify({
    type,
    timestamp: '2026-11-25T10:00:00.000Z',
    message: { ...(id ? { id } : {}), role: type, content: [{ type: 'text', text }] },
  });

beforeAll(async () => {
  fs.mkdirSync(threadsDir, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const sessions = [
    { kind: 'interactive', sessionId: 'sess-a', cwd: tmp, pid: 4242, status: 'idle' },
    { kind: 'interactive', sessionId: 'sess-b', cwd: tmp, pid: 4343, status: 'idle' },
    { kind: 'interactive', sessionId: 'sess-c', cwd: tmp, pid: 4444, status: 'idle' },
  ];
  fs.writeFileSync(path.join(home, 'claude'), `#!/bin/sh\necho '${JSON.stringify(sessions)}'\n`, {
    mode: 0o755,
  });
  fs.writeFileSync(
    path.join(data, 'settings.json'),
    JSON.stringify({
      agentView: {
        orchestrators: ['sess-a', 'sess-b', 'sess-c'],
        orchestratorRoles: { 'sess-a': 'main', 'sess-b': 'main' },
      },
    })
  );
  fs.writeFileSync(path.join(threadsDir, 'main.json'), JSON.stringify({ threads: LEGACY }));
  // Claude terminal transcripts: <CLAUDE_CONFIG_DIR>/projects/<slug of cwd>/<sessionId>.jsonl
  const dir = path.join(home, '.claude', 'projects', tmp.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'sess-a.jsonl'),
    [
      claudeRecord('assistant', 'An answer.', 'msg_fixture_a'),
      claudeRecord('user', `${LEGACY[2].tag}\nhello`),
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(dir, 'sess-b.jsonl'),
    [
      claudeRecord('user', `${LEGACY[1].tag}\nhello`),
      claudeRecord('user', `${LEGACY[2].tag}\nhello`),
      claudeRecord('assistant', 'Mentions msg_fixture_a in passing.', 'msg_fixture_b'),
    ].join('\n')
  );
  await startServer();
}, 90_000);

afterAll(async () => {
  if (server && server.exitCode === null) await stopServer();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('threads of an orchestrator chat', () => {
  const LEFTOVERS = [LEGACY[3].id, LEGACY[2].id].sort();

  it('a misplaced thread goes back to the orchestrator its transcript proves; others stay', async () => {
    expect(await ids('sess-a')).toEqual([LEGACY[0].id, ...LEFTOVERS].sort());
    expect(await ids('sess-b')).toEqual([LEGACY[1].id, ...LEFTOVERS].sort());
    expect(
      stored('main')
        .map((t) => t.id)
        .sort()
    ).toEqual(LEFTOVERS);
    // moved as they were: nothing rewritten
    expect(stored('sess-a')).toEqual([LEGACY[0]]);
    expect(stored('sess-b')).toEqual([LEGACY[1]]);
  });

  it('two orchestrators of one role, one new thread each: each lists only its own', async () => {
    const a = await create('sess-a', 'website task');
    const b = await create('sess-b', 'main task');
    expect(await ids('sess-a')).toContain(a.id);
    expect(await ids('sess-a')).not.toContain(b.id);
    expect(await ids('sess-b')).toContain(b.id);
    expect(await ids('sess-b')).not.toContain(a.id);
    // an orchestrator without a role is untouched by both
    expect(await ids('sess-c')).toEqual([]);
  });

  it('a leftover thread is still updated in place', async () => {
    const res = await fetch(`${api}/orchestrator/threads/${LEGACY[3].id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: 'sess-a', closed: true }),
    });
    expect(res.status).toBe(200);
    expect(stored('main').find((t) => t.id === LEGACY[3].id).closed).toBe(true);
  });

  it('a thread in both files (a repair cut short) is listed once', async () => {
    const file = path.join(threadsDir, 'main.json');
    const before = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, JSON.stringify({ threads: [...stored('main'), LEGACY[0]] }));
    try {
      const listed = (await list('sess-a')).threads.map((t) => t.id);
      expect(listed.filter((id) => id === LEGACY[0].id)).toHaveLength(1);
    } finally {
      fs.writeFileSync(file, before);
    }
  });

  it('after a server restart (reload) the same split; the repair changes nothing more', async () => {
    const before = { a: await ids('sess-a'), b: await ids('sess-b') };
    const files = ['main', 'sess-a', 'sess-b'].map(stored);
    await stopServer();
    await startServer();
    expect(await ids('sess-a')).toEqual(before.a);
    expect(await ids('sess-b')).toEqual(before.b);
    expect(['main', 'sess-a', 'sess-b'].map(stored)).toEqual(files);
    // no thread lost: every legacy thread is in exactly one file
    const all = files.flat().map((t) => t.id);
    for (const t of LEGACY) expect(all.filter((id) => id === t.id)).toHaveLength(1);
  }, 90_000);
});
