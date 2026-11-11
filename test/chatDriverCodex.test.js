import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  startDriver,
  historyEvents,
  unwrapShell,
  parseLine,
} from '../server/services/chatDrivers/codex.js';
import { reduceChat, initialChatState } from '../utils/chatEvents';

// Frames recorded from `codex app-server` (codex-cli 0.151.0) in /tmp/codex-probe, noise
// notifications (hooks, token usage, rate limits, MCP startup) trimmed, home paths anonymized
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/codex');
const fixture = (name) =>
  fs
    .readFileSync(path.join(FIXTURES, name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const THREAD = '01a1c783-3f40-7410-9374-8704e0c5769b';
const CWD = '/tmp/codex-probe';

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
      end: () => {},
    });
    proc.kill = vi.fn(() => proc.emit('exit', null));
    calls.push({ bin, args, opts, proc });
    return proc;
  });
  return { spawn, calls };
}

function start({ resume = null, frames = [] } = {}) {
  const { spawn, calls } = fakeSpawn();
  const events = [];
  const exits = [];
  const driver = startDriver(
    { harness: 'codex', cwd: CWD, resume },
    { bin: '/bin/codex', spawn, emit: (e) => events.push(e), exit: (i) => exits.push(i) }
  );
  const { proc } = calls[0];
  const feed = (frame) => proc.stdout.emit('data', `${JSON.stringify(frame)}\n`);
  let i = 0;
  /** Feed recorded frames up to and including the first one matching `pred` */
  const until = (pred) => {
    while (i < frames.length) {
      const frame = frames[i++];
      feed(frame);
      if (pred(frame)) return frame;
    }
    throw new Error('frame not found');
  };
  const rest = () => {
    while (i < frames.length) feed(frames[i++]);
  };
  return { driver, proc, events, exits, spawn, call: calls[0], feed, until, rest };
}

const isResponse = (id) => (f) => f.id === id && !f.method;
const isMethod = (method) => (f) => f.method === method;
const lastWritten = (proc) => proc.written[proc.written.length - 1];
const fold = (events) => events.reduce(reduceChat, initialChatState);
const replayable = (events) => events.filter((e) => e.type !== 'stream_event');
const status = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.status;
  }
  return 'no error';
};
/** Session through the recorded handshake (initialize + thread/start), first message sent */
const handshake = (frames, text = 'hi') => {
  const s = start({ frames });
  s.driver.send(text);
  s.until(isResponse(2));
  return s;
};
const turnCompleted = (id, turnStatus, extra = {}) => ({
  method: 'turn/completed',
  params: { threadId: THREAD, turn: { id, status: turnStatus, ...extra } },
});
const REASON = 'Do you want to allow creation of the requested directory and output confirmation?';

describe('codex driver - handshake', () => {
  it('spawns `codex app-server` and queues the first message until the thread exists', () => {
    const s = start({ frames: fixture('fresh.jsonl') });
    expect(s.call.bin).toBe('/bin/codex');
    expect(s.call.args).toEqual(['app-server']);
    expect(s.call.opts).toMatchObject({ cwd: CWD, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(s.proc.written[0]).toMatchObject({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'devorbit' }, capabilities: { experimentalApi: false } },
    });

    s.driver.send('Run ls');
    expect(s.proc.written).toHaveLength(1);
    s.until(isResponse(1));
    expect(s.proc.written.slice(1)).toEqual([
      { jsonrpc: '2.0', method: 'initialized' },
      { jsonrpc: '2.0', id: 'rate-limits', method: 'account/rateLimits/read' },
      { jsonrpc: '2.0', id: 2, method: 'thread/start', params: { cwd: CWD } },
    ]);
    s.until(isResponse(2));
    expect(s.events[0]).toEqual({
      type: 'system',
      subtype: 'init',
      session_id: THREAD,
      model: 'gpt-5.6-terra',
    });
    expect(lastWritten(s.proc)).toEqual({
      jsonrpc: '2.0',
      id: 3,
      method: 'turn/start',
      params: { threadId: THREAD, input: [{ type: 'text', text: 'Run ls', text_elements: [] }] },
    });
  });

  it('ends the process with the error when the thread cannot start', () => {
    const s = start();
    s.feed({ id: 1, result: {} });
    s.feed({ id: 2, error: { code: -32600, message: 'not logged in' } });
    expect(s.proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(s.exits).toEqual([{ code: 1, stderr: 'codex thread/start: not logged in' }]);
  });

  it('reports context fill and plan limits; a sparse limits update keeps the other window', () => {
    const s = start();
    s.feed({ id: 1, result: {} });
    s.feed({
      id: 'rate-limits',
      result: {
        rateLimits: {
          primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1794380000 },
          secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: null },
        },
      },
    });
    s.feed({
      method: 'account/rateLimits/updated',
      params: { rateLimits: { primary: { usedPercent: 15, windowDurationMins: 300 } } },
    });
    s.feed({
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: THREAD,
        turnId: 't1',
        tokenUsage: { last: { totalTokens: 21000 }, total: {}, modelContextWindow: 258000 },
      },
    });
    const usage = s.events.filter((e) => e.type === 'devorbit_usage');
    expect(usage[0].limits).toEqual({
      fiveHour: { usedPercent: 12, resetsAt: 1794380000000, windowMinutes: 300 },
      weekly: { usedPercent: 40, resetsAt: null, windowMinutes: 10080 },
    });
    expect(usage[1].limits).toEqual({
      fiveHour: { usedPercent: 15, resetsAt: null, windowMinutes: 300 },
      weekly: { usedPercent: 40, resetsAt: null, windowMinutes: 10080 },
    });
    expect(usage[2]).toEqual({
      type: 'devorbit_usage',
      context: { tokens: 21000, window: 258000 },
    });
  });
});

