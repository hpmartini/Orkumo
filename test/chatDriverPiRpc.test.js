import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { startDriver, mapTool, historyEvents } from '../server/services/chatDrivers/piRpc.js';
import { reduceChat, initialChatState } from '../utils/chatEvents';

/** Trimmed stdout frames recorded from `pi --mode rpc` 0.99.1 (MiniMax-M2.7, /tmp/pi-probe) */
const frames = (name) =>
  fs
    .readFileSync(path.join(import.meta.dirname, 'fixtures/pi', `${name}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const FRESH = frames('fresh');
const RESUME_ABORT = frames('resume-abort');
const AUTH_ERROR = frames('auth-error');
const COMMANDS = frames('commands');
const SESSION = '01a1c787-6b92-7123-b7a5-30104776fe7d';

function fakeProc() {
  const proc = new EventEmitter();
  proc.stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
  proc.stderr = Object.assign(new EventEmitter(), { setEncoding() {} });
  proc.written = [];
  proc.answered = new Set();
  proc.stdin = Object.assign(new EventEmitter(), {
    writable: true,
    write: (line) => proc.written.push(JSON.parse(line)),
    end: () => {
      proc.stdin.writable = false;
    },
  });
  proc.kill = vi.fn(() => proc.emit('exit', null));
  return proc;
}

function start(resume = null) {
  const proc = fakeProc();
  const spawn = vi.fn(() => proc);
  const events = [];
  const exits = [];
  const driver = startDriver(
    { harness: 'pi', cwd: '/tmp/pi-probe', resume },
    { bin: '/bin/pi', spawn, emit: (e) => events.push(e), exit: (info) => exits.push(info) }
  );
  return { driver, proc, spawn, events, exits };
}

const sent = (proc, type) => proc.written.filter((c) => c.type === type);

/** Feed recorded frames; a recorded `response` gets the id of the driver's own command */
function feed(proc, list) {
  for (const frame of list) {
    let line = frame;
    if (frame.type === 'response' && frame.command) {
      const cmd = proc.written.find((c) => c.type === frame.command && !proc.answered.has(c.id));
      if (!cmd) continue; // the recorder asked for it, the driver did not
      proc.answered.add(cmd.id);
      line = { ...frame, id: cmd.id };
    }
    proc.stdout.emit('data', `${JSON.stringify(line)}\n`);
  }
}

const response = (list, command) =>
  list.find((f) => f.type === 'response' && f.command === command);
const upTo = (list, pred) => list.slice(0, list.findIndex(pred) + 1);
const after = (list, pred) => list.slice(list.findIndex(pred) + 1);
const nonStream = (events) => events.filter((e) => e.type !== 'stream_event');
const reduce = (events) => events.reduce(reduceChat, initialChatState);

describe('piRpc driver - spawn and handshake', () => {
  it('spawns `pi --mode rpc` with an argument array and asks for state and commands', () => {
    const { spawn, proc } = start();
    expect(spawn).toHaveBeenCalledWith('/bin/pi', ['--mode', 'rpc'], {
      cwd: '/tmp/pi-probe',
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(proc.written.map((c) => c.type)).toEqual(['get_state', 'get_commands']);
  });

  it('resumes with --session-id', () => {
    const { spawn } = start(SESSION);
    expect(spawn.mock.calls[0][1]).toEqual(['--mode', 'rpc', '--session-id', SESSION]);
  });

  it('emits init with the session id and model, and the commands', () => {
    const { proc, events } = start();
    feed(proc, [...COMMANDS, response(FRESH, 'get_state')]);
    expect(events).toEqual([
      {
        type: 'devorbit_commands',
        commands: [
          {
            name: 'bgstatus',
            description: 'Background jobs: status (/bgstatus [id] [done])',
            argumentHint: '',
            builtin: false,
          },
          {
            name: 'bgtail',
            description: 'Background jobs: tail a log (/bgtail <id> [lines])',
            argumentHint: '',
            builtin: false,
          },
        ],
      },
      { type: 'system', subtype: 'init', session_id: SESSION, model: 'MiniMax-M2.7' },
    ]);
  });

  it('a failed get_state ends the process with the error in stderr', () => {
    const { proc, exits } = start();
    feed(proc, [{ type: 'response', command: 'get_state', success: false, error: 'boom' }]);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(exits).toHaveLength(1);
    expect(exits[0].code).toBe(1);
    expect(exits[0].stderr).toContain('pi get_state failed: boom');
  });
});

describe('piRpc driver - fresh turn with a bash tool call (recorded)', () => {
  it('sends attached images as ImageContent with the prompt', () => {
    const { driver, proc } = start();
    driver.send('what is this?', [
      { path: '/d/agent-images/a.png', mimeType: 'image/png', data: 'iVBO' },
    ]);
    feed(proc, [response(FRESH, 'get_state')]);
    expect(sent(proc, 'prompt')[0]).toMatchObject({
      message: 'what is this?',
      images: [{ type: 'image', mimeType: 'image/png', data: 'iVBO' }],
    });
  });

  it('queues the message until the handshake is done, then translates the turn', () => {
    const { driver, proc, events } = start();
    driver.send('Run `ls` with your bash tool, then reply with one short sentence.');
    expect(sent(proc, 'prompt')).toEqual([]);

    feed(proc, [response(FRESH, 'get_state')]);
    expect(sent(proc, 'prompt')).toEqual([
      {
        id: expect.any(String),
        type: 'prompt',
        message: 'Run `ls` with your bash tool, then reply with one short sentence.',
      },
    ]);

    feed(
      proc,
      FRESH.filter((f) => f.command !== 'get_state')
    );
    // status/widget notifications need no answer
    expect(sent(proc, 'extension_ui_response')).toEqual([]);

    const [first, second] = events.filter((e) => e.type === 'assistant').map((e) => e.message.id);
    expect(first).not.toBe(second);
    expect(nonStream(events)).toEqual([
      { type: 'system', subtype: 'init', session_id: SESSION, model: 'MiniMax-M2.7' },
      {
        type: 'assistant',
        message: {
          id: first,
          content: [
            {
              type: 'tool_use',
              id: 'call_ba76f0adae67eff001863e80',
              name: 'Bash',
              input: { command: 'ls' },
            },
          ],
        },
        parent_tool_use_id: null,
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_ba76f0adae67eff001863e80',
              content: 'dummy.txt\n',
              is_error: false,
            },
          ],
        },
        parent_tool_use_id: null,
      },
      {
        type: 'assistant',
        message: {
          id: second,
          content: [{ type: 'text', text: 'The directory contains one file, `dummy.txt`.' }],
        },
        parent_tool_use_id: null,
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: expect.any(Number),
        session_id: SESSION,
      },
    ]);

    expect(events.filter((e) => e.type === 'stream_event').map((e) => e.event)).toEqual([
      { type: 'message_start', message: { id: first } },
      {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'call_ba76f0adae67eff001863e80',
          name: 'Bash',
          input: {},
        },
      },
      { type: 'message_stop' },
      { type: 'message_start', message: { id: second } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'The directory contain' },
      },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 's one fi' } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'le, `dummy.txt`.' },
      },
      { type: 'message_stop' },
    ]);

    const state = reduce([{ type: 'devorbit_user', text: 'Run ls' }, ...events]);
    expect(state.busy).toBe(false);
    expect(state.sessionId).toBe(SESSION);
    expect(state.messages.filter((m) => m.kind === 'assistant')).toMatchObject([
      {
        blocks: [
          {
            type: 'tool',
            name: 'Bash',
            input: { command: 'ls' },
            result: 'dummy.txt\n',
            isError: false,
          },
        ],
        streaming: false,
      },
      { blocks: [{ type: 'text', text: 'The directory contains one file, `dummy.txt`.' }] },
    ]);
  });

  it('parses frames split across chunks and skips garbage lines', () => {
    const { proc, events } = start();
    const line = JSON.stringify({ ...response(FRESH, 'get_state'), id: proc.written[0].id });
    proc.stdout.emit('data', 'not json\n{"no":"type"}\n');
    proc.stdout.emit('data', line.slice(0, 20));
    proc.stdout.emit('data', `${line.slice(20)}\r\n`);
    expect(events).toEqual([
      { type: 'system', subtype: 'init', session_id: SESSION, model: 'MiniMax-M2.7' },
    ]);
  });
});

describe('piRpc driver - resume with history, then interrupt (recorded)', () => {
  it('replays get_messages as history, then aborts the running turn', () => {
    const { driver, proc, events } = start(SESSION);
    feed(proc, [response(RESUME_ABORT, 'get_state')]);
    expect(sent(proc, 'get_messages')).toHaveLength(1);
    // no prompt before the history is in
    driver.send('Run `sleep 30 && echo hi` with your bash tool, then reply done.');
    expect(sent(proc, 'prompt')).toEqual([]);

    feed(proc, [response(RESUME_ABORT, 'get_messages')]);
    const history = events.slice(1);
    const ids = history.filter((e) => e.type === 'assistant').map((e) => e.message.id);
    expect(history).toEqual([
      {
        type: 'devorbit_user',
        text: 'Run `ls` with your bash tool, then reply with one short sentence.',
        history: true,
      },
      {
        type: 'assistant',
        message: {
          id: ids[0],
          content: [
            {
              type: 'tool_use',
              id: 'call_ba76f0adae67eff001863e80',
              name: 'Bash',
              input: { command: 'ls' },
            },
          ],
        },
        parent_tool_use_id: null,
        history: true,
      },
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_ba76f0adae67eff001863e80',
              content: 'dummy.txt\n',
              is_error: false,
            },
          ],
        },
        parent_tool_use_id: null,
      },
      {
        type: 'assistant',
        message: {
          id: ids[1],
          content: [{ type: 'text', text: 'The directory contains one file, `dummy.txt`.' }],
        },
        parent_tool_use_id: null,
        history: true,
      },
    ]);
    expect(sent(proc, 'prompt')).toHaveLength(1);

    const live = RESUME_ABORT.filter((f) => !['get_state', 'get_messages'].includes(f.command));
    const isToolStart = (f) => f.type === 'tool_execution_start';
    events.length = 0;
    feed(proc, upTo(live, isToolStart));
    driver.interrupt();
    expect(sent(proc, 'abort')).toHaveLength(1);
    feed(proc, after(live, isToolStart));

    const thinking = events.filter(
      (e) => e.type === 'stream_event' && e.event.type === 'content_block_delta'
    );
    expect(thinking[0].event).toEqual({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'Run' },
    });
    const finals = nonStream(events);
    expect(finals.map((e) => e.type)).toEqual(['assistant', 'user', 'result']);
    expect(finals[0].message.content.map((b) => b.type)).toEqual(['thinking', 'tool_use']);
    expect(finals[0].message.content[1]).toMatchObject({
      name: 'Bash',
      input: { command: 'sleep 30 && echo hi', timeout: 60 },
    });
    expect(finals[1].message.content[0]).toMatchObject({
      content: 'Command aborted',
      is_error: true,
    });
    // pi's trailing "This operation was aborted" error message is not a chat error
    expect(JSON.stringify(finals)).not.toContain('This operation was aborted');
    expect(finals[2]).toMatchObject({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      session_id: SESSION,
    });
  });

  it('historyEvents keeps an error message and skips system and bash messages', () => {
    let n = 0;
    const events = historyEvents(
      [
        { role: 'system', content: '' },
        { role: 'user', content: 'plain string turn' },
        { role: 'bashExecution', command: 'ls', output: 'x' },
        { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'rate limited' },
        { role: 'assistant', content: [], stopReason: 'aborted' },
      ],
      () => `h${++n}`
    );
    expect(events).toEqual([
      { type: 'devorbit_user', text: 'plain string turn', history: true },
      {
        type: 'assistant',
        message: { id: 'h1', content: [{ type: 'text', text: 'rate limited' }] },
        parent_tool_use_id: null,
        history: true,
      },
    ]);
  });
});

describe('piRpc driver - failed turns', () => {
  it('a provider error becomes an assistant error text and an error result (recorded)', () => {
    const { driver, proc, events } = start();
    feed(proc, [response(FRESH, 'get_state')]);
    driver.send('Run `ls`');
    feed(proc, AUTH_ERROR);
    expect(nonStream(events).slice(1)).toEqual([
      // the turn ran on another model than get_state reported
      { type: 'system', subtype: 'init', session_id: SESSION, model: 'claude-haiku-4-5' },
      {
        type: 'assistant',
        message: {
          id: expect.any(String),
          content: [
            { type: 'text', text: 'OAuth refresh failed for anthropic: Anthropic token refresh ' },
          ],
        },
        parent_tool_use_id: null,
      },
      {
        type: 'result',
        subtype: 'error',
        is_error: true,
        duration_ms: expect.any(Number),
        session_id: SESSION,
      },
    ]);
    // nothing streamed for the empty message
    expect(events.some((e) => e.type === 'stream_event')).toBe(false);
  });

  it('a rejected prompt ends the turn with an error', () => {
    const { driver, proc, events } = start();
    feed(proc, [response(FRESH, 'get_state')]);
    driver.send('hi');
    feed(proc, [
      { type: 'response', command: 'prompt', success: false, error: 'Agent is already streaming' },
    ]);
    expect(nonStream(events).slice(1)).toMatchObject([
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'pi rejected the message: Agent is already streaming' }],
        },
      },
      { type: 'result', subtype: 'error', is_error: true },
    ]);
  });

  it('a message an extension command handled ends the turn at once', () => {
    const { driver, proc, events } = start();
    feed(proc, [response(FRESH, 'get_state')]);
    driver.send('/bgstatus');
    feed(proc, [
      { type: 'response', command: 'prompt', success: true, data: { disposition: 'handled' } },
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'success', is_error: false });
  });
});

describe('piRpc driver - queue and interrupt', () => {
  const run = [
    { type: 'response', command: 'prompt', success: true, data: { disposition: 'started' } },
    { type: 'agent_start' },
  ];
  const settle = [{ type: 'agent_end', messages: [] }, { type: 'agent_settled' }];

  it('sends one prompt at a time, one result per turn', () => {
    const { driver, proc, events } = start();
    feed(proc, [response(FRESH, 'get_state')]);
    driver.send('first');
    driver.send('second');
    expect(sent(proc, 'prompt').map((c) => c.message)).toEqual(['first']);
    feed(proc, [...run, ...settle]);
    expect(sent(proc, 'prompt').map((c) => c.message)).toEqual(['first', 'second']);
    feed(proc, [...run, ...settle]);
    expect(events.filter((e) => e.type === 'result').map((e) => e.subtype)).toEqual([
      'success',
      'success',
    ]);
  });

  it('interrupt aborts the running turn and drops the queued ones', () => {
    const { driver, proc, events } = start();
    feed(proc, [response(FRESH, 'get_state')]);
    driver.send('first');
    driver.send('second');
    feed(proc, run);
    driver.interrupt();
    expect(sent(proc, 'abort')).toHaveLength(1);
    feed(proc, [...settle, { type: 'response', command: 'abort', success: true }]);
    expect(sent(proc, 'prompt')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'result').map((e) => e.subtype)).toEqual([
      'error_during_execution',
      'error_during_execution',
    ]);
  });

  it('interrupt before the handshake drops the queued turn', () => {
    const { driver, proc, events } = start();
    driver.send('first');
    driver.interrupt();
    expect(sent(proc, 'abort')).toEqual([]);
    expect(events).toMatchObject([{ type: 'result', subtype: 'error_during_execution' }]);
    feed(proc, [response(FRESH, 'get_state')]);
    expect(sent(proc, 'prompt')).toEqual([]);
  });

  it('waits for a run an extension started before sending the next prompt', () => {
    const { driver, proc } = start();
    feed(proc, [response(FRESH, 'get_state'), { type: 'agent_start' }]);
    driver.send('hi');
    expect(sent(proc, 'prompt')).toEqual([]);
    feed(proc, [{ type: 'agent_settled' }]);
    expect(sent(proc, 'prompt')).toHaveLength(1);
  });
});

describe('piRpc driver - permissions, extension dialogs, process lifecycle', () => {
  it('cancels extension dialogs (no UI for them in the chat)', () => {
    const { proc } = start();
    feed(proc, [
      {
        type: 'extension_ui_request',
        id: 'u1',
        method: 'confirm',
        title: 'Allow?',
        message: 'rm -rf',
      },
      { type: 'extension_ui_request', id: 'u2', method: 'notify', message: 'hello' },
    ]);
    expect(sent(proc, 'extension_ui_response')).toEqual([
      { type: 'extension_ui_response', id: 'u1', cancelled: true },
    ]);
  });

  it('answer throws 400: pi has no permission requests', () => {
    const { driver } = start();
    expect(() => driver.answer('x', 'allow')).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('reports the exit once with the stderr tail; calls on a dead process throw 400', () => {
    const { driver, proc, exits } = start();
    proc.stderr.emit('data', 'x'.repeat(5000));
    proc.stderr.emit('data', 'No API key found for anthropic');
    proc.stdin.writable = false;
    proc.emit('exit', 1);
    proc.emit('exit', 1);
    expect(exits).toHaveLength(1);
    expect(exits[0].code).toBe(1);
    expect(exits[0].stderr.length).toBeLessThanOrEqual(4000);
    expect(exits[0].stderr.endsWith('No API key found for anthropic')).toBe(true);
    for (const call of [
      () => driver.send('hi'),
      () => driver.interrupt(),
      () => driver.answer('r', 'allow'),
    ])
      expect(call).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('a spawn error ends the session with code -1', () => {
    const { proc, exits } = start();
    proc.emit('error', new Error('spawn /bin/pi ENOENT'));
    expect(exits).toEqual([{ code: -1, stderr: expect.stringContaining('ENOENT') }]);
  });

  it('stop closes stdin and sends SIGTERM once, SIGKILL after 3 s', () => {
    vi.useFakeTimers();
    try {
      const { driver, proc, exits } = start();
      proc.kill = vi.fn(); // the process ignores SIGTERM
      driver.stop();
      driver.stop();
      expect(proc.stdin.writable).toBe(false);
      expect(proc.kill.mock.calls).toEqual([['SIGTERM']]);
      vi.advanceTimersByTime(3000);
      expect(proc.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
      // pi exits 143 on SIGTERM: our own stop is a clean end
      proc.emit('exit', 143);
      expect(exits).toEqual([{ code: null, stderr: '' }]);
      expect(() => driver.send('hi')).toThrow(expect.objectContaining({ status: 400 }));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('piRpc driver - tool mapping', () => {
  it('maps pi tools to Claude names and inputs', () => {
    expect(mapTool('read', { path: 'a.ts', offset: 3 })).toEqual({
      name: 'Read',
      input: { file_path: 'a.ts', offset: 3 },
    });
    expect(mapTool('write', { path: 'a.ts', content: 'x' })).toEqual({
      name: 'Write',
      input: { file_path: 'a.ts', content: 'x' },
    });
    expect(mapTool('edit', { path: 'a.ts', edits: [{ oldText: 'a', newText: 'b' }] })).toEqual({
      name: 'Edit',
      input: { file_path: 'a.ts', old_string: 'a', new_string: 'b' },
    });
    expect(
      mapTool('edit', {
        path: 'a.ts',
        edits: [
          { oldText: 'a', newText: 'b' },
          { oldText: 'c', newText: 'd' },
        ],
      })
    ).toEqual({
      name: 'MultiEdit',
      input: {
        file_path: 'a.ts',
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: 'd' },
        ],
      },
    });
    expect(mapTool('grep', { pattern: 'foo', path: 'src' })).toEqual({
      name: 'Grep',
      input: { pattern: 'foo', path: 'src' },
    });
    expect(mapTool('find', { pattern: '*.ts' })).toEqual({
      name: 'Glob',
      input: { pattern: '*.ts' },
    });
    expect(mapTool('ls', { path: 'src' })).toEqual({ name: 'ls', input: { path: 'src' } });
    expect(mapTool('bgrun', { command: 'make' })).toEqual({
      name: 'bgrun',
      input: { command: 'make' },
    });
  });
});
