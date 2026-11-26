import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// "working" means a turn runs: the CLI's busy/active also stays on while the session's own
// background tasks (shells, monitors, subagents) run after its turn ended (retro 2026-11-25)
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-turn-'));
process.env.CLAUDE_CONFIG_DIR = home;
process.env.CLAUDE_CLI_PATH = '/bin/sh'; // any executable: execFile is mocked

let entries = [];
vi.mock('node-pty', () => ({ spawn: vi.fn() }));
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  const execFile = (cmd, args, opts, cb) => {
    if (args[0] === 'agents') cb(null, JSON.stringify(entries), '');
    else cb(null, '', '');
  };
  return { ...actual, default: { ...actual, execFile }, execFile };
});

const { claudeTurnSignal, listSessions } = await import('../server/services/agentService.js');

// Record shapes as Claude Code 2.1.322 writes them (anonymised)
let n = 0;
const base = () => ({
  uuid: `u${++n}`,
  sessionId: 'sess',
  isSidechain: false,
  timestamp: new Date(Date.UTC(2026, 10, 26, 1, 0, n)).toISOString(),
});
const prompt = (content, extra = {}) => ({
  ...base(),
  type: 'user',
  message: { role: 'user', content },
  ...extra,
});
const toolResult = () => prompt([{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }]);
const assistant = (content, stop_reason) => ({
  ...base(),
  type: 'assistant',
  message: { id: `msg${n}`, role: 'assistant', content, stop_reason },
});
const system = (subtype, extra = {}) => ({ ...base(), type: 'system', subtype, ...extra });
const queue = (operation, content) => ({
  type: 'queue-operation',
  operation,
  timestamp: base().timestamp,
  sessionId: 'sess',
  ...(content ? { content } : {}),
});
const monitorEvent = '<task-notification> <task-id>b1</task-id> <summary>Monitor event</summary>';
const handBack = prompt(
  'Another Claude session sent a message: <agent-message from="a1"> [Subagent hand-back] report',
  { isMeta: true, origin: { kind: 'peer', from: 'a1', handback: true } }
);
const taskNotification = prompt(
  '<task-notification> <task-id>a1</task-id> <status>completed</status> </task-notification>',
  { origin: { kind: 'task-notification', producer: 'session-task' } }
);

/** A turn that ran a tool and ended, then only monitor events and bookkeeping */
const endedTurn = () => [
  queue('dequeue'),
  prompt('check the build'),
  assistant([{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }], 'tool_use'),
  toolResult(),
  assistant([{ type: 'thinking', thinking: '' }], 'end_turn'),
  assistant([{ type: 'text', text: 'Done.' }], 'end_turn'),
  { ...base(), type: 'attachment', attachment: { type: 'hook_success' } },
  system('stop_hook_summary', { hookCount: 4, level: 'suggestion' }),
  system('turn_duration', { durationMs: 166205 }),
  { type: 'data-flow-records', v: 1, sessionId: 'sess', records: [] },
  queue('enqueue', monitorEvent),
  queue('remove', monitorEvent),
  system('away_summary', { content: 'recap' }),
  { type: 'last-prompt', lastPrompt: 'check the build', sessionId: 'sess' },
];

/** The newest record that says something about the turn, scanning back like readTurnState */
const tail = (records) => {
  for (let i = records.length - 1; i >= 0; i--) {
    const signal = claudeTurnSignal(records[i]);
    if (signal) return signal;
  }
  return null;
};

describe('claudeTurnSignal (Claude Code transcript records)', () => {
  it('a turn ended by its stop hooks and duration stays ended through monitor events', () => {
    expect(tail(endedTurn())).toBe('idle');
  });

  it('a short turn without turn_duration ends with its stop hooks', () => {
    const records = endedTurn().filter((r) => r.subtype !== 'turn_duration');
    expect(tail(records)).toBe('idle');
  });

  it('a hand-back, a task notification and a skill start a turn, not only a user prompt', () => {
    expect(tail([...endedTurn(), queue('dequeue'), handBack])).toBe('working');
    expect(tail([...endedTurn(), queue('dequeue'), taskNotification])).toBe('working');
    expect(
      tail([
        ...endedTurn(),
        prompt('<command-message>retro</command-message>\n<command-name>/retro</command-name>'),
      ])
    ).toBe('working');
    expect(
      tail([...endedTurn(), prompt('[from agent omp-1 "playmaker" via orkumo send] hi')])
    ).toBe('working');
  });

  it('a tool call or its result keeps the turn open', () => {
    expect(tail(endedTurn().slice(0, 3))).toBe('working');
    expect(tail(endedTurn().slice(0, 4))).toBe('working');
  });

  it('built-in commands and their output run outside a turn; an interrupt ends it', () => {
    const builtIn = [
      prompt('<command-name>/model</command-name>\n<command-args></command-args>'),
      prompt('<local-command-stdout>Set model to opus</local-command-stdout>'),
    ];
    expect(tail([...endedTurn(), ...builtIn])).toBe('idle');
    expect(
      tail([
        ...endedTurn().slice(0, 3),
        prompt([{ type: 'text', text: '[Request interrupted by user for tool use]' }]),
      ])
    ).toBe('idle');
    expect(claudeTurnSignal({ ...prompt('summary'), isCompactSummary: true })).toBeNull();
    expect(claudeTurnSignal({ ...assistant([], 'tool_use'), isSidechain: true })).toBeNull();
  });
});

describe('listSessions - working only while a turn runs', () => {
  const write = (file, records) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return file;
  };
  const job = (id, state, transcript) => {
    const linkScanPath = write(path.join(home, 'projects', '-w', `${id}.jsonl`), transcript);
    fs.mkdirSync(path.join(home, 'jobs', id), { recursive: true });
    fs.writeFileSync(
      path.join(home, 'jobs', id, 'state.json'),
      JSON.stringify({ ...state, linkScanPath })
    );
  };
  // CLI row and job file as seen live for a background orchestrator after its turn ended
  const busy = { kind: 'background', state: 'working', status: 'busy', pid: 4242, cwd: '/w' };
  const active = {
    state: 'working',
    tempo: 'active',
    inFlight: { tasks: 2, queued: 0, kinds: ['local_agent'], drainableMonitors: 0 },
  };

  beforeAll(() => {
    job('ended000', active, endedTurn());
    job('running0', active, [...endedTurn(), queue('dequeue'), handBack]);
    job('asking00', { ...active, state: 'blocked' }, endedTurn());
    job('quiet000', { ...active, inFlight: { tasks: 0, queued: 0 } }, endedTurn());
    write(path.join(home, 'projects', '-w', 'term-session.jsonl'), endedTurn());
    entries = [
      { ...busy, id: 'ended000' },
      { ...busy, id: 'running0' },
      { ...busy, id: 'asking00' },
      { ...busy, id: 'quiet000' },
      { kind: 'interactive', status: 'busy', pid: 77, cwd: '/w', sessionId: 'term-session' },
    ];
  });
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

  it('a session without a running turn is never working', async () => {
    const rows = await listSessions({ all: true });
    const state = Object.fromEntries(rows.map((r) => [r.id, r.displayState]));
    expect(state).toMatchObject({
      ended000: 'waiting',
      running0: 'working',
      asking00: 'needs-input',
      quiet000: 'idle',
    });
    expect(rows.find((r) => r.kind === 'interactive')?.displayState).toBe('interactive');
  });
});
