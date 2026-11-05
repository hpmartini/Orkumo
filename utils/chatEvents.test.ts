import { describe, it, expect } from 'vitest';
import {
  reduceChat,
  initialChatState,
  pendingPermissions,
  isSubmitKey,
  toolDiff,
  toolSummary,
  type ChatState,
} from './chatEvents';

const fold = (events: unknown[], state: ChatState = initialChatState) =>
  events.reduce<ChatState>(reduceChat, state);

const se = (event: object) => ({ type: 'stream_event', event });

describe('chatEvents - reduceChat (AC-2)', () => {
  it('reads session id and model from init', () => {
    const s = fold([{ type: 'system', subtype: 'init', session_id: 'sid', model: 'claude-opus' }]);
    expect(s.sessionId).toBe('sid');
    expect(s.model).toBe('claude-opus');
  });

  it('builds streaming text from deltas', () => {
    const s = fold([
      { type: 'devorbit_user', text: 'hi' },
      se({ type: 'message_start', message: { id: 'm1' } }),
      se({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      se({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '# He' } }),
      se({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'llo' } }),
    ]);
    expect(s.busy).toBe(true);
    expect(s.messages[0]).toEqual({ kind: 'user', key: 'u0', text: 'hi' });
    expect(s.messages[1]).toMatchObject({
      kind: 'assistant',
      key: 'm1',
      streaming: true,
      blocks: [{ type: 'text', text: '# Hello' }],
    });
  });

  it('a full assistant turn (replay without deltas) fills blocks in order', () => {
    const s = fold([
      {
        type: 'assistant',
        message: { id: 'm1', content: [{ type: 'thinking', thinking: 'hmm' }] },
      },
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Done.' }] } },
    ]);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]).toMatchObject({
      blocks: [
        { type: 'thinking', text: 'hmm' },
        { type: 'text', text: 'Done.' },
      ],
    });
  });

  it('keeps streamed thinking when the final block arrives redacted', () => {
    const s = fold([
      se({ type: 'message_start', message: { id: 'm1' } }),
      se({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      }),
      se({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'plan' },
      }),
      {
        type: 'assistant',
        message: { id: 'm1', content: [{ type: 'thinking', thinking: '', signature: 'x' }] },
      },
    ]);
    expect(s.messages[0]).toMatchObject({ blocks: [{ type: 'thinking', text: 'plan' }] });
  });

  it('pairs tool_use with its tool_result', () => {
    const s = fold([
      {
        type: 'assistant',
        message: {
          id: 'm1',
          content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'a.txt' }] },
          ],
        },
      },
    ]);
    expect(s.messages[0]).toMatchObject({
      blocks: [
        {
          type: 'tool',
          id: 't1',
          name: 'Bash',
          input: { command: 'ls' },
          result: 'a.txt',
          isError: false,
        },
      ],
    });
  });

  it('ignores subagent messages (parent_tool_use_id)', () => {
    const s = fold([
      {
        type: 'assistant',
        parent_tool_use_id: 't1',
        message: { id: 'sub', content: [{ type: 'text', text: 'x' }] },
      },
    ]);
    expect(s.messages).toEqual([]);
  });

  it('shows a permission request and records the answer', () => {
    const request = {
      type: 'control_request',
      request_id: 'r1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Write',
        display_name: 'Write',
        input: { file_path: '/p/a.txt' },
        description: 'Create a.txt',
        permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits' }],
      },
    };
    const asked = fold([request, request]);
    expect(pendingPermissions(asked)).toHaveLength(1);
    expect(pendingPermissions(asked)[0]).toMatchObject({
      requestId: 'r1',
      toolName: 'Write',
      canAlways: true,
      decision: null,
    });
    const answered = reduceChat(asked, {
      type: 'devorbit_permission',
      request_id: 'r1',
      decision: 'deny',
    });
    expect(pendingPermissions(answered)).toHaveLength(0);
    expect(answered.messages[0]).toMatchObject({ decision: 'deny' });
  });

  it('ends a turn on result and marks errors', () => {
    const s = fold([
      { type: 'devorbit_user', text: 'go' },
      se({ type: 'message_start', message: { id: 'm1' } }),
      { type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 1200 },
    ]);
    expect(s.busy).toBe(false);
    expect(s.messages[1]).toMatchObject({ streaming: false });
    expect(s.messages[2]).toMatchObject({
      kind: 'result',
      ok: false,
      subtype: 'error_during_execution',
      durationMs: 1200,
    });
  });

  it('reports process exit with stderr', () => {
    const s = reduceChat(initialChatState, { type: 'devorbit_exit', code: 1, stderr: 'boom' });
    expect(s.ended).toBe(true);
    expect(s.messages[0]).toMatchObject({
      kind: 'notice',
      tone: 'error',
      text: 'Session ended (code 1): boom',
    });
  });

  it('leaves the state untouched for malformed or unknown events', () => {
    for (const bad of [
      null,
      'x',
      42,
      {},
      { type: 7 },
      { type: 'assistant' },
      { type: 'user', message: 'x' },
      { type: 'rate_limit_event' },
    ]) {
      expect(reduceChat(initialChatState, bad)).toBe(initialChatState);
    }
  });
});

describe('chatEvents - isSubmitKey (AC-8)', () => {
  const key = (
    o: Partial<{ shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; isComposing: boolean }> = {}
  ) => ({
    key: 'Enter',
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    ...o,
  });

  it('enter mode: Enter sends, Shift+Enter breaks the line', () => {
    expect(isSubmitKey(key(), 'enter')).toBe(true);
    expect(isSubmitKey(key({ shiftKey: true }), 'enter')).toBe(false);
  });

  it('mod+enter mode: Cmd/Ctrl+Enter sends, Enter breaks the line', () => {
    expect(isSubmitKey(key(), 'mod+enter')).toBe(false);
    expect(isSubmitKey(key({ metaKey: true }), 'mod+enter')).toBe(true);
    expect(isSubmitKey(key({ ctrlKey: true }), 'mod+enter')).toBe(true);
  });

  it('never sends during IME composition or on other keys', () => {
    expect(isSubmitKey(key({ isComposing: true }), 'enter')).toBe(false);
    expect(isSubmitKey({ ...key(), key: 'a' }, 'enter')).toBe(false);
  });
});

describe('chatEvents - tool helpers', () => {
  it('renders Edit and Write as diff lines', () => {
    expect(toolDiff('Edit', { old_string: 'a', new_string: 'b\nc' })).toEqual([
      { sign: '-', text: 'a' },
      { sign: '+', text: 'b' },
      { sign: '+', text: 'c' },
    ]);
    expect(toolDiff('Write', { content: 'x' })).toEqual([{ sign: '+', text: 'x' }]);
    expect(toolDiff('Bash', { command: 'ls' })).toBeNull();
  });

  it('summarizes the main argument', () => {
    expect(toolSummary({ file_path: '/a/b.ts' })).toBe('/a/b.ts');
    expect(toolSummary({ command: 'x'.repeat(200) })).toHaveLength(118);
  });
});
