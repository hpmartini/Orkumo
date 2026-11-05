import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('node-pty', () => ({ spawn: vi.fn() }));

const {
  sanitizeChatOptions,
  buildChatArgs,
  parseLine,
  startChat,
  sendMessage,
  answerPermission,
  interruptChat,
  stopChat,
  watchChat,
  listChats,
} = await import('../server/services/chatService.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-test-'));
const project = path.join(root, 'project');
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-outside-'));
fs.mkdirSync(project);
const ctx = { allowedDirs: [root], unsafeAllowed: false };

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

const status = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.status;
  }
  return 'no error';
};

describe('chatService - start validation (AC-3)', () => {
  it('accepts a project directory and returns the real path', () => {
    expect(sanitizeChatOptions({ cwd: project, permissionMode: 'manual' }, ctx)).toEqual({
      cwd: fs.realpathSync(project),
      permissionMode: 'manual',
    });
  });

  it.each([
    ['cwd outside the project folders', { cwd: outside }],
    ['path traversal', { cwd: `${project}/../../..` }],
    ['shell metacharacters in cwd', { cwd: `${project}; rm -rf ~` }],
    ['missing cwd', {}],
    ['NUL byte in cwd', { cwd: `${project}\0` }],
    ['shell metacharacters in model', { cwd: project, model: 'opus; rm -rf ~' }],
    ['argument injection via model', { cwd: project, model: '--dangerously-skip-permissions' }],
    ['unknown permission mode', { cwd: project, permissionMode: 'yolo' }],
    ['invalid session id', { cwd: project, resume: '../../etc/passwd' }],
    ['session id with flag', { cwd: project, resume: '--continue' }],
    [
      'resume and continue together',
      {
        cwd: project,
        resume: '0e0b7a4e-8d9c-4f3a-9b1e-2f6c1d3a4b5c',
        continue: true,
      },
    ],
    ['newline in name', { cwd: project, name: 'a\nb' }],
  ])('rejects %s with 400 and spawns nothing', (_label, opts) => {
    const { spawn } = fakeSpawn();
    expect(status(() => startChat(opts, { ...ctx, spawn, bin: '/bin/claude' }))).toBe(400);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses skip permissions unless the server allows unsafe flags', () => {
    const { spawn } = fakeSpawn();
    expect(
      status(() => startChat({ cwd: project, skipPermissions: true }, { ...ctx, spawn, bin: 'x' }))
    ).toBe(403);
    expect(spawn).not.toHaveBeenCalled();
    expect(
      sanitizeChatOptions({ cwd: project, skipPermissions: true }, { ...ctx, unsafeAllowed: true })
        .skipPermissions
    ).toBe(true);
  });
});

describe('chatService - buildChatArgs', () => {
  it('runs the CLI in stream-json print mode with stdio permission prompts', () => {
    expect(buildChatArgs({ cwd: '/p' })).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-prompt-tool',
      'stdio',
    ]);
  });

  it('maps the settings mode `default` to the CLI mode `manual`', () => {
    expect(buildChatArgs({ cwd: '/p', permissionMode: 'default' }).slice(9)).toEqual([
      '--permission-mode',
      'manual',
    ]);
  });

  it('maps options to flags as separate arguments', () => {
    const args = buildChatArgs({
      cwd: '/p',
      model: 'opus',
      permissionMode: 'manual',
      resume: '0e0b7a4e-8d9c-4f3a-9b1e-2f6c1d3a4b5c',
      name: 'my chat',
    });
    expect(args.slice(9)).toEqual([
      '--model',
      'opus',
      '--permission-mode',
      'manual',
      '--resume',
      '0e0b7a4e-8d9c-4f3a-9b1e-2f6c1d3a4b5c',
      '--name',
      'my chat',
    ]);
  });
});

describe('chatService - parseLine', () => {
  it('parses a JSON line and skips garbage without throwing', () => {
    expect(parseLine('{"type":"result"}')).toEqual({ type: 'result' });
    expect(parseLine('{"type":"res')).toBeNull();
    expect(parseLine('')).toBeNull();
    expect(parseLine('[1,2]')).toBeNull();
    expect(parseLine('{"no":"type"}')).toBeNull();
  });
});