describe('codex driver - recorded turn', () => {
  it('maps command, file change (with approval) and messages to Claude events', () => {
    const s = handshake(fixture('fresh.jsonl'));
    s.until(isMethod('item/fileChange/requestApproval'));
    const request = s.events.at(-1);
    expect(request).toEqual({
      type: 'control_request',
      request_id: 'codex-0',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Edit',
        input: {
          file_path: '/tmp/codex-probe/hello.txt',
          old_string: 'hello',
          new_string: 'hi there',
        },
        permission_suggestions: ['acceptForSession'],
      },
    });
    s.driver.answer('codex-0', 'allow');
    expect(lastWritten(s.proc)).toEqual({ jsonrpc: '2.0', id: 0, result: { decision: 'accept' } });

    s.until(isMethod('turn/completed'));
    const turn = '01a1c783-3fec-7fc2-ae2d-78583eb1458d';
    const summary = replayable(s.events.slice(1)).map((e) =>
      e.type === 'assistant'
        ? [e.message.id, ...e.message.content.map((b) => b.name ?? b.text)]
        : e.type === 'user'
          ? ['result', e.message.content[0].content]
          : [e.type]
    );
    expect(summary).toEqual([
      [`${turn}:1`, 'I’ll list the directory, update `hello.txt`, then report the names.'],
      [`${turn}:1`, 'Bash'],
      ['result', 'hello.txt\n'],
      [`${turn}:2`, 'Edit'],
      ['control_request'],
      ['result', 'Applied'],
      [`${turn}:3`, 'Bash'],
      ['result', 'hello.txt\n'],
      [`${turn}:4`, 'hello.txt'],
      ['result'],
    ]);
    expect(
      s.events.find((e) => e.message?.content?.[0]?.name === 'Bash').message.content[0]
    ).toMatchObject({ input: { command: 'ls' } });
    expect(s.events.at(-1)).toEqual({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 16245,
      session_id: THREAD,
    });
  });

  it('gives the client the same chat live and on replay (streams are live-only)', () => {
    const s = handshake(fixture('fresh.jsonl'));
    s.until(isMethod('item/fileChange/requestApproval'));
    s.driver.answer('codex-0', 'allow');
    s.until(isMethod('turn/completed'));
    const live = fold(s.events);
    const replay = fold(replayable(s.events));
    const blocks = (state) =>
      state.messages.filter((m) => m.kind === 'assistant').map((m) => [m.blocks, m.streaming]);
    expect(blocks(live)).toEqual(blocks(replay));
    expect(live.busy).toBe(false);
    expect(live.sessionId).toBe(THREAD);
    expect(live.model).toBe('gpt-5.6-terra');
    const tools = live.messages.flatMap((m) =>
      m.kind === 'assistant' ? m.blocks.filter((b) => b.type === 'tool') : []
    );
    expect(tools.map((t) => [t.name, t.result, t.isError])).toEqual([
      ['Bash', 'hello.txt\n', false],
      ['Edit', 'Applied', false],
      ['Bash', 'hello.txt\n', false],
    ]);
    expect(live.messages.map((m) => m.kind)).toEqual([
      'assistant',
      'assistant',
      'permission',
      'assistant',
      'assistant',
      'result',
    ]);
  });

  it('interrupts with turn/interrupt; the streamed text ends as error_during_execution', () => {
    const s = handshake(fixture('fresh.jsonl'));
    s.until(isMethod('item/fileChange/requestApproval'));
    s.driver.answer('codex-0', 'allow');
    s.until(isMethod('turn/completed'));
    s.driver.send('Count slowly');
    expect(lastWritten(s.proc)).toMatchObject({ id: 4, method: 'turn/start' });
    s.until(isMethod('item/agentMessage/delta'));
    s.driver.interrupt();
    expect(lastWritten(s.proc)).toEqual({
      jsonrpc: '2.0',
      id: 5,
      method: 'turn/interrupt',
      params: { threadId: THREAD, turnId: '01a1c783-7f68-7352-bb6b-194b19cbb32c' },
    });
    const from = s.events.length;
    s.rest();
    const streamed = fixture('fresh.jsonl')
      .filter((f) => f.method === 'item/agentMessage/delta')
      .filter((f) => f.params.turnId === '01a1c783-7f68-7352-bb6b-194b19cbb32c')
      .map((f) => f.params.delta)
      .join('');
    const tail = replayable(s.events.slice(from - 1));
    expect(tail.at(-2)).toEqual({
      type: 'assistant',
      message: {
        id: '01a1c783-7f68-7352-bb6b-194b19cbb32c:1',
        content: [{ type: 'text', text: streamed }],
      },
    });
    expect(tail.at(-1)).toMatchObject({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      duration_ms: 1983,
    });
  });

  it('defers an interrupt until codex names the turn; idle interrupt is a no-op', () => {
    const s = handshake(fixture('fresh.jsonl'));
    s.driver.interrupt();
    expect(lastWritten(s.proc)).toMatchObject({ method: 'turn/start' });
    s.feed({ id: 3, result: { turn: { id: 'turn-1' } } });
    expect(lastWritten(s.proc)).toMatchObject({
      method: 'turn/interrupt',
      params: { threadId: THREAD, turnId: 'turn-1' },
    });
    s.feed(turnCompleted('turn-1', 'interrupted'));
    const count = s.proc.written.length;
    s.driver.interrupt();
    expect(s.proc.written).toHaveLength(count);
  });

  it('runs messages sent during a turn one after another', () => {
    const s = handshake(fixture('fresh.jsonl'), 'one');
    s.driver.send('two');
    expect(s.proc.written.filter((w) => w.method === 'turn/start')).toHaveLength(1);
    s.feed({ id: 3, result: { turn: { id: 'turn-1' } } });
    s.feed(turnCompleted('turn-1', 'completed', { durationMs: 5 }));
    expect(lastWritten(s.proc)).toMatchObject({
      method: 'turn/start',
      params: { input: [{ type: 'text', text: 'two' }] },
    });
    expect(s.events.filter((e) => e.type === 'result')).toHaveLength(1);
  });
});

