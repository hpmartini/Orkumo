import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// node-pty is a native module - keep it out of the unit test
vi.mock('node-pty', () => ({ spawn: vi.fn() }));

const { readContextTokens, contextTokensCacheSize, CONTEXT_TOKENS_CACHE_MAX } =
  await import('../server/services/ompSessions.js');
const { sessionContextTokens, sessionCache } =
  await import('../server/services/agentContextService.js');

const SESSION = '01a21900-265a-7210-a2ef-8931ac503c73';
const assistant = (usage, stopReason = 'stop') =>
  JSON.stringify({
    type: 'message',
    id: 'a',
    message: { role: 'assistant', content: [], model: 'claude-opus-5-5', usage, stopReason },
  });

describe('context tokens', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-tokens-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const write = (name, lines) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, lines.join('\n') + '\n');
    return file;
  };

  it('omp: input + cacheRead + cacheWrite of the newest assistant usage', async () => {
    const file = write('s.jsonl', [
      JSON.stringify({ type: 'session', id: SESSION, cwd: '/x' }),
      assistant({ input: 2, output: 10, cacheRead: 100, cacheWrite: 5, totalTokens: 117 }),
      JSON.stringify({ type: 'custom', customType: 'tool_execution_start', data: {} }),
      assistant({
        input: 4,
        output: 975,
        cacheRead: 433766,
        cacheWrite: 1303,
        totalTokens: 436048,
      }),
      JSON.stringify({ type: 'model_usage', id: 'm' }),
      '{"type":"message","message":{"role":"user","content":"hi"}}',
    ]);
    expect(await readContextTokens(file)).toBe(4 + 433766 + 1303);
  });

  it('omp: skips failed calls with zero usage, null without any usage', async () => {
    const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
    const file = write('e.jsonl', [
      assistant({ input: 1, output: 1, cacheRead: 50, cacheWrite: 0, totalTokens: 52 }),
      assistant(zero, 'error'),
    ]);
    expect(await readContextTokens(file)).toBe(51);
    expect(await readContextTokens(write('n.jsonl', ['{"type":"session"}']))).toBeNull();
  });

  it('omp: re-reads when the file grows', async () => {
    const file = write('g.jsonl', [assistant({ input: 1, cacheRead: 9, cacheWrite: 0 })]);
    expect(await readContextTokens(file)).toBe(10);
    fs.appendFileSync(file, assistant({ input: 1, cacheRead: 99, cacheWrite: 0 }) + '\n');
    expect(await readContextTokens(file)).toBe(100);
  });

  it('omp: the cache is bounded and keeps the files read last', async () => {
    const files = [];
    for (let i = 0; i < CONTEXT_TOKENS_CACHE_MAX + 20; i += 1) {
      files.push(write(`f${i}.jsonl`, [assistant({ input: 1, cacheRead: i, cacheWrite: 0 })]));
      await readContextTokens(files[i]);
    }
    expect(contextTokensCacheSize()).toBe(CONTEXT_TOKENS_CACHE_MAX);
    // evicted files are simply read again, with the right answer
    expect(await readContextTokens(files[0])).toBe(1);
    expect(contextTokensCacheSize()).toBe(CONTEXT_TOKENS_CACHE_MAX);
  });

  it('claude: the last turn of the transcript (read + written + input)', async () => {
    const transcript = path.join(dir, 'claude.jsonl');
    const line = (id, usage) =>
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-11-26T10:00:00.000Z',
        message: { id, model: 'claude-opus-5-5', usage },
      });
    fs.writeFileSync(
      transcript,
      [
        line('m1', {
          input_tokens: 3,
          cache_read_input_tokens: 1000,
          cache_creation_input_tokens: 10,
        }),
        line('m2', {
          input_tokens: 5,
          cache_read_input_tokens: 2000,
          cache_creation_input_tokens: 20,
        }),
      ].join('\n') + '\n'
    );
    const session = { id: 'interactive-1', sessionId: null, transcriptPath: transcript };
    const cache = await sessionCache(session, null);
    expect(await sessionContextTokens(session, cache)).toBe(2025);
    expect(await sessionContextTokens(session, null)).toBeNull();
  });

  it('omp and pi: found by session id in the harness session folder', async () => {
    const sub = path.join(dir, '--tmp--');
    fs.mkdirSync(sub);
    fs.writeFileSync(
      path.join(sub, `2026-11-26T17-56-09-946Z_${SESSION}.jsonl`),
      assistant({ input: 2, cacheRead: 40, cacheWrite: 8 }) + '\n'
    );
    const row = { id: `omp-${SESSION}`, sessionId: SESSION, ptyCommand: 'omp' };
    expect(await sessionContextTokens(row, null, { ompDir: dir })).toBe(50);
    const chat = { id: 'c1', sessionId: SESSION, harness: 'pi' };
    expect(await sessionContextTokens(chat, null, { piDir: dir })).toBe(50);
    expect(
      await sessionContextTokens({ ...chat, harness: 'claude' }, null, { piDir: dir })
    ).toBeNull();
    expect(
      await sessionContextTokens({ ...row, sessionId: null }, null, { ompDir: dir })
    ).toBeNull();
  });
});
