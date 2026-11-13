import { describe, it, expect } from 'vitest';
import {
  reduceChat,
  initialChatState,
  isSubmitKey,
  toolDiff,
  toolSummary,
  type ChatState,
} from './chatEvents';

const fold = (events: unknown[], state: ChatState = initialChatState) =>
  events.reduce<ChatState>(reduceChat, state);

describe('chatEvents - reduceChat (AC-2)', () => {
  it('reads session id and model from init', () => {
    const s = fold([{ type: 'system', subtype: 'init', session_id: 'sid', model: 'claude-opus' }]);
    expect(s.sessionId).toBe('sid');
    expect(s.model).toBe('claude-opus');
  });

  it('adds transcript user text as a user message', () => {
    const s = fold([{ type: 'devorbit_user', text: 'hi', history: true }]);
    expect(s.messages[0]).toEqual({ kind: 'user', key: 'u0', text: 'hi' });
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

  it('ends a turn on result and marks errors', () => {
    const s = fold([
      { type: 'devorbit_user', text: 'go' },
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'x' }] } },
      { type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 1200 },
    ]);
    expect(s.messages[1]).toMatchObject({ streaming: false });
    expect(s.messages[2]).toMatchObject({
      kind: 'result',
      ok: false,
      subtype: 'error_during_execution',
      durationMs: 1200,
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