describe('codex driver - approvals', () => {
  const approvalRun = (mutate = (f) => f) => {
    const frames = fixture('command-approval.jsonl').map(mutate);
    const s = handshake(frames);
    s.until(isMethod('item/commandExecution/requestApproval'));
    return s;
  };

  it('asks for a command with codex reason and the exec-policy rule as "always"', () => {
    const s = approvalRun();
    expect(s.events.at(-1)).toEqual({
      type: 'control_request',
      request_id: 'codex-0',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: 'mkdir -p /tmp/codex-probe/newdir && echo made' },
        description: REASON,
        decision_reason: REASON,
        permission_suggestions: [
          {
            acceptWithExecpolicyAmendment: {
              execpolicy_amendment: ['mkdir', '-p', '/tmp/codex-probe/newdir'],
            },
          },
        ],
      },
    });
    s.driver.answer('codex-0', 'always');
    expect(lastWritten(s.proc)).toEqual({
      jsonrpc: '2.0',
      id: 0,
      result: {
        decision: {
          acceptWithExecpolicyAmendment: {
            execpolicy_amendment: ['mkdir', '-p', '/tmp/codex-probe/newdir'],
          },
        },
      },
    });
    s.rest();
    const state = fold(s.events);
    const bash = state.messages
      .flatMap((m) => (m.kind === 'assistant' ? m.blocks : []))
      .find((b) => b.type === 'tool');
    expect(bash).toMatchObject({ name: 'Bash', result: 'made\n', isError: false });
    expect(s.events.at(-1)).toMatchObject({ type: 'result', subtype: 'success' });
  });

  it('denies with cancel when codex offers no decline, else with decline', () => {
    const offered = approvalRun();
    offered.driver.answer('codex-0', 'deny');
    expect(lastWritten(offered.proc).result).toEqual({ decision: 'cancel' });

    const legacy = approvalRun((f) => {
      if (f.method !== 'item/commandExecution/requestApproval') return f;
      const params = { ...f.params };
      delete params.availableDecisions;
      return { ...f, params };
    });
    legacy.driver.answer('codex-0', 'deny');
    expect(lastWritten(legacy.proc).result).toEqual({ decision: 'decline' });
  });

  it('maps file change and permission profile answers; unknown requests get an error', () => {
    const s = handshake(fixture('fresh.jsonl'));
    s.feed({
      method: 'item/fileChange/requestApproval',
      id: 7,
      params: { threadId: THREAD, turnId: 't', itemId: 'nope', reason: 'needs write' },
    });
    expect(s.events.at(-1).request).toMatchObject({
      tool_name: 'apply_patch',
      description: 'needs write',
    });
    s.driver.answer('codex-7', 'always');
    expect(lastWritten(s.proc)).toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: { decision: 'acceptForSession' },
    });

    s.feed({
      method: 'item/permissions/requestApproval',
      id: 8,
      params: {
        threadId: THREAD,
        reason: 'network',
        permissions: { network: { enabled: true }, fileSystem: null },
      },
    });
    s.driver.answer('codex-8', 'allow');
    expect(lastWritten(s.proc).result).toEqual({
      permissions: { network: { enabled: true } },
      scope: 'turn',
    });

    s.feed({ method: 'item/tool/requestUserInput', id: 9, params: { threadId: THREAD } });
    expect(lastWritten(s.proc)).toMatchObject({ id: 9, error: { code: -32601 } });

    // A request codex already resolved (interrupted turn) has nothing left to answer
    s.feed({ method: 'item/fileChange/requestApproval', id: 10, params: { threadId: THREAD } });
    s.feed({ method: 'serverRequest/resolved', params: { threadId: THREAD, requestId: 10 } });
    const count = s.proc.written.length;
    s.driver.answer('codex-10', 'allow');
    expect(s.proc.written).toHaveLength(count);
  });
});

