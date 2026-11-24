import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('node-pty', () => ({ spawn: vi.fn() }));

const {
  viewSession,
  stopChat,
  stopAllChats,
  watchChat,
  listChats,
  chatSummary,
  shellOutputFile,
  openChatStream,
  watchChatStream,
  unwatchChatStream,
  chatHistoryPage,
  chatImage,
} = await import('../server/services/chatService.js');
const { reduceChat, initialChatState, prependHistory } =
  await import('@hpmartini/agents-ui/utils/chatEvents');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-test-'));
const project = path.join(root, 'project');
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-outside-'));
fs.mkdirSync(project);

const CLAUDE_ID = '22222222-2222-4222-8222-222222222222';
const OMP_ID = '01a1c9b5-7087-7460-91a2-36fa4563f9ca';
const noPicker = {
  listCommands: async () => [],
  listAgents: async () => [],
  listOmpCommands: () => new Promise(() => {}),
};
const ctx = { allowedDirs: [root], pollMs: 20, ...noPicker };

const jsonl = (records) => records.map((r) => `${JSON.stringify(r)}\n`).join('');
const claudeUser = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Claude projects dir with the transcript in a folder other than the cwd's (worktree case) */
function claudeProjects(records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-projects-'));
  fs.mkdirSync(path.join(dir, '-elsewhere'));
  const file = path.join(dir, '-elsewhere', `${CLAUDE_ID}.jsonl`);
  fs.writeFileSync(file, jsonl(records));
  return { dir, file };
}

// the page marker of the replay is covered in 'history pages'
const collect = (id) => {
  const seen = [];
  const off = watchChat(id, (e) => e.type !== 'devorbit_page' && seen.push(e));
  return { seen, off };
};

afterEach(() => {
  stopAllChats();
  vi.useRealTimers();
});

describe('viewSession validation', () => {
  const status = (opts) => {
    try {
      viewSession(opts, ctx);
    } catch (error) {
      return error.status;
    }
    return 'no error';
  };

  it.each([
    ['unknown harness', { harness: 'codex', sessionId: CLAUDE_ID, cwd: project }],
    ['prototype key as harness', { harness: 'toString', sessionId: CLAUDE_ID, cwd: project }],
    ['bad claude session id', { harness: 'claude', sessionId: 'abc', cwd: project }],
    ['bad omp session id', { harness: 'omp', sessionId: '../../etc/passwd', cwd: project }],
    ['cwd outside the project dirs', { harness: 'claude', sessionId: CLAUDE_ID, cwd: outside }],
    ['missing cwd', { harness: 'pi', sessionId: OMP_ID, cwd: path.join(root, 'nope') }],
    ['bad name', { harness: 'claude', sessionId: CLAUDE_ID, cwd: project, name: 'a\nb' }],
  ])('rejects %s with 400', (_label, opts) => {
    expect(status(opts)).toBe(400);
    expect(listChats()).toEqual([]);
  });
});

