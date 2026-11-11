import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { startDriver, mapTool, toolResultText } from '../server/services/chatDrivers/acp.js';
import { reduceChat, initialChatState } from '../utils/chatEvents.ts';

/** Agent → client frames recorded from `omp acp` / `opencode acp`, trimmed */
const frames = (name) =>
  fs
    .readFileSync(path.join(import.meta.dirname, 'fixtures/acp', `${name}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

function fakeSpawn() {
  const calls = [];
  const spawn = vi.fn((bin, args, opts) => {
    const proc = new EventEmitter();
    proc.stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
    proc.stderr = Object.assign(new EventEmitter(), { setEncoding() {} });
    proc.written = [];
    proc.stdin = Object.assign(new EventEmitter(), {
      writable: true,
      write: (line) => proc.written.push(JSON.parse(line)),
      end: vi.fn(),
    });
    proc.kill = vi.fn();
    calls.push({ bin, args, opts, proc });
    return proc;
  });
  return { spawn, calls };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function start(opts = {}, hooks = {}) {
  const { spawn, calls } = fakeSpawn();
  const events = [];
  const exits = [];
  const driver = startDriver(
    { harness: 'omp', cwd: '/tmp/acp-probe', resume: null, ...opts },
    {
      bin: '/usr/local/bin/omp',
      spawn,
      emit: (event) => {
        events.push(event);
        hooks.onEvent?.(event, driver);
      },
      exit: (info) => exits.push(info),
    }
  );
  const proc = calls[0].proc;
  const feed = async (msg) => {
    proc.stdout.emit('data', `${JSON.stringify(msg)}\n`);
    await tick();
  };
  /** Feed recorded frames in order; `before(msg)` runs ahead of each frame */
  const replay = async (list, before) => {
    await tick();
    for (const msg of list) {
      before?.(msg);
      await feed(msg);
    }
  };
  const state = () => events.reduce(reduceChat, initialChatState);
  const final = () => events.filter((e) => e.type !== 'stream_event');
  return { driver, proc, calls, events, exits, feed, replay, state, final };
}

const blocks = (events) =>
  events.filter((e) => e.type === 'assistant').flatMap((e) => e.message.content);
const toolResults = (events) =>
  events.filter((e) => e.type === 'user').flatMap((e) => e.message.content);

afterEach(() => {
  vi.useRealTimers();
});

describe('acp driver - process and handshake', () => {
  it('spawns `<bin> acp` with an argument array in the cwd and initializes', async () => {
    const t = start({ harness: 'opencode' });
    expect(t.calls[0].bin).toBe('/usr/local/bin/omp');
    expect(t.calls[0].args).toEqual(['acp']);
    expect(t.calls[0].opts).toMatchObject({
      cwd: '/tmp/acp-probe',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(t.proc.written[0]).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      },
    });
  });

  it('rejects a harness without ACP args before spawning', () => {
    const { spawn } = fakeSpawn();
    expect(() =>
      startDriver(
        { harness: 'claude', cwd: '/tmp', resume: null },
        { bin: 'x', spawn, emit() {}, exit() {} }
      )
    ).toThrow(/No ACP driver/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('queues a send before the handshake and prompts once the session exists', async () => {
    const t = start();
    t.driver.send('Run ls');
    const [init, created] = frames('omp-fresh');
    await t.replay([init]);
    expect(t.proc.written.map((m) => m.method)).toEqual(['initialize', 'session/new']);
    expect(t.proc.written[1].params).toEqual({ cwd: '/tmp/acp-probe', mcpServers: [] });
    await t.feed(created);
    expect(t.events[0]).toEqual({
      type: 'system',
      subtype: 'init',
      session_id: '01a1c783-dc67-7075-98e0-32f09d0a41b6',
      model: 'anthropic/claude-opus-5-5',
    });
    expect(t.proc.written[2]).toEqual({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: {
        sessionId: '01a1c783-dc67-7075-98e0-32f09d0a41b6',
        prompt: [{ type: 'text', text: 'Run ls' }],
      },
    });
  });

  it('sends attached images as image blocks, or as paths to an agent without image support', async () => {
    const img = { path: '/d/agent-images/a.png', mimeType: 'image/png', data: 'iVBO' };
    const [init, created] = frames('omp-fresh');
    const withImages = start();
    withImages.driver.send('what is this?', [img]);
    await withImages.replay([init, created]);
    expect(withImages.proc.written[2].params.prompt).toEqual([
      { type: 'text', text: 'what is this?' },
      { type: 'image', mimeType: 'image/png', data: 'iVBO' },
    ]);

    const textOnly = start();
    textOnly.driver.send('', [img]);
    const noImages = structuredClone(init);
    noImages.result.agentCapabilities.promptCapabilities.image = false;
    await textOnly.replay([noImages, created]);
    expect(textOnly.proc.written[2].params.prompt).toEqual([
      { type: 'text', text: '[Image: /d/agent-images/a.png]' },
    ]);
  });

  it('skips garbage and joins lines split across chunks', async () => {
    const t = start();
    const [init] = frames('omp-fresh');
    await tick();
    const line = JSON.stringify(init);
    t.proc.stdout.emit('data', 'not json\n\n{"broken":\n');
    t.proc.stdout.emit('data', line.slice(0, 20));
    t.proc.stdout.emit('data', `${line.slice(20)}\n`);
    await tick();
    expect(t.proc.written.at(-1).method).toBe('session/new');
  });

  it('ends the process with the error when the handshake fails', async () => {
    const t = start({ resume: '01a1c789-0000-7000-8000-000000000000' });
    await t.replay([frames('omp-load')[0]]);
    expect(t.proc.written[1]).toMatchObject({
      id: 2,
      method: 'session/load',
      params: {
        sessionId: '01a1c789-0000-7000-8000-000000000000',
        cwd: '/tmp/acp-probe',
        mcpServers: [],
      },
    });
    // recorded from `omp acp` for an unknown session id
    await t.feed({
      jsonrpc: '2.0',
      id: 2,
      error: {
        code: -32603,
        message: 'Internal error',
        data: { details: 'ACP session not found: 01a1c789-0000-7000-8000-000000000000' },
      },
    });
    expect(t.proc.kill).toHaveBeenCalledWith('SIGTERM');
    t.proc.emit('exit', 143);
    expect(t.exits).toEqual([
      {
        code: 1,
        stderr:
          '\nACP session/load failed: Internal error: ACP session not found: 01a1c789-0000-7000-8000-000000000000',
      },
    ]);
    expect(t.events.filter((e) => e.type === 'system')).toEqual([]);
  });

  it('reports the exit once, keeps the stderr tail and refuses calls afterwards', async () => {
    const t = start();
    t.proc.stderr.emit('data', 'x'.repeat(5000));
    t.proc.stderr.emit('data', 'boom');
    t.proc.emit('exit', 2);
    t.proc.emit('error', new Error('late'));
    expect(t.exits).toHaveLength(1);
    expect(t.exits[0].code).toBe(2);
    expect(t.exits[0].stderr).toHaveLength(4000);
    expect(t.exits[0].stderr.endsWith('boom')).toBe(true);
    for (const fn of [
      () => t.driver.send('hi'),
      () => t.driver.interrupt(),
      () => t.driver.answer('0', 'allow'),
    ]) {
      let error;
      try {
        fn();
      } catch (e) {
        error = e;
      }
      expect(error?.status).toBe(400);
    }
  });

  it('reports a spawn error as exit -1', () => {
    const t = start();
    t.proc.emit('error', new Error('spawn omp ENOENT'));
    expect(t.exits).toEqual([{ code: -1, stderr: '\nspawn omp ENOENT' }]);
  });

  it('stop closes stdin, sends SIGTERM, SIGKILL after 3 s; idempotent; own SIGTERM exit is clean', () => {
    vi.useFakeTimers();
    const t = start();
    t.driver.stop();
    t.driver.stop();
    expect(t.proc.stdin.end).toHaveBeenCalledTimes(1);
    expect(t.proc.kill).toHaveBeenCalledTimes(1);
    expect(t.proc.kill).toHaveBeenCalledWith('SIGTERM');
    vi.advanceTimersByTime(3000);
    expect(t.proc.kill).toHaveBeenLastCalledWith('SIGKILL');
    t.proc.emit('exit', 143);
    expect(t.exits).toEqual([{ code: null, stderr: '' }]);
    expect(() => t.driver.send('hi')).toThrow();
  });

  it('answers agent requests it does not support with a JSON-RPC error', async () => {
    const t = start();
    await t.feed({
      jsonrpc: '2.0',
      id: 7,
      method: 'fs/read_text_file',
      params: { path: '/etc/hosts' },
    });
    await t.feed({ jsonrpc: '2.0', id: 8, method: 'terminal/create', params: { command: 'ls' } });
    expect(t.proc.written.slice(1)).toEqual([
      {
        jsonrpc: '2.0',
        id: 7,
        error: { code: -32601, message: 'Method not supported: fs/read_text_file' },
      },
      {
        jsonrpc: '2.0',
        id: 8,
        error: { code: -32601, message: 'Method not supported: terminal/create' },
      },
    ]);
  });
});

describe('acp driver - omp turns (recorded)', () => {
  it('maps permission, Bash call, streamed text and the edit diff', async () => {
    const t = start(
      {},
      {
        onEvent: (event, driver) => {
          if (event.type === 'control_request') driver.answer(event.request_id, 'allow');
        },
      }
    );
    t.driver.send('Run ls');
    t.driver.send('Edit hello.txt');
    await t.replay(frames('omp-fresh'));

    const permission = t.events.find((e) => e.type === 'control_request');
    expect(permission).toEqual({
      type: 'control_request',
      request_id: '0',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: 'ls' },
        description: 'ls',
        permission_suggestions: [{ type: 'acpOption', optionId: 'allow_always' }],
      },
    });
    expect(t.proc.written).toContainEqual({
      jsonrpc: '2.0',
      id: 0,
      result: { outcome: { outcome: 'selected', optionId: 'allow_once' } },
    });
    // the second turn only starts after the first one's result
    const prompts = t.proc.written.filter((m) => m.method === 'session/prompt');
    expect(prompts.map((m) => [m.id, m.params.prompt[0].text])).toEqual([
      [3, 'Run ls'],
      [4, 'Edit hello.txt'],
    ]);

    const final = t.final();
    expect(blocks(final)).toEqual([
      {
        type: 'tool_use',
        id: 'toolu_0132EAVfVdX8uhGLm43RW6cE',
        name: 'Bash',
        input: { command: 'ls' },
      },
      // the fixture keeps the first 4 chunks of each message
      { type: 'text', text: '`ls` shows three files: `a.txt`, `hello.txt` and `' },
      {
        type: 'tool_use',
        id: 'toolu_018mZBfopt6T2GCu7TcA15GQ',
        name: 'Read',
        input: { file_path: 'hello.txt' },
      },
      {
        type: 'tool_use',
        id: 'toolu_01XubmAkBmBz8eCCeCBRvoKZ',
        name: 'Edit',
        input: {
          file_path: '/tmp/acp-probe/hello.txt',
          old_string: 'hi\n',
          new_string: 'hello world\n',
        },
      },
      { type: 'text', text: 'Done. `hello.txt` now contains "hello world" instead of "hi".' },
    ]);
    expect(toolResults(final)).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'toolu_0132EAVfVdX8uhGLm43RW6cE',
        content: 'a.txt\nhello.txt\nprobe.mjs\n',
        is_error: false,
      },
      {
        type: 'tool_result',
        tool_use_id: 'toolu_018mZBfopt6T2GCu7TcA15GQ',
        content: '[hello.txt#E3D3]\n1:hi',
        is_error: false,
      },
      {
        type: 'tool_result',
        tool_use_id: 'toolu_01XubmAkBmBz8eCCeCBRvoKZ',
        content: '[hello.txt#8DB0]\n1:hello world',
        is_error: false,
      },
    ]);
    // each tool result follows its tool_use block
    const order = final.map((e) => e.type);
    expect(order.indexOf('user')).toBeGreaterThan(order.indexOf('assistant'));
    expect(final.filter((e) => e.type === 'result')).toEqual([
      expect.objectContaining({
        subtype: 'success',
        is_error: false,
        session_id: '01a1c783-dc67-7075-98e0-32f09d0a41b6',
      }),
      expect.objectContaining({ subtype: 'success', is_error: false }),
    ]);
    expect(final.find((e) => e.type === 'devorbit_commands').commands[0]).toEqual({
      name: 'security',
      description: 'Plan, run, inspect, import, and compare OMP-native security scans',
      argumentHint:
        '<plan|scan|status|cancel|scans|show|import|export|validate|compare|disposition>',
      builtin: false,
    });

    // streaming: deltas live, folded through the client reducer the chat shows the same text
    const deltas = t.events.filter(
      (e) => e.type === 'stream_event' && e.event.type === 'content_block_delta'
    );
    expect(deltas.map((e) => e.event.delta.text).slice(0, 2)).toEqual([
      '`ls` sh',
      'ows three files:',
    ]);
    const state = t.state();
    const assistants = state.messages.filter((m) => m.kind === 'assistant');
    expect(assistants.map((m) => m.blocks.map((b) => b.type))).toEqual([
      ['tool', 'text'],
      ['tool', 'tool', 'text'],
    ]);
    expect(assistants.every((m) => !m.streaming)).toBe(true);
    expect(state.busy).toBe(false);
    expect(state.model).toBe('anthropic/claude-opus-5-5');
  });

  it('keeps block order for parallel tool calls and turns plans into TodoWrite', async () => {
    const t = start();
    t.driver.send('tools');
    await t.replay(frames('omp-tools'));
    const final = t.final();
    const tools = blocks(final).filter((b) => b.type === 'tool_use');
    expect(tools.slice(0, 4).map((b) => [b.name, b.input])).toEqual([
      ['Grep', { pattern: 'hi' }],
      ['Glob', { pattern: '*.txt' }],
      ['Read', { file_path: 'missing.txt' }],
      ['Write', { file_path: 'c.txt', content: 'x' }],
    ]);
    // tool results only after their tool_use; the failed read is an error
    const seen = new Set();
    for (const e of final) {
      if (e.type === 'assistant')
        for (const b of e.message.content) if (b.type === 'tool_use') seen.add(b.id);
      if (e.type === 'user') expect(seen.has(e.message.content[0].tool_use_id)).toBe(true);
    }
    const results = toolResults(final);
    expect(results.find((r) => r.tool_use_id === tools[2].id)).toEqual({
      type: 'tool_result',
      tool_use_id: tools[2].id,
      content: "Path 'missing.txt' not found",
      is_error: true,
    });
    // omp's own todo tool keeps its name; its plan updates are synthetic TodoWrite calls
    expect(tools.filter((b) => b.name === 'todo')).toHaveLength(3);
    const todos = tools.filter((b) => b.name === 'TodoWrite');
    expect(todos.map((b) => b.input)).toEqual([
      {
        todos: [
          { content: 'First item', status: 'in_progress' },
          { content: 'Second item', status: 'pending' },
        ],
      },
      {
        todos: [
          { content: 'First item', status: 'completed' },
          { content: 'Second item', status: 'in_progress' },
        ],
      },
      { todos: [{ content: 'Second item', status: 'in_progress' }] },
      {
        todos: [
          { content: 'First item', status: 'completed' },
          { content: 'Second item', status: 'pending' },
        ],
      },
    ]);
    for (const todo of todos)
      expect(results).toContainEqual({
        type: 'tool_result',
        tool_use_id: todo.id,
        content: '',
        is_error: false,
      });
    const state = t.state();
    const toolBlocks = state.messages.flatMap((m) => (m.kind === 'assistant' ? m.blocks : []));
    expect(
      toolBlocks.filter((b) => b.type === 'tool').every((b) => typeof b.result === 'string')
    ).toBe(true);
  });

  it('interrupt cancels the turn and answers pending permissions as cancelled', async () => {
    const all = frames('omp-cancel');
    const t = start();
    t.driver.send('Run ls');
    t.driver.send('Essay');
    let permissionSeen = false;
    await t.replay(all, (msg) => {
      if (msg.method === 'session/request_permission') permissionSeen = true;
      // answer the first permission only after the turn was interrupted once
      if (
        permissionSeen &&
        msg.method === 'session/update' &&
        msg.params.update.sessionUpdate === 'tool_call'
      ) {
        t.driver.interrupt();
      }
      if (msg.id === 4 && msg.result) t.driver.interrupt();
    });
    const sessionId = '01a1c789-2f96-7253-8ba8-3de9a6630499';
    const cancels = t.proc.written.filter((m) => m.method === 'session/cancel');
    expect(cancels).toEqual([
      { jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } },
      { jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } },
    ]);
    expect(t.proc.written).toContainEqual({
      jsonrpc: '2.0',
      id: 0,
      result: { outcome: { outcome: 'cancelled' } },
    });
    const results = t.final().filter((e) => e.type === 'result');
    expect(results.map((r) => [r.subtype, r.is_error])).toEqual([
      ['success', false],
      ['error_during_execution', true],
    ]);
    const essay = t
      .state()
      .messages.filter((m) => m.kind === 'assistant')
      .at(-1);
    expect(essay.blocks.map((b) => b.type)).toEqual(['thinking', 'text']);
    expect(essay.blocks[1].text.startsWith('**Rivers: The')).toBe(true);
    expect(essay.streaming).toBe(false);
  });

  it('interrupt without a running turn sends nothing', async () => {
    const t = start();
    await t.replay(frames('omp-fresh').slice(0, 2));
    const before = t.proc.written.length;
    t.driver.interrupt();
    expect(t.proc.written).toHaveLength(before);
  });

  it('resume loads the session and replays its turns as history', async () => {
    const t = start({ resume: '01a1c789-2f96-7253-8ba8-3de9a6630499' });
    await t.replay(frames('omp-load'));
    expect(t.proc.written[1]).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/load',
      params: {
        sessionId: '01a1c789-2f96-7253-8ba8-3de9a6630499',
        cwd: '/tmp/acp-probe',
        mcpServers: [],
      },
    });
    expect(t.events.some((e) => e.type === 'stream_event')).toBe(false);
    expect(t.events.some((e) => e.type === 'result')).toBe(false);
    const history = t.events.filter((e) => e.type !== 'devorbit_commands');
    expect(history.map((e) => [e.type, e.history])).toEqual([
      ['devorbit_user', true],
      ['assistant', true],
      ['user', true],
      ['assistant', true],
      ['devorbit_user', true],
      ['system', undefined],
    ]);
    expect(history[0].text).toBe(
      'Run the shell command `ls` in the current directory with your shell tool and tell me the file names. Be brief.'
    );
    expect(history[1].message.content).toEqual([
      {
        type: 'tool_use',
        id: 'toolu_01AerY5SZxP8J2JPGCrewzEK',
        name: 'Bash',
        input: { command: 'ls' },
      },
    ]);
    expect(history[4].text).toBe('Write a 500-word essay about rivers. Do not use any tools.');
    expect(history[5]).toEqual({
      type: 'system',
      subtype: 'init',
      session_id: '01a1c789-2f96-7253-8ba8-3de9a6630499',
      model: 'anthropic/claude-opus-5-5',
    });
    const state = t.state();
    expect(state.busy).toBe(false);
    expect(state.messages.map((m) => m.kind)).toEqual(['user', 'assistant', 'user']);
    expect(state.messages[1].blocks[0].result).toBe('hello.txt\nopencode.json\n');
    // live turns after the history are not history
    t.driver.send('again');
    expect(t.proc.written.at(-1)).toMatchObject({ id: 3, method: 'session/prompt' });
    await t.feed({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: '01a1c789-2f96-7253-8ba8-3de9a6630499',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'hi' },
          messageId: 'x',
        },
      },
    });
    await t.feed({ jsonrpc: '2.0', id: 3, result: { stopReason: 'end_turn' } });
    const live = t.final().slice(history.length + 1);
    expect(live.map((e) => [e.type, e.history])).toEqual([
      ['assistant', undefined],
      ['result', undefined],
    ]);
  });

  it('turns a failed prompt into an error text and an error result', async () => {
    const t = start();
    t.driver.send('hi');
    await t.replay(frames('omp-fresh').slice(0, 2));
    await t.feed({
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32603, message: 'Internal error', data: { details: 'rate limited' } },
    });
    const final = t.final().slice(-2);
    expect(final[0]).toMatchObject({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Error: Internal error: rate limited' }] },
    });
    expect(final[1]).toMatchObject({ type: 'result', subtype: 'error', is_error: true });
  });

  it('re-emits init when the model changes', async () => {
    const t = start();
    await t.replay(frames('omp-fresh').slice(0, 2));
    await t.feed({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: '01a1c783-dc67-7075-98e0-32f09d0a41b6',
        update: {
          sessionUpdate: 'config_option_update',
          configOptions: [
            { id: 'model', category: 'model', currentValue: 'anthropic/claude-fable-5' },
          ],
        },
      },
    });
    expect(t.events.filter((e) => e.type === 'system').map((e) => e.model)).toEqual([
      'anthropic/claude-opus-5-5',
      'anthropic/claude-fable-5',
    ]);
  });
});

