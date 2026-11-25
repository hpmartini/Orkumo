import { describe, expect, it } from 'vitest';
import { TRANSCRIPT_READERS } from '../server/services/chatTranscripts.js';
import {
  initialChatState,
  initialPrompts,
  pendingPrompts,
  reduceChat,
  type ChatState,
} from '@hpmartini/agents-ui/utils/chatEvents';

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

  // 13c54a91: Claude logged an enqueue without content and its remove with the text; the empty
  // placeholder stayed, and each later content-less dequeue popped it instead of the new prompt
  it('a content-less enqueue is matched by its remove with text', () => {
    const s = run([
      [q('enqueue'), q('remove', 'mit Bild'), queuedCmd('mit Bild')],
      [q('enqueue', 'neu'), q('dequeue'), user('neu')],
    ]);
    expect(pendingPrompts(s)).toEqual([]);
    expect(users(s)).toEqual(['mit Bild', 'neu']);
  });

  it('a queued prompt goes away once the transcript holds it as a user turn', () => {
    // stale entry at the head: the dequeue pops it, the prompt itself stays in the mirror
    const s1 = run([[q('enqueue'), q('enqueue', 'frage'), q('dequeue')]]);
    expect(pendingPrompts(s1)).toEqual(['frage']);
    const s2 = run([[user('frage')]], s1);
    expect(pendingPrompts(s2)).toEqual([]);
    expect(users(s2)).toEqual(['frage']);
  });

  it('popAll (queued prompts pulled back into the input) empties the queue', () => {
    expect(
      pendingPrompts(run([[q('enqueue', 'a'), q('enqueue', 'b'), q('popAll', 'a\nb')]]))
    ).toEqual([]);
  });

  it('keeps transcript order: answers between prompts stay in place, pending last', () => {
    const answer = (text: string) =>
      line({ type: 'assistant', message: { id: text, content: [{ type: 'text', text }] } });
    const s = run([
      [user('eins'), q('enqueue', 'zwei'), answer('A1')],
      [q('dequeue'), user('zwei'), answer('A2'), q('enqueue', 'drei')],
    ]);
    expect(s.messages.map((m) => (m.kind === 'user' ? m.text : m.kind))).toEqual([
      'eins',
      'assistant',
      'zwei',
      'assistant',
    ]);
    expect(pendingPrompts(s)).toEqual(['drei']);
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

describe('wrappers Claude Code puts around prompts', () => {
  it('shows pasted text without its <pasted_content> tags, queued or not', () => {
    const pasted = '<pasted_content id="5fb8">\n- erster Punkt\n</pasted_content id="5fb8">';
    const s1 = run([[q('enqueue', pasted)]]);
    expect(pendingPrompts(s1)).toEqual(['- erster Punkt\n']);
    const s2 = run([[q('remove', pasted), queuedCmd(pasted), user(pasted)]], s1);
    expect(pendingPrompts(s2)).toEqual([]);
    expect(users(s2)).toEqual(['- erster Punkt\n', '- erster Punkt\n']);
  });

  it('leaves out hand-backs of subagents and other sessions', () => {
    const msg = '<agent-message from="a1">\n[Subagent hand-back] report\n</agent-message>';
    const peer = line({
      type: 'attachment',
      attachment: {
        type: 'queued_command',
        prompt: msg,
        commandMode: 'prompt',
        origin: { kind: 'peer', from: 'a1' },
      },
    });
    const s = run([[q('enqueue', msg), q('remove', msg), peer]]);
    expect(pendingPrompts(s)).toEqual([]);
    expect(users(s)).toEqual([]);
  });
});

// omp logs a prompt only once the agent takes it (typed mid-turn: at the next tool boundary)
describe('prompt sent from the UI view to a harness without a queue log', () => {
  it('shows at once, then gives way to the logged user turn (by count, not text)', () => {
    let s = reduceChat(initialChatState, { type: 'devorbit_sent', text: 'eins' });
    s = reduceChat(s, { type: 'devorbit_sent', text: 'zwei' });
    expect(pendingPrompts(s)).toEqual(['eins', 'zwei']);
    s = reduceChat(s, { type: 'devorbit_user', text: 'eins\n[Image: /tmp/a.png]' });
    expect(pendingPrompts(s)).toEqual(['zwei']);
    s = reduceChat(s, { type: 'devorbit_user', text: 'zwei' });
    expect(pendingPrompts(s)).toEqual([]);
    expect(users(s)).toEqual(['eins\n[Image: /tmp/a.png]', 'zwei']);
  });
  it('drops leftovers (withdrawn in the TUI) on clear', () => {
    const s = reduceChat(reduceChat(initialChatState, { type: 'devorbit_sent', text: 'weg' }), {
      type: 'devorbit_sent_clear',
    });
    expect(pendingPrompts(s)).toEqual([]);
  });
});

describe('background task end (<task-notification>)', () => {
  const note = (id: string, status: string) =>
    user(
      `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<status>${status}</status>\n<summary>Background command "x" ${status}</summary>\n</task-notification>`
    );
  it('records ended tasks, not as a user turn; a running one stays', () => {
    const s = run([[note('b1', 'completed'), note('b2', 'killed'), note('b3', 'running')]]);
    expect(s.endedTasks).toEqual(['b1', 'toolu_1', 'b2']);
    expect(users(s)).toEqual([]);
  });

  // 13c54a91: notifications absorbed mid-turn never become a user record, only a queue entry
  // and/or a queued_command attachment; async agents end the same way, matched by tool-use id
  it('reads ends from queue entries and queued_command attachments, with the tool-use id', () => {
    const text = (id: string, tool: string) =>
      `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>${tool}</tool-use-id>\n<status>completed</status>\n</task-notification>`;
    const events = TRANSCRIPT_READERS.claude.historyEvents([
      q('enqueue', text('b4', 'toolu_4')),
      q('remove', text('b4', 'toolu_4')),
      queuedCmd(text('a5', 'toolu_5')),
    ]);
    expect(events.filter((e) => e.type === 'devorbit_task_ended')).toEqual([
      { type: 'devorbit_task_ended', id: 'b4', toolUseId: 'toolu_4' },
      { type: 'devorbit_task_ended', id: 'b4', toolUseId: 'toolu_4' },
      { type: 'devorbit_task_ended', id: 'a5', toolUseId: 'toolu_5' },
    ]);
    expect(pendingPrompts(run([[q('enqueue', text('b4', 'toolu_4'))]]))).toEqual([]);
  });
});

describe('model and effort in use', () => {
  it('follows the latest main-thread answer; synthetic error messages keep the model', () => {
    const a = (id: string, model: string, effort?: string) =>
      line({
        type: 'assistant',
        ...(effort ? { effort } : {}),
        message: { id, model, content: [{ type: 'text', text: 'x' }] },
      });
    const s = run([
      [
        a('m1', 'claude-opus-5-5', 'medium'),
        a('m2', 'claude-fable-5-2', 'high'),
        a('m3', '<synthetic>'),
      ],
    ]);
    expect([s.model, s.effort]).toEqual(['claude-fable-5-2', 'high']);
  });
});
