import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { threadOwnerKey } from '../server/services/orchestratorService.js';
import {
  createThreadStore,
  cleanName,
  taskThread,
  threadView,
  repoAgents,
  threadText,
  returnMisplacedThreads,
  routeEntries,
  createSenderScanner,
  createEntryScanner,
  threadName,
  isAutoNamed,
} from '../server/services/orchestratorThreads.js';
import example from '../server/orchestrator/report.example.json';

const T0 = Date.parse('2026-11-24T09:00:00Z');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'threads-'));
const report = JSON.parse(JSON.stringify(example));

describe('names', () => {
  it('one line, no brackets or quotes, capped', () => {
    expect(cleanName('  Plan\n for [today] "now"  ')).toBe('Plan for today now');
    expect(cleanName('x'.repeat(200)).length).toBeLessThanOrEqual(60);
    expect(cleanName(' \n ')).toBe('');
  });
});

describe('thread of a status task', () => {
  it('name, binding and linked agents from the report task', () => {
    const t = taskThread(report, { task: { project: 'beispiel-shop', task: 'checkout-umbau' } });
    expect(t).toEqual({
      name: { project: 'Beispiel-Shop', task: 'Checkout auf eine Seite verkürzen' },
      binding: { project: 'beispiel-shop', task: 'checkout-umbau' },
      agents: ['omp-aaaa0000-0000-0000-0000-000000000001'],
    });
  });

  it('an inbox entry binds to its task', () => {
    const t = taskThread(report, { entry: 'rabatt-limit' });
    expect(t?.binding).toEqual({ project: 'beispiel-shop', task: 'rabatt-codes' });
  });

  it('null for an unknown task', () => {
    expect(taskThread(report, { task: { project: 'beispiel-shop', task: 'nope' } })).toBeNull();
  });

  it('view: summary from title, note, entry description and refs; repo of the project', () => {
    const store = createThreadStore(tmp());
    const t = store.create('release', {
      ...taskThread(report, { task: { project: 'beispiel-shop', task: 'rabatt-codes' } }),
      now: T0,
    });
    const v = threadView(t, report);
    expect(v.repo).toBe('example-org/beispiel-shop');
    expect(v.summary).toContain('Wartet auf Entscheidung zur Begrenzung');
    expect(v.summary).toContain('#57');
    expect(threadView({ ...t, binding: null }, report).summary).toBeNull();
  });

  it('repo agents: sessions whose repo is the project repo, never the orchestrator', () => {
    const sessions = [{ id: 'w1' }, { id: 'w2' }, { id: 'orch' }];
    const contexts = {
      w1: { repo: { slug: 'Example-Org/Beispiel-Shop' } },
      w2: { repo: { slug: 'example-org/wetter-app' } },
      orch: { repo: { slug: 'example-org/beispiel-shop' } },
    };
    expect(repoAgents(report, 'beispiel-shop', sessions, contexts, 'orch')).toEqual(['w1']);
  });
});