describe('acp driver - opencode turns (recorded)', () => {
  it('maps tool input that arrives with later updates, failures, writes and todowrite', async () => {
    const t = start({ harness: 'opencode' });
    t.driver.send('tools');
    await t.replay(frames('opencode-tools'));
    const final = t.final();
    expect(final[0]).toEqual({
      type: 'system',
      subtype: 'init',
      session_id: 'ses_e387a3b60ffeIY5a4x6Du5CEu8',
      model: 'opencode/big-pickle',
    });
    expect(
      blocks(final).map((b) => (b.type === 'tool_use' ? [b.name, b.input] : [b.type]))
    ).toEqual([
      ['thinking'],
      ['Grep', { pattern: 'hi' }],
      ['Glob', { pattern: '*.txt' }],
      ['Read', { file_path: '/private/tmp/acp-tools2/missing.txt' }],
      ['Write', { file_path: '/private/tmp/acp-tools2/c.txt', content: 'x' }],
      [
        'TodoWrite',
        {
          todos: [
            { content: 'Create c.txt', status: 'completed' },
            { content: 'Reply ok', status: 'pending' },
          ],
        },
      ],
      ['text'],
    ]);
    const results = toolResults(final);
    expect(results.find((r) => r.tool_use_id === 'call_9e56a513535c43c09c0afda9')).toEqual({
      type: 'tool_result',
      tool_use_id: 'call_9e56a513535c43c09c0afda9',
      content: 'File not found: /private/tmp/acp-tools2/missing.txt',
      is_error: true,
    });
    expect(results.find((r) => r.tool_use_id === 'call_95c9d7d741714dd9a03852a7').content).toMatch(
      /^Found 2 matches/
    );
    // the streamed tool block got its input once the update brought it
    const starts = t.events.filter(
      (e) =>
        e.type === 'stream_event' &&
        e.event.type === 'content_block_start' &&
        e.event.content_block.id === 'call_95c9d7d741714dd9a03852a7'
    );
    expect(starts.map((e) => e.event.content_block.input)).toEqual([{}, { pattern: 'hi' }]);
    // one assistant message: thought + tools + text of the same turn
    expect(t.state().messages.filter((m) => m.kind === 'assistant')).toHaveLength(1);
  });

  it('permission option ids come from the option kinds; interrupt ends with error_during_execution', async () => {
    const decisions = [];
    const t = start(
      { harness: 'opencode' },
      {
        onEvent: (event, driver) => {
          if (event.type === 'control_request') {
            decisions.push(event);
            driver.answer(event.request_id, 'always');
          }
        },
      }
    );
    t.driver.send('Run ls');
    t.driver.send('Essay');
    await t.replay(frames('opencode-cancel'), (msg) => {
      if (msg.id === 4 && msg.result) t.driver.interrupt();
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0].request).toMatchObject({
      tool_name: 'Bash',
      input: { command: 'ls' },
      permission_suggestions: [{ type: 'acpOption', optionId: 'always' }],
    });
    expect(t.proc.written).toContainEqual({
      jsonrpc: '2.0',
      id: 0,
      result: { outcome: { outcome: 'selected', optionId: 'always' } },
    });
    expect(t.proc.written).toContainEqual({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: 'ses_e38768e3cffewtQAoWf71hO8RM' },
    });
    const results = t.final().filter((e) => e.type === 'result');
    expect(results.map((r) => r.subtype)).toEqual(['success', 'error_during_execution']);
  });

  it('resume replays thought and text with different message ids as one assistant message', async () => {
    const t = start({ harness: 'opencode', resume: 'ses_e38768e3cffewtQAoWf71hO8RM' });
    await t.replay(frames('opencode-load'));
    const state = t.state();
    expect(state.messages.map((m) => m.kind)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(state.messages[3].blocks.map((b) => b.type)).toEqual(['thinking', 'text']);
    expect(t.events.filter((e) => e.type === 'assistant').every((e) => e.history === true)).toBe(
      true
    );
    expect(t.events.at(-1)).toMatchObject({ type: 'devorbit_commands' });
    expect(t.events.find((e) => e.type === 'system')).toEqual({
      type: 'system',
      subtype: 'init',
      session_id: 'ses_e38768e3cffewtQAoWf71hO8RM',
      model: 'opencode/big-pickle',
    });
  });
});