describe('viewSession - Claude transcript', () => {
  it('replays, tails appended and partial lines, reuses the view, stops polling', async () => {
    const { dir, file } = claudeProjects([
      claudeUser('first'),
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'on it' }] } },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't1',
              content: 'Output is being written to: /tmp/x/tasks/b7k2.output',
            },
          ],
        },
      },
    ]);
    const s = viewSession(
      { harness: 'claude', sessionId: CLAUDE_ID, cwd: project, name: 'job' },
      { ...ctx, transcriptDir: dir }
    );
    expect(s).toMatchObject({
      harness: 'claude',
      sessionId: CLAUDE_ID,
      cwd: fs.realpathSync(project),
      name: 'job',
      model: null,
      running: true,
    });
    expect(Object.keys(s).sort()).toEqual(
      ['cwd', 'harness', 'id', 'model', 'name', 'running', 'sessionId', 'startedAt'].sort()
    );
    // the same session again: the existing view, no second tailer
    expect(viewSession({ harness: 'claude', sessionId: CLAUDE_ID, cwd: project }, ctx).id).toBe(
      s.id
    );
    expect(listChats()).toHaveLength(1);

    const { seen, off } = collect(s.id);
    const third = JSON.stringify(claudeUser('partial'));
    fs.appendFileSync(file, `${jsonl([claudeUser('second')])}${third.slice(0, 10)}`);
    await sleep(80);
    fs.appendFileSync(file, `${third.slice(10)}\n`);
    await vi.waitFor(() =>
      expect(seen.filter((e) => e.type === 'devorbit_user').map((e) => e.text)).toEqual([
        'first',
        'second',
        'partial',
      ])
    );
    expect(seen.map((e) => e.type).slice(0, 3)).toEqual(['devorbit_user', 'assistant', 'user']);
    expect(shellOutputFile(s.id, 'b7k2')).toBe('/tmp/x/tasks/b7k2.output');

    off();
    expect(stopChat(s.id)).toBe(true);
    expect(stopChat(s.id)).toBe(false);
    expect(listChats()).toEqual([]);
    expect(() => chatSummary(s.id)).toThrow(/not found/);
    const before = seen.length;
    fs.appendFileSync(file, jsonl([claudeUser('after stop')]));
    await sleep(80);
    expect(seen).toHaveLength(before);
  });

  it('replays the whole transcript of a long session, the part before a compaction included', async () => {
    // 'ä' is two bytes: an odd-length line puts a read chunk border inside a character
    const big = 'ä'.repeat(5 * 1024 * 1024 + 1);
    const { dir } = claudeProjects([
      claudeUser('before compaction'),
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: big }] } },
      { type: 'system', subtype: 'compact_boundary' },
      claudeUser('after compaction'),
    ]);
    const s = viewSession(
      { harness: 'claude', sessionId: CLAUDE_ID, cwd: project },
      { ...ctx, transcriptDir: dir }
    );
    const { seen, off } = collect(s.id);
    await vi.waitFor(() =>
      expect(seen.filter((e) => e.type === 'devorbit_user').map((e) => e.text)).toEqual([
        'before compaction',
        'after compaction',
      ])
    );
    const text = seen.find((e) => e.type === 'assistant')?.message.content[0].text;
    expect(text === big).toBe(true);
    off();
    stopChat(s.id);
  });

  it('offers the TUI built-ins and the skills in the `/` picker', async () => {
    const { dir } = claudeProjects([claudeUser('hi')]);
    const s = viewSession(
      { harness: 'claude', sessionId: CLAUDE_ID, cwd: project },
      {
        ...ctx,
        transcriptDir: dir,
        listCommands: async () => [
          { name: 'model', description: 'Set the dispatch model', source: 'builtin' },
          { name: 'my-skill', description: 'mine', source: 'user' },
        ],
        listAgents: async () => [{ name: 'scout', description: 'reads' }],
      }
    );
    const { seen } = collect(s.id);
    await vi.waitFor(() => expect(seen.some((e) => e.type === 'devorbit_commands')).toBe(true));
    const cmds = seen.find((e) => e.type === 'devorbit_commands');
    const names = cmds.commands.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['compact', 'clear', 'model', 'my-skill']));
    expect(names.filter((n) => n === 'model')).toHaveLength(1);
    expect(cmds.commands.find((c) => c.name === 'compact').builtin).toBe(true);
    expect(cmds.commands.find((c) => c.name === 'my-skill').builtin).toBe(false);
    expect(cmds.agents).toEqual([{ name: 'scout', description: 'reads' }]);
  });
});

