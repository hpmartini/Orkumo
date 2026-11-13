import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('node-pty', () => ({ spawn: vi.fn() }));

const { viewSession, stopChat, stopAllChats, watchChat, listChats, chatSummary, shellOutputFile } =
  await import('../server/services/chatService.js');
const { reduceChat, initialChatState } = await import('../utils/chatEvents.ts');

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

const collect = (id) => {
  const seen = [];
  const off = watchChat(id, (e) => seen.push(e));
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