describe('thread store', () => {
  it('creates, reuses a bound thread, keeps unbound names unique', () => {
    const store = createThreadStore(tmp());
    const bound = taskThread(report, {
      task: { project: 'beispiel-shop', task: 'checkout-umbau' },
    });
    const a = store.create('release', { ...bound, now: T0 });
    expect(a.tag).toBe('[Thread: Beispiel-Shop · Checkout auf eine Seite verkürzen]');
    expect(store.create('release', { ...bound, now: T0 + 1 }).id).toBe(a.id);
    const free = { name: { project: 'Answer 09:03', task: 'Plan' }, parentKey: 'm1' };
    const b = store.create('release', { ...free, now: T0 });
    const c = store.create('release', { ...free, parentKey: 'm2', now: T0 });
    expect(b.tag).toBe('[Thread: Answer 09:03 · Plan]');
    expect(c.tag).toBe('[Thread: Answer 09:03 · Plan 2]');
    expect(store.list('release')).toHaveLength(3);
    expect(store.list('other')).toEqual([]);
  });

  it('a reused thread that was closed opens again; links only grow', () => {
    const store = createThreadStore(tmp());
    const bound = taskThread(report, {
      task: { project: 'beispiel-shop', task: 'checkout-umbau' },
    });
    const a = store.create('release', { ...bound, now: T0 });
    store.update('release', a.id, { closed: true });
    const again = store.create('release', { ...bound, agents: ['w9'], now: T0 });
    expect(again.closed).toBe(false);
    expect(again.agents).toEqual(['omp-aaaa0000-0000-0000-0000-000000000001', 'w9']);
  });

  it('read time only moves forward; unknown thread is a 404', () => {
    const store = createThreadStore(tmp());
    const a = store.create('release', { name: { project: 'A', task: 'B' }, now: T0 });
    expect(store.update('release', a.id, { readAt: T0 + 5 }).readAt).toBe(T0 + 5);
    expect(store.update('release', a.id, { readAt: T0 + 1 }).readAt).toBe(T0 + 5);
    expect(() => store.update('release', 'nope', { closed: true })).toThrow(
      expect.objectContaining({ status: 404 })
    );
  });

  it('command marks: a command sent from the thread is marked at server time; cancel drops it', () => {
    const store = createThreadStore(tmp());
    const a = store.create('release', { name: { project: 'A', task: 'B' }, now: T0 });
    expect(a.commands).toEqual([]);
    store.update('release', a.id, { command: '/status-report', now: T0 + 1 });
    store.update('release', a.id, { command: '/skill:ping', now: T0 + 2 });
    expect(store.update('release', a.id, { cancelCommand: true }).commands).toEqual([
      { at: T0 + 1, command: '/status-report' },
    ]);
    for (let i = 0; i < 120; i++)
      store.update('release', a.id, { command: '/x', now: T0 + 10 + i });
    const marks = store.list('release')[0].commands;
    expect(marks).toHaveLength(100);
    expect(marks.at(-1)).toEqual({ at: T0 + 129, command: '/x' });
  });

  it('state survives a restart: written by one process, read by another', () => {
    const dir = tmp();
    const mod = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../server/services/orchestratorThreads.js'
    );
    const script = `
      const { createThreadStore } = await import(${JSON.stringify(mod)});
      const s = createThreadStore(${JSON.stringify(dir)});
      const t = s.create('release', { name: { project: 'Shop', task: 'Checkout' }, agents: ['w1'], now: ${T0} });
      s.update('release', t.id, { closed: true, readAt: ${T0 + 7} });
    `;
    execFileSync(process.execPath, ['--input-type=module', '-e', script]);
    const [t] = createThreadStore(dir).list('release');
    expect(t).toMatchObject({
      tag: '[Thread: Shop · Checkout]',
      agents: ['w1'],
      closed: true,
      readAt: T0 + 7,
      createdAt: T0,
    });
  });
});

describe('typed text', () => {
  it('the tag line in front of the message', () => {
    expect(threadText({ tag: '[Thread: A · B]' }, '[Status] A · B\n\nhi')).toBe(
      '[Thread: A · B]\n[Status] A · B\n\nhi'
    );
  });
});