describe('viewSession - omp / pi session file', () => {
  const records = [
    { type: 'session', version: 3, id: OMP_ID, cwd: '/w/app' },
    { type: 'model_change', id: 'mc1', model: 'anthropic/claude-opus-5-5' },
    { type: 'message', id: 's1', message: { role: 'system', content: 'You are omp' } },
    { type: 'custom_message', customType: 'goal-mode-context', content: 'internal' },
    { type: 'mode_change', id: 'x1' },
    {
      type: 'message',
      id: 'u1',
      message: { role: 'user', content: [{ type: 'text', text: 'list files' }] },
    },
    {
      type: 'message',
      id: 'a1',
      message: {
        role: 'assistant',
        model: 'claude-opus-5-5',
        stopReason: 'toolUse',
        content: [
          { type: 'thinking', thinking: 'look first' },
          { type: 'text', text: 'Checking' },
          { type: 'toolCall', id: 'toolu_1', name: 'bash', arguments: { command: 'ls' } },
          { type: 'toolCall', id: 'toolu_2', name: 'edit', arguments: { input: '@@ hashline' } },
        ],
      },
    },
    {
      type: 'message',
      id: 'r1',
      message: {
        role: 'toolResult',
        toolCallId: 'toolu_1',
        content: [
          { type: 'text', text: 'a.txt' },
          { type: 'image', data: 'AAAA' },
        ],
        isError: false,
      },
    },
    {
      type: 'message',
      id: 'r2',
      message: {
        role: 'toolResult',
        toolCallId: 'toolu_2',
        content: [{ type: 'text', text: 'stale anchor' }],
        isError: true,
      },
    },
    {
      type: 'message',
      id: 'a2',
      message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Done' }] },
    },
  ];

  function sessionsDir(harness) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `chat-${harness}-`));
    fs.mkdirSync(path.join(dir, '-w-app'));
    const file = path.join(dir, '-w-app', `2026-11-11T08-24-33-671Z_${OMP_ID}.jsonl`);
    fs.writeFileSync(file, jsonl(records));
    return { dir, file };
  }

  it('offers omp the TUI snapshot first, then the probed list', async () => {
    const { dir } = sessionsDir('omp');
    const s = viewSession(
      { harness: 'omp', sessionId: OMP_ID, cwd: project },
      {
        ...ctx,
        transcriptDir: dir,
        listOmpCommands: async (cwd, onSnapshot) => {
          onSnapshot([{ name: 'goal', builtin: true }]);
          await sleep(10);
          return [
            { name: 'goal', builtin: true },
            { name: 'skill:goal-contract', description: 'contract', builtin: false },
          ];
        },
      }
    );
    const { seen } = collect(s.id);
    const lists = () =>
      seen.filter((e) => e.type === 'devorbit_commands').map((e) => e.commands.map((c) => c.name));
    await vi.waitFor(() => expect(lists().at(-1)).toEqual(['goal', 'skill:goal-contract']));
    expect(lists()[0]).toEqual(['goal']);
    stopChat(s.id);
  });

  it('translates user, assistant (thinking, text, tool calls), tool results and turn ends', async () => {
    const { dir, file } = sessionsDir('omp');
    const s = viewSession(
      { harness: 'omp', sessionId: OMP_ID, cwd: project },
      { ...ctx, transcriptDir: dir }
    );
    const { seen } = collect(s.id);
    await vi.waitFor(() => expect(seen.some((e) => e.type === 'result')).toBe(true));
    expect(seen.map((e) => e.type)).toEqual([
      'system',
      'devorbit_user',
      'assistant',
      'user',
      'user',
      'assistant',
      'result',
    ]);
    expect(chatSummary(s.id).model).toBe('anthropic/claude-opus-5-5');
    expect(seen[1]).toEqual({ type: 'devorbit_user', text: 'list files', history: true });
    expect(seen[2].message).toMatchObject({
      id: 'a1',
      content: [
        { type: 'thinking', thinking: 'look first' },
        { type: 'text', text: 'Checking' },
        { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool_use', id: 'toolu_2', name: 'edit', input: { input: '@@ hashline' } },
      ],
    });
    expect(seen[3].message.content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'toolu_1',
      content: 'a.txt\n[image]',
      is_error: false,
    });
    expect(seen[4].message.content[0]).toMatchObject({ tool_use_id: 'toolu_2', is_error: true });
    expect(seen[6]).toMatchObject({ type: 'result', subtype: 'success', is_error: false });

    // live: an aborted turn ends with an interrupted result
    fs.appendFileSync(
      file,
      jsonl([
        { type: 'message', id: 'u2', message: { role: 'user', content: 'again' } },
        {
          type: 'message',
          id: 'a3',
          message: { role: 'assistant', stopReason: 'aborted', content: [] },
        },
      ])
    );
    await vi.waitFor(() => expect(seen.filter((e) => e.type === 'result')).toHaveLength(2));
    expect(seen.at(-1)).toMatchObject({ subtype: 'error_during_execution', is_error: true });

    // the client reducer renders it
    const state = seen.reduce(reduceChat, initialChatState);
    expect(state.model).toBe('anthropic/claude-opus-5-5');
    const kinds = state.messages.map((m) => m.kind);
    expect(kinds).toEqual(['user', 'assistant', 'assistant', 'result', 'user', 'result']);
    const tools = state.messages[1].blocks.filter((b) => b.type === 'tool');
    expect(tools.map((t) => [t.name, t.result, t.isError])).toEqual([
      ['Bash', 'a.txt\n[image]', false],
      ['edit', 'stale anchor', true],
    ]);
  });

  it('reads pi session files the same way (pi model_change: provider + modelId)', async () => {
    const { dir, file } = sessionsDir('pi');
    fs.appendFileSync(
      file,
      jsonl([{ type: 'model_change', id: 'mc2', provider: 'openai', modelId: 'gpt-5.5' }])
    );
    const s = viewSession(
      { harness: 'pi', sessionId: OMP_ID, cwd: project },
      { ...ctx, transcriptDir: dir }
    );
    await vi.waitFor(() => expect(chatSummary(s.id).model).toBe('openai/gpt-5.5'));
  });
});

