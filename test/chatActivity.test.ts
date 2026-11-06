import { describe, expect, it } from 'vitest';
import { initialChatState, reduceChat, type ChatState } from '../utils/chatEvents';
import { chatPlan, chatShells, chatSubagents, turnSteps } from '../utils/chatActivity';

const tool = (id: string, name: string, input: Record<string, unknown>) => ({
  type: 'assistant',
  message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name, input }] },
});
const result = (id: string, content: string, parent: string | null = null) => ({
  type: 'user',
  parent_tool_use_id: parent,
  message: { content: [{ type: 'tool_result', tool_use_id: id, content }] },
});
const fold = (events: unknown[]): ChatState =>
  events.reduce<ChatState>(reduceChat, initialChatState);

describe('chatPlan', () => {
  it('follows TaskCreate / TaskUpdate', () => {
    const s = fold([
      tool('t1', 'TaskCreate', { subject: 'Write' }),
      result('t1', 'Task #1 created successfully: Write'),
      tool('t2', 'TaskCreate', { subject: 'Test' }),
      result('t2', 'Task #2 created successfully: Test'),
      tool('t3', 'TaskUpdate', { taskId: '1', status: 'completed' }),
      tool('t4', 'TaskUpdate', { taskId: '2', status: 'in_progress' }),
    ]);
    expect(chatPlan(s.messages)).toEqual([
      { id: '1', subject: 'Write', status: 'completed' },
      { id: '2', subject: 'Test', status: 'in_progress' },
    ]);
  });
  it('takes the latest TodoWrite list', () => {
    const s = fold([tool('a', 'TodoWrite', { todos: [{ content: 'x', status: 'completed' }] })]);
    expect(chatPlan(s.messages)).toEqual([{ id: '1', subject: 'x', status: 'completed' }]);
  });
});

describe('shells, sub-agents, steps', () => {
  it('lists background shells by the id the CLI reports', () => {
    const s = fold([
      tool('b', 'Bash', { command: 'npm run dev', run_in_background: true }),
      result(
        'b',
        'Command running in background with ID: b4l5tktxs. Output is being written to: /t/tasks/b4l5tktxs.output'
      ),
      tool('c', 'Bash', { command: 'ls' }),
    ]);
    expect(chatShells(s.messages)).toEqual([
      { id: 'b4l5tktxs', command: 'npm run dev', description: '' },
    ]);
  });
  it('collects sub-agent blocks under their Agent call', () => {
    const s = fold([
      tool('ag', 'Agent', { subagent_type: 'Explore', description: 'find it' }),
      {
        type: 'assistant',
        parent_tool_use_id: 'ag',
        message: { id: 'sub1', content: [{ type: 'tool_use', id: 'g1', name: 'Grep', input: {} }] },
      },
      result('g1', 'found', 'ag'),
    ]);
    expect(chatSubagents(s.messages)).toEqual([
      { toolId: 'ag', type: 'Explore', description: 'find it', done: false, isError: false },
    ]);
    expect(s.sub.ag).toEqual([
      { type: 'tool', id: 'g1', name: 'Grep', input: {}, result: 'found', isError: false },
    ]);
    // Sub-agent chatter never lands in the main transcript
    expect(s.messages).toHaveLength(1);
  });
  it('turn steps start after the last user message', () => {
    const s = fold([
      tool('x', 'Read', {}),
      { type: 'devorbit_user', text: 'next' },
      tool('y', 'Edit', {}),
    ]);
    expect(turnSteps(s.messages).map((b) => (b.type === 'tool' ? b.id : ''))).toEqual(['y']);
  });
});

describe('reduceChat extras', () => {
  it('shows recaps without the /config hint', () => {
    const s = fold([
      { type: 'system', subtype: 'away_summary', content: 'Did X. (disable recaps in /config)' },
    ]);
    expect(s.messages).toEqual([{ kind: 'recap', key: 'c0', text: 'Did X.' }]);
  });
  it('stores commands and agents', () => {
    const s = fold([
      { type: 'devorbit_commands', commands: [{ name: 'compact', description: '' }], agents: [] },
      { type: 'devorbit_commands', commands: [{ name: 'clear', description: '' }] },
    ]);
    expect(s.commands.map((c) => c.name)).toEqual(['clear']);
    expect(s.agents).toEqual([]);
  });
});