describe('threads misplaced under a role', () => {
  const thread = (id, tag, parentKey = null) => ({ id, tag, parentKey, agents: [], closed: false });
  const KEYED = thread('k', '[Thread: Answer 09:00 · keyed]', 'msg_x');
  const TAGGED = thread('t', '[Thread: Thread 09:05 · tagged]');

  it('without every transcript only the answered message proves; a rerun changes nothing', async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'threads'));
    fs.writeFileSync(
      path.join(dir, 'threads', 'main.json'),
      JSON.stringify({ threads: [KEYED, TAGGED] })
    );
    const transcript = path.join(dir, 'a.jsonl');
    fs.writeFileSync(transcript, `{"message":{"id":"msg_x"}}\n{"text":"${TAGGED.tag} hi"}\n`);
    const holders = [
      { key: 'a', transcripts: [transcript] },
      { key: 'b', transcripts: [] },
    ];
    const read = (k) => JSON.parse(fs.readFileSync(path.join(dir, 'threads', `${k}.json`), 'utf8'));
    expect(await returnMisplacedThreads(dir, 'main', holders)).toBe(1);
    expect(read('a').threads).toEqual([KEYED]);
    expect(read('main').threads).toEqual([TAGGED]);
    expect(await returnMisplacedThreads(dir, 'main', holders)).toBe(0);
    // with b's transcript read, the tag proves a
    holders[1].transcripts = [path.join(dir, 'missing.jsonl')];
    expect(await returnMisplacedThreads(dir, 'main', holders)).toBe(1);
    expect(read('a').threads).toEqual([KEYED, TAGGED]);
  });

  it('a change to the role file during the scan is kept; a moved thread goes as it is then', async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'threads'));
    fs.writeFileSync(
      path.join(dir, 'threads', 'main.json'),
      JSON.stringify({
        threads: [
          { ...KEYED, readAt: 1 },
          { ...TAGGED, readAt: 1 },
        ],
      })
    );
    const transcript = path.join(dir, 'a.jsonl');
    fs.writeFileSync(transcript, `{"message":{"id":"msg_x"}}\n`);
    const holders = [
      { key: 'a', transcripts: [transcript] },
      { key: 'b', transcripts: [] },
    ];
    const store = createThreadStore(dir);
    const repair = returnMisplacedThreads(dir, 'main', holders);
    // PATCHes while the transcripts are read
    store.update('main', 't', { readAt: 5 });
    store.update('main', 'k', { readAt: 7 });
    expect(await repair).toBe(1);
    expect(store.list('main')).toEqual([{ ...TAGGED, readAt: 5 }]);
    expect(store.list('a')).toEqual([{ ...KEYED, readAt: 7 }]);
  });

  it('a Claude terminal keys its threads by its transcript uuid, not its pid row', () => {
    expect(threadOwnerKey({ id: 'interactive-42', sessionId: 'uuid-1' })).toBe('uuid-1');
    expect(threadOwnerKey({ id: 'omp-1', sessionId: '1' })).toBe('omp-1');
    expect(threadOwnerKey({ id: '13c54a91', sessionId: 'uuid-2' })).toBe('13c54a91');
  });

  it('a repair keeps the tidy-up layer and undo stack of both files', async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'threads'));
    const layer = { entries: { e1: 'main' }, merged: {} };
    const write = (k, doc) =>
      fs.writeFileSync(path.join(dir, 'threads', `${k}.json`), JSON.stringify(doc));
    write('main', { threads: [KEYED], overrides: layer, undo: [{ label: 'x' }] });
    write('a', { threads: [], overrides: { entries: { e2: 'k' }, merged: {} }, undo: [] });
    const transcript = path.join(dir, 'a.jsonl');
    fs.writeFileSync(transcript, `{"message":{"id":"msg_x"}}\n`);
    expect(
      await returnMisplacedThreads(dir, 'main', [{ key: 'a', transcripts: [transcript] }])
    ).toBe(1);
    const store = createThreadStore(dir);
    expect(store.state('a')).toMatchObject({
      threads: [KEYED],
      overrides: { entries: { e2: 'k' } },
    });
    expect(store.state('main')).toMatchObject({ threads: [], overrides: layer, canUndo: true });
  });
});