describe('acp driver - permission answers', () => {
  const request = (id, options) => ({
    jsonrpc: '2.0',
    id,
    method: 'session/request_permission',
    params: {
      sessionId: 's',
      toolCall: {
        toolCallId: `t${id}`,
        title: 'rm',
        kind: 'execute',
        rawInput: { command: 'rm x' },
      },
      options,
    },
  });
  const all = [
    { optionId: 'a1', kind: 'allow_once' },
    { optionId: 'a2', kind: 'allow_always' },
    { optionId: 'r1', kind: 'reject_once' },
    { optionId: 'r2', kind: 'reject_always' },
  ];

  it.each([
    ['allow', 'a1'],
    ['always', 'a2'],
    ['deny', 'r1'],
  ])('%s selects %s', async (decision, optionId) => {
    const t = start();
    await t.feed(request(5, all));
    t.driver.answer('5', decision);
    expect(t.proc.written.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 5,
      result: { outcome: { outcome: 'selected', optionId } },
    });
    // answered once only
    t.driver.answer('5', decision);
    expect(t.proc.written.filter((m) => m.id === 5)).toHaveLength(1);
  });

  it('offers no always option without allow_always and falls back within the decision', async () => {
    const t = start();
    await t.feed(request(6, [all[0], all[3]]));
    const event = t.events.at(-1);
    expect(event.request.permission_suggestions).toBeUndefined();
    t.driver.answer('6', 'deny');
    expect(t.proc.written.at(-1).result).toEqual({
      outcome: { outcome: 'selected', optionId: 'r2' },
    });
  });

  it('keeps request ids unique when the agent reuses a JSON-RPC id', async () => {
    const t = start();
    await t.feed(request(0, all));
    t.driver.answer('0', 'allow');
    await t.feed(request(0, all));
    const ids = t.events.filter((e) => e.type === 'control_request').map((e) => e.request_id);
    expect(ids).toEqual(['0', '0-2']);
    t.driver.answer('0-2', 'deny');
    expect(t.proc.written.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 0,
      result: { outcome: { outcome: 'selected', optionId: 'r1' } },
    });
  });
});