describe('orphan timer', () => {
  it('stops a view nobody watches after the timeout, not while watched', async () => {
    vi.useFakeTimers();
    const { dir } = claudeProjects([claudeUser('hi')]);
    const s = viewSession(
      { harness: 'claude', sessionId: CLAUDE_ID, cwd: project },
      { ...ctx, transcriptDir: dir, pollMs: 60_000 }
    );
    const off = watchChat(s.id, () => {});
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
    expect(listChats().map((c) => c.id)).toEqual([s.id]);
    off();
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
    expect(listChats()).toEqual([]);
  });
});

describe('chat streams (one SSE per client window)', () => {
  const CLIENT = '33333333-3333-4333-8333-333333333333';
  const status = (fn) => {
    try {
      fn();
    } catch (error) {
      return error.status;
    }
    return 'no error';
  };

  it('carries several views tagged by sub, re-watches with a fresh replay, survives a reconnect', async () => {
    const { dir } = claudeProjects([claudeUser('hi')]);
    const opts = { ...ctx, transcriptDir: dir, pollMs: 60_000 };
    const a = viewSession({ harness: 'claude', sessionId: CLAUDE_ID, cwd: project }, opts);
    const b = viewSession({ harness: 'pi', sessionId: OMP_ID, cwd: project }, opts);
    await vi.waitFor(() => {
      const { seen, off } = collect(a.id);
      off();
      expect(seen.some((e) => e.type === 'devorbit_user')).toBe(true);
    });
    // orphan timers armed from here on are fake
    vi.useFakeTimers();

    expect(status(() => watchChatStream(CLIENT, 's1', a.id))).toBe(409);
    const sent = [];
    const closeFirst = openChatStream(CLIENT, (event, data) => sent.push([event, data]));
    expect(status(() => watchChatStream(CLIENT, 's1', 'missing'))).toBe(404);

    watchChatStream(CLIENT, 's1', a.id);
    watchChatStream(CLIENT, 's2', b.id);
    const replayA = sent.filter(([e, d]) => e === 'message' && d.sub === 's1');
    expect(sent[0]).toEqual(['watch', { sub: 's1' }]);
    expect(replayA.filter(([, d]) => d.event.type === 'devorbit_user')).toHaveLength(1);
    expect(sent).toContainEqual(['watch', { sub: 's2' }]);

    // same sub again: one watcher, one fresh replay
    sent.length = 0;
    watchChatStream(CLIENT, 's1', a.id);
    expect(sent).toEqual([['watch', { sub: 's1' }], ...replayA]);
    const firstStreamTotal = sent.length;

    // EventSource reconnects with the same id; the old request's close must not end the new one
    const again = [];
    const closeSecond = openChatStream(CLIENT, (event, data) => again.push([event, data]));
    closeFirst();
    watchChatStream(CLIENT, 's1', a.id);
    watchChatStream(CLIENT, 's2', b.id);
    expect(again.slice(0, replayA.length + 1)).toEqual([['watch', { sub: 's1' }], ...replayA]);
    expect(again).toContainEqual(['watch', { sub: 's2' }]);

    unwatchChatStream(CLIENT, 's1');
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
    expect(listChats().map((c) => c.id)).toEqual([b.id]); // a unwatched -> orphan stop
    expect(sent).toHaveLength(firstStreamTotal); // the replaced stream got nothing more

    // closing the stream releases its watches
    closeSecond();
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
    expect(listChats()).toEqual([]);
  });
});

describe('view name', () => {
  it('shortens a session name over 80 characters instead of refusing the view', () => {
    const name = 'x'.repeat(120);
    const s = viewSession({ harness: 'claude', sessionId: CLAUDE_ID, cwd: project, name }, ctx);
    expect(s.name).toBe(`${'x'.repeat(79)}…`);
  });
});