describe('a repair carries the tidy-up layer of the threads it moves (F2)', () => {
  const thread = (id, tag, parentKey = null) => ({ id, tag, parentKey, agents: [], closed: false });
  const K = thread('k', '[Thread: Shop · keyed]', 'msg_x');
  const K2 = thread('k2', '[Thread: Shop · second]', 'msg_y');
  const T = thread('t', '[Thread: Shop · tagged]');
  const MAIN_KEY = '7c1e0d2a-0000-4000-8000-00000000000a';
  const LOST_KEY = '7c1e0d2a-0000-4000-8000-00000000000b';
  const setup = (role, session) => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'threads'));
    const write = (k, doc) =>
      fs.writeFileSync(path.join(dir, 'threads', `${k}.json`), JSON.stringify(doc));
    write('main', role);
    write('a', session);
    const transcript = path.join(dir, 'a.jsonl');
    fs.writeFileSync(
      transcript,
      `{"message":{"id":"msg_x"}}\n{"message":{"id":"msg_y"}}\n{"uuid":"${MAIN_KEY}"}\n`
    );
    // b has a transcript too: a tag alone could prove, but T's tag is in neither
    const other = path.join(dir, 'b.jsonl');
    fs.writeFileSync(other, '{"message":{"id":"msg_z"}}\n');
    const holders = [
      { key: 'a', transcripts: [transcript] },
      { key: 'b', transcripts: [other] },
    ];
    const raw = (k) => fs.readFileSync(path.join(dir, 'threads', `${k}.json`), 'utf8');
    return { dir, holders, raw, store: createThreadStore(dir) };
  };

  it('entries and merge links go with their thread; the session decides first; undo stays true', async () => {
    const { dir, holders, raw, store } = setup(
      {
        threads: [K, K2, T],
        overrides: {
          entries: { ek: 'k', ek2: 'k2', et: 't', [MAIN_KEY]: 'main', [LOST_KEY]: 'main' },
          merged: { k2: 'k', t: 'k' },
        },
        undo: [
          { label: 'old merge', threads: [K, K2, T], overrides: { entries: {}, merged: {} } },
          { label: 'unrelated', threads: [T], overrides: { entries: {}, merged: {} } },
        ],
      },
      {
        threads: [],
        overrides: { entries: { ek: 'main' }, merged: {} },
        undo: [
          { label: 'own close', threads: [], overrides: { entries: { ek: 'main' }, merged: {} } },
        ],
      }
    );
    expect(await returnMisplacedThreads(dir, 'main', holders)).toBe(2);
    const a = store.state('a');
    expect(a.threads.map((t) => t.id)).toEqual(['k', 'k2']);
    // the session's own move of ek wins; ek2 and the proven main entry come along
    expect(a.overrides.entries).toEqual({ ek: 'main', ek2: 'k2', [MAIN_KEY]: 'main' });
    expect(a.overrides.merged).toEqual({ k2: 'k', t: 'k' });
    expect(a.canUndo).toBe(true);
    // unproven ones stay under the role, nothing dropped
    const role = store.state('main');
    expect(role.threads.map((t) => t.id)).toEqual(['t']);
    expect(role.overrides).toEqual({ entries: { et: 't', [LOST_KEY]: 'main' }, merged: {} });
    // a role snapshot of moved threads goes along with them: the role keeps its own part
    expect(JSON.parse(raw('main')).undo.map((u) => u.label)).toEqual(['old merge', 'unrelated']);
    expect(JSON.parse(raw('main')).undo[0].threads.map((t) => t.id)).toEqual(['t']);
    expect(JSON.parse(raw('a')).undo.map((u) => u.label)).toEqual(['old merge', 'own close']);
    // the session's own undo keeps the carried layer
    store.undo('a');
    expect(store.state('a').overrides.entries).toMatchObject({ ek2: 'k2', [MAIN_KEY]: 'main' });
    expect(store.state('a').overrides.merged).toEqual({ k2: 'k', t: 'k' });
    // a second run changes nothing
    const before = [raw('main'), raw('a')];
    expect(await returnMisplacedThreads(dir, 'main', holders)).toBe(0);
    expect([raw('main'), raw('a')]).toEqual(before);
  });

  it('F2-rest: a role undo of moved threads goes along to their session and takes back there only', async () => {
    const merged = { ...K2, closed: true };
    const { dir, holders, raw, store } = setup(
      {
        threads: [K, merged, T],
        overrides: { entries: { ek: 'k', et: 't' }, merged: { k2: 'k' } },
        undo: [
          {
            label: 'merge k2 into k',
            threads: [K, K2, T],
            overrides: { entries: { ek: 'k2', et: 't' }, merged: {} },
          },
        ],
      },
      { threads: [], overrides: { entries: {}, merged: {} }, undo: [] }
    );
    expect(await returnMisplacedThreads(dir, 'main', holders)).toBe(2);
    expect(store.state('a')).toMatchObject({
      threads: [K, merged],
      overrides: { entries: { ek: 'k' }, merged: { k2: 'k' } },
      canUndo: true,
    });
    // the role keeps the part of the snapshot that stays with it
    const role = JSON.parse(raw('main'));
    expect(role.undo).toEqual([
      { label: 'merge k2 into k', threads: [T], overrides: { entries: { et: 't' }, merged: {} } },
    ]);
    const roleBefore = raw('main');
    const bBefore = raw('b');
    const second = [raw('main'), raw('a')];
    expect(await returnMisplacedThreads(dir, 'main', holders)).toBe(0);
    expect([raw('main'), raw('a')]).toEqual(second);
    // the session takes it back: k2 open again, its entry back, no merge link; nothing else touched
    expect(store.undo('a')).toBe('merge k2 into k');
    expect(store.state('a')).toMatchObject({
      threads: [K, K2],
      overrides: { entries: { ek: 'k2' }, merged: {} },
      canUndo: false,
    });
    expect(raw('main')).toBe(roleBefore);
    expect(raw('b')).toBe(bBefore);
    expect(store.state('b').canUndo).toBe(false);
    expect(() => store.undo('a')).toThrow('Nothing to undo');
  });

  it('F2-rest: a run cut short before the role file shrank carries the undo once', async () => {
    const { dir, holders, store } = setup(
      {
        threads: [K],
        overrides: { entries: {}, merged: {} },
        undo: [{ label: 'rename', threads: [K], overrides: { entries: {}, merged: {} } }],
      },
      { threads: [], overrides: { entries: {}, merged: {} }, undo: [] }
    );
    const roleFile = path.join(dir, 'threads', 'main.json');
    const roleRaw = fs.readFileSync(roleFile, 'utf8');
    expect(await returnMisplacedThreads(dir, 'main', holders)).toBe(1);
    // the role write did not happen
    fs.writeFileSync(roleFile, roleRaw);
    await returnMisplacedThreads(dir, 'main', holders);
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, 'threads', 'a.json'), 'utf8')).undo
    ).toHaveLength(1);
    expect(store.state('main').canUndo).toBe(false);
  });

  it('threads moved by an earlier repair: their stranded entries follow', async () => {
    const { dir, holders, store } = setup(
      { threads: [T], overrides: { entries: { ek: 'k', et: 't' }, merged: { k2: 'k' } }, undo: [] },
      { threads: [K, K2], overrides: { entries: {}, merged: {} }, undo: [] }
    );
    expect(await returnMisplacedThreads(dir, 'main', holders)).toBe(0);
    expect(store.state('a').overrides).toEqual({ entries: { ek: 'k' }, merged: { k2: 'k' } });
    expect(store.state('main').overrides).toEqual({ entries: { et: 't' }, merged: {} });
  });
});