describe('codex driver - plan and errors', () => {
  it('turns a plan update into a TodoWrite call with an empty result', () => {
    const fresh = fixture('fresh.jsonl');
    const s = start({ frames: [...fresh.slice(0, 2), ...fixture('plan.jsonl')] });
    s.driver.send('plan');
    s.rest();
    const todo = s.events.find((e) => e.message?.content?.[0]?.name === 'TodoWrite');
    expect(todo.message.content[0].input).toEqual({
      todos: [
        { content: 'Run the requested shell command', status: 'completed' },
        { content: 'Reply with confirmation', status: 'pending' },
      ],
    });
    const id = todo.message.content[0].id;
    expect(s.events).toContainEqual({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: id, content: '', is_error: false }],
      },
    });
    expect(s.events.at(-1)).toMatchObject({ type: 'result', subtype: 'success' });
  });

  it('reports a failed turn as assistant text plus an error result', () => {
    const s = handshake(fixture('fresh.jsonl'));
    s.feed({ id: 3, result: { turn: { id: 'turn-1' } } });
    s.feed({
      method: 'error',
      params: { threadId: THREAD, willRetry: false, error: { message: 'quota' } },
    });
    s.feed(turnCompleted('turn-1', 'failed', { error: null }));
    expect(replayable(s.events).slice(-2)).toEqual([
      {
        type: 'assistant',
        message: { id: 'turn-1:1', content: [{ type: 'text', text: 'quota' }] },
      },
      expect.objectContaining({ type: 'result', subtype: 'error', is_error: true }),
    ]);
  });

  it('reports a rejected turn/start and goes on with the next message', () => {
    const s = handshake(fixture('fresh.jsonl'), 'one');
    s.driver.send('two');
    s.feed({ id: 3, error: { code: -32600, message: 'bad input' } });
    expect(s.events.slice(-2)).toEqual([
      {
        type: 'assistant',
        message: { id: 'codex-error-1', content: [{ type: 'text', text: 'bad input' }] },
      },
      expect.objectContaining({ type: 'result', subtype: 'error', is_error: true }),
    ]);
    expect(lastWritten(s.proc)).toMatchObject({ id: 4, method: 'turn/start' });
  });

  it('re-announces the model when codex reroutes', () => {
    const s = handshake(fixture('fresh.jsonl'));
    s.feed({
      method: 'model/rerouted',
      params: { threadId: THREAD, fromModel: 'gpt-5.6-terra', toModel: 'gpt-5.5' },
    });
    expect(s.events.at(-1)).toEqual({
      type: 'system',
      subtype: 'init',
      session_id: THREAD,
      model: 'gpt-5.5',
    });
  });
});

