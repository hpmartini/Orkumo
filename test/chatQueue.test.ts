import { describe, expect, it } from 'vitest';
import { TRANSCRIPT_READERS } from '../server/services/chatTranscripts.js';
import {
  initialChatState,
  initialPrompts,
  pendingPrompts,
  reduceChat,
  type ChatState,
} from '../utils/chatEvents';

const line = (rec: object) => JSON.stringify(rec);
const q = (operation: string, content?: string) =>
  line({ type: 'queue-operation', operation, ...(content === undefined ? {} : { content }) });
const user = (content: string) => line({ type: 'user', message: { role: 'user', content } });
const queuedCmd = (prompt: string) =>
  line({
    type: 'attachment',
    attachment: { type: 'queued_command', prompt, commandMode: 'prompt' },
  });

/** Feeds each chunk through the Claude reader and the reducer, like the tail does per poll */
function run(chunks: string[][], state: ChatState = initialChatState) {
  for (const lines of chunks)
    for (const event of TRANSCRIPT_READERS.claude.historyEvents(lines))
      state = reduceChat(state, event);
  return state;
}
const users = (s: ChatState) =>
  s.messages.filter((m) => m.kind === 'user').map((m) => (m as { text: string }).text);

// Sequences as Claude Code 2.1 writes them (scripts/review/chat-queue-timing.py)
describe('prompt typed while the agent works', () => {
  it('shows at once as queued, then once as a user turn when a running turn takes it', () => {
    const s1 = run([[user('erst'), q('enqueue', 'zwei')]]);
    expect(pendingPrompts(s1)).toEqual(['zwei']);
    expect(users(s1)).toEqual(['erst']);
    const s2 = run([[q('remove', 'zwei'), queuedCmd('zwei')]], s1);
    expect(pendingPrompts(s2)).toEqual([]);
    expect(users(s2)).toEqual(['erst', 'zwei']);
  });

  it('dequeue at the turn end hands the head to the next turn', () => {
    const s = run([
      [q('enqueue', 'a'), q('enqueue', 'b')],
      [q('dequeue'), user('a')],
    ]);
    expect(pendingPrompts(s)).toEqual(['b']);
    expect(users(s)).toEqual(['a']);
  });

  it('a withdrawn prompt (remove without a record) leaves no ghost', () => {
    expect(pendingPrompts(run([[q('enqueue', 'x')], [q('remove', 'x')]]))).toEqual([]);
  });

  it('task notifications and content-less entries keep the FIFO but are not shown', () => {
    const s = run([[q('enqueue', '<task-notification>…'), q('enqueue', 'mine'), q('dequeue')]]);
    expect(pendingPrompts(s)).toEqual(['mine']);
  });

  it('a tail that starts after the enqueue ignores the unmatched remove', () => {
    const s = run([[q('enqueue', 'a'), q('remove', 'gone')]]);
    expect(pendingPrompts(s)).toEqual(['a']);
  });
});

describe('start prompts', () => {
  it('marks the first prompt and the first after compaction or /clear', () => {
    const s = run([
      [user('eins'), user('zwei')],
      [line({ type: 'system', subtype: 'compact_boundary' }), user('drei'), user('vier')],
      [user('<command-name>/clear</command-name>'), user('fünf')],
    ]);
    expect(initialPrompts(s.messages).map((m) => m.text)).toEqual(['eins', 'drei', 'fünf']);
  });

  it('omp/pi compaction records start a context too', () => {
    let s = initialChatState;
    const msg = (text: string) =>
      line({ type: 'message', message: { role: 'user', content: [{ type: 'text', text }] } });
    for (const e of TRANSCRIPT_READERS.omp.historyEvents([
      msg('a'),
      msg('b'),
      line({ type: 'compaction' }),
      msg('c'),
    ]))
      s = reduceChat(s, e);
    expect(initialPrompts(s.messages).map((m) => m.text)).toEqual(['a', 'c']);
  });
});

describe('background task end (<task-notification>)', () => {
  const note = (id: string, status: string) =>
    user(
      `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<status>${status}</status>\n<summary>Background command "x" ${status}</summary>\n</task-notification>`
    );
  it('records ended tasks, not as a user turn; a running one stays', () => {
    const s = run([[note('b1', 'completed'), note('b2', 'killed'), note('b3', 'running')]]);
    expect(s.endedTasks).toEqual(['b1', 'b2']);
    expect(users(s)).toEqual([]);
  });
});
