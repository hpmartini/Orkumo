import { describe, it, expect } from 'vitest';
import {
  groupAnswers,
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

describe('chatEvents - answer cards', () => {
  const assistant = (id: string, content: unknown[], model?: string) => ({
    type: 'assistant',
    history: true,
    message: { id, content, ...(model ? { model } : {}) },
  });
  const tool = (id: string) => ({ type: 'tool_use', id, name: 'Bash', input: { command: 'ls' } });

  it('a turn with several assistant messages is one answer, closed by its result', () => {
    const s = fold([
      { type: 'devorbit_user', text: 'go', ts: 1_000 },
      assistant('a1', [{ type: 'thinking', thinking: 'plan' }, tool('t1')]),
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
      },
      assistant('a2', [tool('t2')], 'anthropic/claude-opus-5-5'),
      assistant('a3', [{ type: 'text', text: 'Done.' }]),
      { type: 'result', subtype: 'success', is_error: false, ts: 13_500 },
      { type: 'devorbit_user', text: 'next' },
      assistant('b1', [{ type: 'text', text: 'Sure' }]),
    ]);
    const items = groupAnswers(s.messages);
    expect(items.map((i) => i.kind)).toEqual(['user', 'answer', 'user', 'answer']);
    const first = items[1];
    if (first.kind !== 'answer') throw new Error('not an answer');
    expect(first.key).toBe('a1');
    expect(first.parts.map((p) => p.key)).toEqual(['a1', 'a2', 'a3']);
    expect(first.parts[1].model).toBe('anthropic/claude-opus-5-5');
    // omp records no duration: prompt time to result time
    expect(first.result).toMatchObject({ ok: true, durationMs: 12_500 });
    const second = items[3];
    expect(second.kind === 'answer' && second.result).toBe(null);
  });

  it('a recap or notice splits answers; a result without an answer stays on its own', () => {
    const s = fold([
      { type: 'devorbit_user', text: 'go' },
      { type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 400 },
      assistant('a1', [{ type: 'text', text: 'one' }]),
      { type: 'system', subtype: 'away_summary', content: 'recap' },
      assistant('a2', [{ type: 'text', text: 'two' }]),
    ]);
    expect(groupAnswers(s.messages).map((i) => i.kind)).toEqual([
      'user',
      'result',
      'answer',
      'recap',
      'answer',
    ]);
    expect(s.messages[1]).toMatchObject({ kind: 'result', ok: false, durationMs: 400 });
  });

  it('keeps the message objects, so unchanged cards keep their memo', () => {
    const s = fold([assistant('a1', [{ type: 'text', text: 'x' }])]);
    const [answer] = groupAnswers(s.messages);
    expect(answer.kind === 'answer' && answer.parts[0]).toBe(s.messages[0]);
  });
});