describe('codex driver - resume', () => {
  it('resumes the thread and replays its turns as history before the first live turn', () => {
    const s = start({ resume: THREAD, frames: fixture('resume.jsonl') });
    s.driver.send('next');
    s.until(isResponse(1));
    expect(lastWritten(s.proc)).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'thread/resume',
      params: { threadId: THREAD, cwd: CWD, excludeTurns: true },
    });
    s.until(isResponse(2));
    expect(s.events).toEqual([
      { type: 'system', subtype: 'init', session_id: THREAD, model: 'gpt-5.6-terra' },
    ]);
    expect(lastWritten(s.proc)).toEqual({
      jsonrpc: '2.0',
      id: 3,
      method: 'thread/turns/list',
      params: { threadId: THREAD, limit: 50, sortDirection: 'desc', itemsView: 'full' },
    });
    s.until(isResponse(3));
    const history = s.events.slice(1);
    expect(history.some((e) => e.type === 'result' || e.type === 'stream_event')).toBe(false);
    const users = history.filter((e) => e.type === 'devorbit_user');
    expect(users.map((e) => [e.text.slice(0, 20), e.history])).toEqual([
      ['Run the shell comman', true],
      ['Count slowly from 1 ', true],
      ['Use the shell to run', true],
    ]);
    const assistant = history.filter((e) => e.type === 'assistant');
    expect(assistant.every((e) => e.history === true)).toBe(true);
    expect(lastWritten(s.proc)).toMatchObject({ id: 4, method: 'turn/start' });

    const state = fold(history);
    expect(state.busy).toBe(false);
    expect(
      state.messages.map((m) =>
        m.kind === 'assistant' ? m.blocks.map((b) => b.name ?? b.text).join('|') : m.kind
      )
    ).toEqual([
      'user',
      'I’ll list the directory, update `hello.txt`, then report the names.|Bash',
      'Edit',
      'Bash',
      'hello.txt',
      'user',
      'user',
      'I’ll run the specified command and record the two-step plan.|ok',
    ]);
    expect(state.messages.some((m) => m.kind === 'assistant' && m.streaming)).toBe(false);
  });

  it('ends the process when the thread cannot be resumed', () => {
    const s = start({ resume: THREAD });
    s.feed({ id: 1, result: {} });
    s.feed({ id: 2, error: { code: -32600, message: 'no rollout found' } });
    expect(s.exits).toEqual([{ code: 1, stderr: 'codex thread/resume: no rollout found' }]);
  });
});

describe('codex driver - process', () => {
  it('reports the exit once with the stderr tail; a dead session refuses work with 400', () => {
    const s = start();
    s.proc.stderr.emit('data', 'x'.repeat(5000));
    s.proc.stdout.emit('data', 'not json\n\n{"broken":\n');
    s.proc.emit('exit', 2);
    s.proc.emit('exit', 2);
    expect(s.exits).toHaveLength(1);
    expect(s.exits[0].code).toBe(2);
    expect(s.exits[0].stderr).toHaveLength(4000);
    expect(status(() => s.driver.send('hi'))).toBe(400);
    expect(status(() => s.driver.interrupt())).toBe(400);
    expect(status(() => s.driver.answer('codex-0', 'allow'))).toBe(400);
  });

  it('stop closes stdin, sends SIGTERM once and is idempotent', () => {
    const s = start();
    s.proc.kill = vi.fn();
    const end = vi.spyOn(s.proc.stdin, 'end');
    s.driver.stop();
    s.driver.stop();
    expect(end).toHaveBeenCalledTimes(1);
    expect(s.proc.kill).toHaveBeenCalledTimes(1);
    expect(s.proc.kill).toHaveBeenCalledWith('SIGTERM');
    s.proc.emit('exit', null);
    expect(s.exits).toEqual([{ code: null, stderr: '' }]);
  });
});