describe('sender scanner', () => {
  const line = (id, at) =>
    `${JSON.stringify({
      type: 'message',
      timestamp: new Date(at).toISOString(),
      message: {
        role: 'user',
        content: [{ type: 'text', text: `[from agent ${id} via orkumo send]\n\nhi` }],
      },
    })}\n`;

  it('reads only appended whole lines; a half-written line waits; a rewritten file starts over', async () => {
    const file = path.join(tmp(), 'orch.jsonl');
    const scan = createSenderScanner();
    const second = line('omp-bbbbbbbb', T0 + 2);
    fs.writeFileSync(file, line('omp-aaaaaaaa', T0) + second.slice(0, 20));
    expect([...(await scan(file)).keys()]).toEqual(['omp-aaaaaaaa']);
    fs.appendFileSync(file, second.slice(20) + line('omp-aaaaaaaa', T0 + 9));
    const senders = await scan(file);
    expect([...senders.keys()]).toEqual(['omp-aaaaaaaa', 'omp-bbbbbbbb']);
    expect(senders.get('omp-aaaaaaaa').ts).toBe(T0);
    fs.writeFileSync(file, line('omp-cccccccc', T0 + 20));
    expect([...(await scan(file)).keys()]).toEqual(['omp-cccccccc']);
  });
});