describe('history pages', () => {
  const claudeAnswer = (text) => ({
    type: 'assistant',
    message: { id: `m-${text}`, role: 'assistant', content: [{ type: 'text', text }] },
  });
  const session = async (turns, extra = []) => {
    const records = [];
    for (let i = 1; i <= turns; i++) records.push(claudeUser(`p${i}`), claudeAnswer(`a${i}`));
    const { dir } = claudeProjects([...records, ...extra]);
    const s = viewSession(
      { harness: 'claude', sessionId: CLAUDE_ID, cwd: project },
      { ...ctx, transcriptDir: dir }
    );
    await sleep(80);
    return s;
  };
  const prompts = (events) => events.filter((e) => e.type === 'devorbit_user').map((e) => e.text);

  it('opens with the last 20 turns and a cursor, pages back without gaps or duplicates', async () => {
    const s = await session(45);
    const seen = [];
    watchChat(s.id, (e) => seen.push(e));
    const page = seen.find((e) => e.type === 'devorbit_page');
    expect(page.more).toBe(true);
    expect(prompts(seen)).toEqual(Array.from({ length: 20 }, (_, i) => `p${i + 26}`));

    const second = chatHistoryPage(s.id, page.before);
    expect(prompts(second.events)).toEqual(Array.from({ length: 20 }, (_, i) => `p${i + 6}`));
    expect(second.more).toBe(true);
    const last = chatHistoryPage(s.id, second.before);
    expect(prompts(last.events)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(last).toMatchObject({ before: 0, more: false });
    // the answer of a page's last turn stays on that page
    expect(second.events.at(-1).message.content[0].text).toBe('a25');
    expect(chatHistoryPage(s.id, 0).events).toEqual([]);
  });

  it('a short session replays whole, with no older page', async () => {
    const s = await session(3);
    const seen = [];
    watchChat(s.id, (e) => seen.push(e));
    expect(seen.find((e) => e.type === 'devorbit_page')).toEqual({
      type: 'devorbit_page',
      before: 0,
      more: false,
    });
    expect(prompts(seen)).toEqual(['p1', 'p2', 'p3']);
  });

  it('the client puts older pages in front, transcript order, unique keys', async () => {
    const s = await session(45);
    let state = initialChatState;
    watchChat(s.id, (e) => (state = reduceChat(state, e)));
    while (state.older?.more)
      state = prependHistory(state, chatHistoryPage(s.id, state.older.before));
    const users = state.messages.filter((m) => m.kind === 'user');
    expect(users.map((m) => m.text)).toEqual(Array.from({ length: 45 }, (_, i) => `p${i + 1}`));
    // only the session's first prompt starts a context
    expect(users.filter((m) => m.initial).map((m) => m.text)).toEqual(['p1']);
    const keys = state.messages.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('a prompt queued before the first page still counts as pending', async () => {
    const queued = { type: 'queue-operation', operation: 'enqueue', content: 'later' };
    const records = [];
    for (let i = 1; i <= 25; i++) records.push(claudeUser(`p${i}`), claudeAnswer(`a${i}`));
    records.splice(2, 0, queued);
    const { dir } = claudeProjects(records);
    const s = viewSession(
      { harness: 'claude', sessionId: CLAUDE_ID, cwd: project },
      { ...ctx, transcriptDir: dir }
    );
    await sleep(80);
    let state = initialChatState;
    watchChat(s.id, (e) => (state = reduceChat(state, e)));
    expect(state.queued).toEqual(['later']);
  });
});

describe('images by URL', () => {
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
  const image = (media_type, data = PNG, type = 'base64') => ({
    type: 'image',
    source: { type, media_type, data },
  });
  const toolCall = (id) => ({
    type: 'assistant',
    message: {
      id: `m-${id}`,
      role: 'assistant',
      content: [{ type: 'tool_use', id, name: 'Screenshot', input: {} }],
    },
  });
  const toolResult = (id, content) => ({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] },
  });
  const blocks = (events) =>
    events
      .filter((e) => e.type === 'user')
      .flatMap((e) => e.message.content.flatMap((b) => (Array.isArray(b.content) ? b.content : [])))
      .filter((b) => b.type === 'image');
  const noBase64 = (events) => expect(JSON.stringify(events)).not.toContain(PNG);

  it('replay, older pages and live events carry a ref instead of the bytes', async () => {
    const records = [];
    for (let i = 1; i <= 25; i++) records.push(claudeUser(`p${i}`), toolCall(`t${i}`));
    records.push(toolResult('t1', [{ type: 'text', text: 'shot' }, image('image/png')]));
    records.splice(4, 0, toolResult('t2', [image('image/jpeg')]));
    const { dir, file } = claudeProjects(records);
    const s = viewSession(
      { harness: 'claude', sessionId: CLAUDE_ID, cwd: project },
      { ...ctx, transcriptDir: dir }
    );
    await sleep(80);
    const seen = [];
    watchChat(s.id, (e) => seen.push(e));
    noBase64(seen);
    const [first] = blocks(seen);
    expect(first).toEqual({ type: 'image', ref: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(chatImage(s.id, first.ref)).toEqual({
      mime: 'image/png',
      data: Buffer.from(PNG, 'base64'),
    });

    const page = chatHistoryPage(s.id, seen.find((e) => e.type === 'devorbit_page').before);
    noBase64(page.events);
    expect(chatImage(s.id, blocks(page.events)[0].ref).mime).toBe('image/jpeg');

    fs.appendFileSync(file, jsonl([toolResult('t3', [image('image/webp')])]));
    await sleep(120);
    noBase64(seen);
    expect(chatImage(s.id, blocks(seen).at(-1).ref).mime).toBe('image/webp');
  });

  it('serves only base64 png/jpeg/gif/webp of its own view', async () => {
    const { dir } = claudeProjects([
      claudeUser('p'),
      toolCall('t'),
      toolResult('t', [image('image/svg+xml'), image('image/png', 'x', 'url')]),
    ]);
    const s = viewSession(
      { harness: 'claude', sessionId: CLAUDE_ID, cwd: project },
      { ...ctx, transcriptDir: dir }
    );
    await sleep(80);
    const seen = [];
    watchChat(s.id, (e) => seen.push(e));
    expect(blocks(seen)).toEqual([{ type: 'image' }, { type: 'image' }]);
    expect(chatImage(s.id, '0'.repeat(32))).toBeNull();
    expect(chatImage(s.id, '../x')).toBeNull();
  });

  it('the client keeps the refs on the tool call', () => {
    let state = reduceChat(initialChatState, toolCall('t'));
    state = reduceChat(
      state,
      toolResult('t', [
        { type: 'text', text: 'shot' },
        { type: 'image', ref: 'a'.repeat(32) },
        { type: 'image' },
      ])
    );
    const tool = state.messages.flatMap((m) => m.blocks ?? []).find((b) => b.type === 'tool');
    expect(tool.images).toEqual(['a'.repeat(32)]);
    expect(tool.result).toBe('shot\n[image]\n[image]');
  });
});

describe('message times (reply quotes, thread order)', () => {
  const at = '2026-11-24T09:32:00.000Z';
  const ms = Date.parse(at);

  it('Claude: prompts and answers carry the record time', async () => {
    const { dir } = claudeProjects([
      { ...claudeUser('first'), timestamp: at },
      {
        type: 'assistant',
        timestamp: at,
        message: { id: 'm1', content: [{ type: 'text', text: 'on it' }] },
      },
    ]);
    const s = viewSession(
      { harness: 'claude', sessionId: CLAUDE_ID, cwd: project },
      { ...ctx, transcriptDir: dir }
    );
    const { seen } = collect(s.id);
    await vi.waitFor(() => expect(seen.some((e) => e.type === 'assistant')).toBe(true));
    expect(seen.find((e) => e.type === 'devorbit_user')).toMatchObject({ ts: ms });
    expect(seen.find((e) => e.type === 'assistant')).toMatchObject({ ts: ms });
    const state = seen.reduce(reduceChat, initialChatState);
    expect(state.messages.map((m) => m.ts)).toEqual([ms, ms]);
  });

  it('omp: answers carry the record time', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-omp-ts-'));
    fs.mkdirSync(path.join(dir, '-w-app'));
    fs.writeFileSync(
      path.join(dir, '-w-app', `2026-11-24T09-30-00-000Z_${OMP_ID}.jsonl`),
      jsonl([
        { type: 'session', version: 3, id: OMP_ID, cwd: project },
        {
          type: 'message',
          id: 'a1',
          timestamp: at,
          message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
        },
      ])
    );
    const s = viewSession(
      { harness: 'omp', sessionId: OMP_ID, cwd: project },
      { ...ctx, transcriptDir: dir }
    );
    const { seen } = collect(s.id);
    await vi.waitFor(() => expect(seen.some((e) => e.type === 'assistant')).toBe(true));
    expect(seen.find((e) => e.type === 'assistant')).toMatchObject({ ts: ms });
  });
});