describe('codex driver - item mapping', () => {
  it('unwraps the login shell codex wraps commands in', () => {
    expect(unwrapShell('/bin/zsh -lc ls')).toBe('ls');
    expect(unwrapShell("/bin/zsh -lc 'mkdir -p a && echo made'")).toBe('mkdir -p a && echo made');
    expect(unwrapShell(`/bin/bash -lc "sed -n '1,2p' \\"a b\\""`)).toBe(`sed -n '1,2p' "a b"`);
    expect(unwrapShell(`/bin/zsh -lc 'echo '\\''hi'\\'''`)).toBe("echo 'hi'");
    expect(unwrapShell('git status')).toBe('git status');
    expect(parseLine('garbage')).toBeNull();
  });

  // Item shapes from `codex app-server generate-ts` (v2/ThreadItem.ts)
  it('maps the other item types to Claude tool names', () => {
    const events = historyEvents([
      {
        id: 'T',
        status: 'completed',
        items: [
          {
            type: 'userMessage',
            id: 'u',
            content: [
              { type: 'text', text: 'go' },
              { type: 'localImage', path: '/a.png' },
            ],
          },
          { type: 'reasoning', id: 'r', summary: ['**Plan**', 'more'], content: [] },
          { type: 'reasoning', id: 'r2', summary: [], content: [] },
          {
            type: 'fileChange',
            id: 'f',
            status: 'completed',
            changes: [
              { path: '/p/new.txt', kind: { type: 'add' }, diff: 'line\n' },
              {
                path: '/p/old.txt',
                kind: { type: 'update', move_path: null },
                diff: '@@ -1,2 +1,2 @@\n a\n-b\n+c\n@@ -9 +9 @@\n-x\n+y\n',
              },
            ],
          },
          {
            type: 'mcpToolCall',
            id: 'm',
            server: 'docs',
            tool: 'search',
            status: 'failed',
            arguments: { q: 'x' },
            result: null,
            error: { message: 'offline' },
          },
          {
            type: 'webSearch',
            id: 'w',
            query: 'a ...',
            action: { type: 'search', query: null, queries: ['a', 'b'] },
            results: [{ title: 'A', url: 'https://a' }],
          },
          {
            type: 'webSearch',
            id: 'w2',
            query: '',
            action: { type: 'open_page', url: 'https://b' },
            results: null,
          },
          { type: 'imageView', id: 'i', path: '/p/shot.png' },
          { type: 'contextCompaction', id: 'c' },
        ],
      },
      { id: 'T2', status: 'failed', error: { message: 'boom' }, items: [] },
    ]);
    const blocks = events.filter((e) => e.type === 'assistant').map((e) => e.message.content[0]);
    expect(blocks).toEqual([
      { type: 'thinking', thinking: '**Plan**\n\nmore' },
      {
        type: 'tool_use',
        id: 'f#0',
        name: 'Write',
        input: { file_path: '/p/new.txt', content: 'line\n' },
      },
      {
        type: 'tool_use',
        id: 'f#1',
        name: 'MultiEdit',
        input: {
          file_path: '/p/old.txt',
          edits: [
            { old_string: 'a\nb', new_string: 'a\nc' },
            { old_string: 'x', new_string: 'y' },
          ],
        },
      },
      { type: 'tool_use', id: 'm', name: 'mcp__docs__search', input: { q: 'x' } },
      { type: 'tool_use', id: 'w', name: 'WebSearch', input: { query: 'a | b' } },
      { type: 'tool_use', id: 'w2', name: 'WebFetch', input: { url: 'https://b' } },
      { type: 'tool_use', id: 'i', name: 'Read', input: { file_path: '/p/shot.png' } },
      { type: 'text', text: 'boom' },
    ]);
    expect(events[0]).toEqual({ type: 'devorbit_user', text: 'go\n/a.png', history: true });
    const results = events
      .filter((e) => e.type === 'user')
      .flatMap((e) => e.message.content.map((r) => [r.tool_use_id, r.content, r.is_error]));
    expect(results).toEqual([
      ['f#0', 'Applied', false],
      ['f#1', 'Applied', false],
      ['m', 'offline', true],
      ['w', 'A — https://a', false],
      ['w2', '', false],
      ['i', '', false],
    ]);
  });
});