describe('entry scanner (CLI thread messages/move)', () => {
  it('F3: lists every entry of a long transcript, not only the last 5000', async () => {
    const { TRANSCRIPT_READERS } = await import('../server/services/chatTranscripts.js');
    const dir = tmp();
    const file = path.join(dir, 'long.jsonl');
    const lines = Array.from({ length: 5001 }, (_, i) =>
      JSON.stringify({
        type: 'user',
        uuid: `user-${i}`,
        timestamp: new Date(T0 + i).toISOString(),
        message: { role: 'user', content: `message ${i}` },
      })
    );
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    const items = await createEntryScanner()(file, TRANSCRIPT_READERS.claude);
    expect(items).toHaveLength(5001);
    expect(items[0].key).toBe('user-0');
    // the chat view keeps its replay cap
    expect(TRANSCRIPT_READERS.claude.historyEvents(lines)).toHaveLength(5000);
  });

  it('N2: two first scans of the same transcript at once list every entry once', async () => {
    const { TRANSCRIPT_READERS } = await import('../server/services/chatTranscripts.js');
    const file = path.resolve('test/fixtures/claude-bare-skill.jsonl');
    const once = await createEntryScanner()(file, TRANSCRIPT_READERS.claude);
    const scan = createEntryScanner();
    const [a, b] = await Promise.all([
      scan(file, TRANSCRIPT_READERS.claude),
      scan(file, TRANSCRIPT_READERS.claude),
    ]);
    const keys = (items) => items.map((i) => i.key);
    expect(keys(a)).toEqual(keys(once));
    expect(keys(b)).toEqual(keys(once));
    expect(keys(await scan(file, TRANSCRIPT_READERS.claude))).toEqual(keys(once));
  });
});

describe('server-made names (AC-9)', () => {
  const projects = [
    { name: 'Demo Shop', aliases: ['Demo Shop', 'demo-shop'] },
    { name: 'Beispiel-Shop', aliases: ['Beispiel-Shop', 'beispiel-shop'] },
  ];
  const ctx = {
    agentName: (id) => (id === 'w1' ? { project: 'Demo Shop', task: 'checkout-fix' } : null),
    report,
    projects,
    text: 'Beispiel-Shop first, then **demo-shop**',
    fallback: { project: 'Lead', task: 'New topic' },
  };
  const bound = { project: 'beispiel-shop', task: 'rabatt-codes' };
  it('agent before status task before project mention before the provisional name', () => {
    expect(threadName({ agents: ['x', 'w1'], binding: bound }, ctx)).toEqual({
      project: 'Demo Shop',
      task: 'checkout-fix',
    });
    expect(threadName({ agents: ['x'], binding: bound }, ctx)).toEqual({
      project: 'Beispiel-Shop',
      task: 'Rabattcodes pro Kunde begrenzen',
    });
    expect(threadName({ agents: [], binding: null }, ctx)).toEqual({
      project: 'Beispiel-Shop',
      task: 'Beispiel-Shop',
    });
    expect(threadName({ agents: [], binding: null }, { ...ctx, text: 'nothing' })).toBe(
      ctx.fallback
    );
  });
});

