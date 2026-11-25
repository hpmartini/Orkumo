import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  createThreadStore,
  cleanName,
  taskThread,
  threadView,
  repoAgents,
  threadText,
  returnMisplacedThreads,
  threadOwnerKey,
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

  it('a Claude terminal keys its threads by its transcript uuid, not its pid row', () => {
    expect(threadOwnerKey({ id: 'interactive-42', sessionId: 'uuid-1' })).toBe('uuid-1');
    expect(threadOwnerKey({ id: 'omp-1', sessionId: '1' })).toBe('omp-1');
    expect(threadOwnerKey({ id: '13c54a91', sessionId: 'uuid-2' })).toBe('13c54a91');
  });
});