describe('acp driver - tool mapping', () => {
  it.each([
    [
      { name: 'bash', kind: 'execute', rawInput: { command: 'ls', i: 'x' } },
      'Bash',
      { command: 'ls' },
    ],
    [{ kind: 'read', rawInput: { filePath: '/a' } }, 'Read', { file_path: '/a' }],
    [{ kind: 'read', rawInput: {}, locations: [{ path: '/b' }] }, 'Read', { file_path: '/b' }],
    [
      { kind: 'edit', rawInput: { filePath: '/a', oldString: 'x', newString: 'y' } },
      'Edit',
      { file_path: '/a', old_string: 'x', new_string: 'y' },
    ],
    [
      { kind: 'edit', content: [{ type: 'diff', path: '/n', oldText: null, newText: 'new' }] },
      'Write',
      { file_path: '/n', content: 'new' },
    ],
    [{ name: 'edit', kind: 'edit', rawInput: { input: 'PUT …' } }, 'edit', { input: 'PUT …' }],
    [
      { title: 'hi', kind: 'search', rawInput: { pattern: 'hi', path: 'src' } },
      'Grep',
      { pattern: 'hi', path: 'src' },
    ],
    [
      { title: 'x', kind: 'search', rawInput: { pattern: '**/*.ts' } },
      'Glob',
      { pattern: '**/*.ts' },
    ],
    [
      { name: 'fetch', kind: 'fetch', rawInput: { url: 'https://x' } },
      'WebFetch',
      { url: 'https://x' },
    ],
    [
      { name: 'web_search', kind: 'fetch', rawInput: { query: 'acp' } },
      'WebSearch',
      { query: 'acp' },
    ],
    [{ name: 'lsp', kind: 'other', rawInput: { op: 'hover' } }, 'lsp', { op: 'hover' }],
    [{ title: 'task', kind: 'think', rawInput: { a: 1 } }, 'task', { a: 1 }],
  ])('%j → %s', (call, name, input) => {
    expect(mapTool(call)).toEqual({ name, input });
  });

  it('prefers raw output over the display content for results', () => {
    expect(toolResultText({ rawOutput: { output: 'o' }, content: [] })).toBe('o');
    expect(toolResultText({ rawOutput: { content: [{ type: 'text', text: 'c' }] } })).toBe('c');
    expect(toolResultText({ rawOutput: { error: 'e' } })).toBe('e');
    expect(
      toolResultText({
        content: [{ type: 'diff' }, { type: 'content', content: { type: 'text', text: 't' } }],
      })
    ).toBe('t');
  });
});