describe('orkumo start against a poll that linked the agent first', () => {
  it('the start thread is opened anyway and the bound thread lets go of the agent', () => {
    const store = createThreadStore(tmp());
    const task = store.create('lead', {
      name: { project: 'Shop', task: 'Checkout' },
      binding: { project: 'shop', task: 'checkout' },
      agents: ['job1', 'other'],
      now: T0,
    });
    // a backfill (no start) leaves it linked where it is
    expect(
      store.addAgentThreads('lead', [
        { agents: ['job1'], name: { project: 'Shop', task: 'x' }, now: T0 },
      ])
    ).toEqual([]);
    const [own] = store.addAgentThreads(
      'lead',
      [{ agents: ['job1'], name: { project: 'Shop', task: 'fix' }, now: T0 }],
      { start: true }
    );
    expect(own).toMatchObject({ agents: ['job1'], binding: null });
    // named by the server: it follows the agent's later name (omp titles a session after its
    // first turn; until then its name is the prompt), never past a rename by the user
    expect(isAutoNamed(own)).toBe(true);
    expect(store.list('lead').find((t) => t.id === task.id).agents).toEqual(['other']);
    // started again: its own thread exists, nothing new
    expect(
      store.addAgentThreads(
        'lead',
        [{ agents: ['job1'], name: { project: 'Shop', task: 'fix' }, now: T0 }],
        { start: true }
      )
    ).toEqual([]);
  });

  it('a poll keeps the tidy-up layer and undo stack of the file', () => {
    const store = createThreadStore(tmp());
    const a = store.create('lead', { name: { project: 'A', task: 'a' }, now: T0 });
    const b = store.create('lead', { name: { project: 'B', task: 'b' }, now: T0 });
    store.tidy('lead', 'merge', (doc) => {
      doc.overrides.merged[b.id] = a.id;
    });
    store.update('lead', a.id, { readAt: T0 + 5, agents: ['w9'] });
    store.addAgentThreads('lead', [{ agents: ['w8'], name: { project: 'C', task: 'c' }, now: T0 }]);
    expect(store.state('lead')).toMatchObject({
      overrides: { merged: { [b.id]: a.id } },
      canUndo: true,
    });
  });
});

describe('entries routed as the UI routes them (CLI thread list/messages)', () => {
  const thread = (id, commands = []) => ({
    id,
    tag: `[Thread: Demo · ${id}]`,
    agents: [],
    closed: false,
    createdAt: 0,
    commands,
  });
  const items = [
    { kind: 'user', key: 'u1', text: '/status-report', ts: 10 },
    { kind: 'answer', key: 'm1', text: 'Report sent.', first: 'Report sent.', ts: 11 },
    { kind: 'user', key: 'u2', text: '/status-report', ts: 20 },
  ];
  const marked = thread('t1', [{ at: 5, command: '/status-report' }]);

  it('a command mark claims its one turn; the next same command stays in the main chat', () => {
    expect(routeEntries(items, [marked, thread('t2')])).toEqual(['t1', 't1', null]);
  });

  it('a tidy-up move beats the mark; a merge carries the marked turn to its target', () => {
    const moved = { entries: { u1: 'main' }, merged: {} };
    expect(routeEntries(items, [marked, thread('t2')], moved)).toEqual([null, null, null]);
    const merged = { entries: {}, merged: { t1: 't2' } };
    expect(routeEntries(items, [marked, thread('t2')], merged)).toEqual(['t2', 't2', null]);
  });
});

describe('undo of a tidy-up action', () => {
  it('keeps a command mark sent from the thread after the action', () => {
    const store = createThreadStore(tmp());
    const t = store.create('sess', { name: { project: 'Demo', task: 'One' } });
    store.tidy('sess', 'close', (doc) => {
      doc.threads[0].closed = true;
    });
    store.update('sess', t.id, { command: '/status-report', now: 42 });
    store.undo('sess');
    expect(store.list('sess')[0]).toMatchObject({
      closed: false,
      commands: [{ at: 42, command: '/status-report' }],
    });
  });
});