describe('chatService - session lifecycle', () => {
  let calls;
  let spawn;
  beforeEach(() => {
    ({ spawn, calls } = fakeSpawn());
  });
  const emit = (proc, obj) => proc.stdout.emit('data', `${JSON.stringify(obj)}\n`);

  it('spawns without a shell, initializes, relays permission answers and interrupt', () => {
    const chat = startChat(
      { cwd: project, permissionMode: 'manual' },
      { ...ctx, spawn, bin: '/bin/claude' }
    );
    const { proc, opts, args } = calls[0];
    expect(opts.shell).toBeUndefined();
    expect(opts.cwd).toBe(fs.realpathSync(project));
    expect(args).toContain('manual');
    expect(proc.written[0].request.subtype).toBe('initialize');

    const seen = [];
    const unwatch = watchChat(chat.id, (e) => seen.push(e.type));
    emit(proc, { type: 'system', subtype: 'init', session_id: 'sid-1', model: 'claude-opus' });
    sendMessage(chat.id, 'write a file');
    expect(proc.written[1]).toEqual({
      type: 'user',
      message: { role: 'user', content: 'write a file' },
    });

    // A line split across two chunks is reassembled
    const req = JSON.stringify({
      type: 'control_request',
      request_id: 'r1',
      request: { subtype: 'can_use_tool', tool_name: 'Write', input: { file_path: 'a' } },
    });
    proc.stdout.emit('data', req.slice(0, 20));
    proc.stdout.emit('data', `${req.slice(20)}\nnot json\n`);
    expect(listChats().find((c) => c.id === chat.id)).toMatchObject({
      sessionId: 'sid-1',
      pendingPermissions: 1,
      busy: true,
    });

    answerPermission(chat.id, 'r1', 'deny');
    expect(proc.written[2].response).toMatchObject({
      request_id: 'r1',
      response: { behavior: 'deny' },
    });
    expect(status(() => answerPermission(chat.id, 'r1', 'allow'))).toBe(400);

    interruptChat(chat.id);
    expect(proc.written[3].request.subtype).toBe('interrupt');

    emit(proc, { type: 'result', subtype: 'error_during_execution', is_error: true });
    expect(seen).toEqual([
      'system',
      'devorbit_user',
      'control_request',
      'devorbit_permission',
      'result',
    ]);
    unwatch();
    expect(stopChat(chat.id)).toBe(true);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(listChats().some((c) => c.id === chat.id)).toBe(false);
  });

  it('allow passes the original input back; reconnect replays the history', () => {
    const chat = startChat({ cwd: project }, { ...ctx, spawn, bin: '/bin/claude' });
    const { proc } = calls[0];
    emit(proc, {
      type: 'control_request',
      request_id: 'r2',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Write',
        input: { file_path: 'b', content: 'x' },
        permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
      },
    });
    answerPermission(chat.id, 'r2', 'always');
    expect(proc.written[1].response.response).toEqual({
      behavior: 'allow',
      updatedInput: { file_path: 'b', content: 'x' },
      updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
    });
    emit(proc, { type: 'stream_event', event: { type: 'content_block_delta' } });
    const replay = [];
    watchChat(chat.id, (e) => replay.push(e.type))();
    // stream deltas are live-only
    expect(replay).toEqual(['control_request', 'devorbit_permission']);
    stopChat(chat.id);
  });

  it('stops a chat nobody watches after the orphan timeout', () => {
    vi.useFakeTimers();
    try {
      const chat = startChat({ cwd: project }, { ...ctx, spawn, bin: '/bin/claude' });
      const unwatch = watchChat(chat.id, () => {});
      vi.advanceTimersByTime(11 * 60 * 1000);
      expect(listChats().some((c) => c.id === chat.id)).toBe(true);
      unwatch();
      vi.advanceTimersByTime(11 * 60 * 1000);
      expect(listChats().some((c) => c.id === chat.id)).toBe(false);
      expect(calls[0].proc.kill).toHaveBeenCalledWith('SIGTERM');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a process exit and refuses further input', () => {
    const chat = startChat({ cwd: project }, { ...ctx, spawn, bin: '/bin/claude' });
    calls[0].proc.emit('exit', 1);
    expect(status(() => sendMessage(chat.id, 'hi'))).toBe(400);
    stopChat(chat.id);
  });
});
