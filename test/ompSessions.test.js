import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  parseSessionHead,
  parseOmpPids,
  parseLsof,
  runningSessionFiles,
  currentHolders,
  turnSignal,
  readTurnState,
  listOmpSessions,
  findOmpSessionFile,
  readOmpTranscriptTail,
  stopOmpSession,
  removeOmpSession,
} from '../server/services/ompSessions.js';

// Fixtures in omp's own session format (title line, session header, messages)
const RUNNING = '01a1c095-7edd-72eb-9c97-4afdcd01f56e';
const ELSEWHERE = '01a1c018-5c63-776e-b0c3-b78121b577b3';
const FINISHED = '01a1a647-401a-7036-94eb-69d3a3ca1b37';
const OLD = '01a19999-0000-7000-8000-000000000000';
const DAY = 24 * 60 * 60 * 1000;

const line = (record) => JSON.stringify(record);
const sessionFile = (id, cwd, { title = '', prompt = 'hallo', answer = 'Hallo zurück' } = {}) =>
  [
    line({ type: 'title', v: 1, title, pad: '   ' }),
    line({ type: 'session', version: 3, id, timestamp: '2026-11-09T13:53:05.245Z', cwd }),
    line({ type: 'model_change', id: 'a', model: 'anthropic/claude-opus-5-5' }),
    line({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: prompt }] } }),
    line({
      type: 'message',
      message: { role: 'assistant', content: [{ type: 'text', text: answer }] },
    }),
  ].join('\n') + '\n';

let dir;
const files = {};
const now = Date.parse('2026-11-09T14:00:00Z');

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-sessions-'));
  const write = (slug, id, cwd, opts, mtime) => {
    fs.mkdirSync(path.join(dir, slug), { recursive: true });
    const file = path.join(dir, slug, `2026-11-09T13-53-05-245Z_${id}.jsonl`);
    fs.writeFileSync(file, sessionFile(id, cwd, opts));
    fs.utimesSync(file, mtime / 1000, mtime / 1000);
    files[id] = file;
  };
  write('-PROJECTS-app', RUNNING, '/w/app', { prompt: 'Antworte nur mit: hallo' }, now - 2000);
  write('-PROJECTS-app', ELSEWHERE, '/w/app', { title: '\u{F04C2} UPDATE: Build' }, now - 60_000);
  write('-PROJECTS-lib', FINISHED, '/w/lib', { title: 'Fix resume' }, now - 2 * DAY);
  write('-PROJECTS-lib', OLD, '/w/lib', { title: 'Ancient' }, now - 30 * DAY);
  // a session's artifact folder is not a session
  fs.mkdirSync(path.join(dir, '-PROJECTS-app', `2026-11-09T13-53-05-245Z_${RUNNING}`));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('parseSessionHead', () => {
  it('takes the title, without nerd-font icons, else the first prompt', () => {
    expect(
      parseSessionHead(sessionFile(ELSEWHERE, '/w', { title: '\u{F04C2} UPDATE: Build' }))
    ).toEqual({
      id: ELSEWHERE,
      cwd: '/w',
      startedAt: Date.parse('2026-11-09T13:53:05.245Z'),
      title: 'UPDATE: Build',
      prompted: true,
    });
    expect(parseSessionHead(sessionFile(RUNNING, '/w', { prompt: 'Antworte\n nur' })).title).toBe(
      'Antworte nur'
    );
    expect(parseSessionHead(line({ type: 'session', id: 'nope', cwd: '/w' }))).toBeNull();
    expect(parseSessionHead('garbage')).toBeNull();
  });
});

describe('listOmpSessions - sessions without a prompt', () => {
  it('leaves out a finished session nobody ever prompted, but not a running one', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-empty-'));
    fs.mkdirSync(path.join(root, '-w'));
    const empty = (id) => {
      const file = path.join(root, '-w', `2026-11-09T13-53-05-245Z_${id}.jsonl`);
      fs.writeFileSync(
        file,
        [
          line({ type: 'title', v: 1, title: '', pad: '   ' }),
          line({
            type: 'session',
            version: 3,
            id,
            timestamp: '2026-11-09T13:53:05.245Z',
            cwd: '/w',
          }),
          line({ type: 'model_change', id: 'a', model: 'anthropic/claude-opus-5-5' }),
        ].join('\n') + '\n'
      );
      return file;
    };
    empty(FINISHED);
    const open = empty(RUNNING);
    const rows = await listOmpSessions({
      sessionsDir: root,
      now: Date.now(),
      running: new Map([[open, 4242]]),
    });
    expect(rows.map((r) => r.sessionId)).toEqual([RUNNING]);
  });
});

describe('running omp processes', () => {
  it('keeps the interactive omp processes, not its workers or other tools', () => {
    const ps = [
      '17119 omp',
      '69373 omp -r',
      '94286 /opt/homebrew/bin/omp -- Antworte nur mit: hallo',
      '66589 /opt/homebrew/Cellar/omp/18.16.0/bin/omp __omp_worker_daemon_broker',
      '1234 /usr/bin/vim omp.txt',
      '555 compose',
    ].join('\n');
    expect(parseOmpPids(ps)).toEqual([17119, 69373, 94286]);
  });

  it('reads the open session file and the terminal of each process', () => {
    const lsof = [
      'p17119',
      'n/dev/ttys008',
      `n${dir}/-PROJECTS-app/x_${ELSEWHERE}.jsonl`,
      'p71408',
      'n/dev/ttys042',
      'n/dev/ttys042',
      'n/Users/hape/.omp/agent/agent.db',
    ].join('\n');
    expect(parseLsof(lsof, dir)).toEqual(
      new Map([
        [17119, { file: `${dir}/-PROJECTS-app/x_${ELSEWHERE}.jsonl`, tty: 'ttys008' }],
        // freshly resumed: omp opens the file only when it writes, the terminal record tells
        [71408, { file: null, tty: 'ttys042' }],
      ])
    );
  });
});

describe('running omp processes - subagents and failed scans', () => {
  it('maps an open subagent transcript to its parent session; a session file of its own wins', () => {
    const app = `${dir}/-PROJECTS-app`;
    const lsof = [
      'p100',
      'n/dev/ttys044',
      `n${app}/x_${RUNNING}/WorkingDetection.jsonl`,
      `n${app}/x_${RUNNING}/WorkingDetection/Nested.jsonl`,
      'p200',
      `n${app}/x_${ELSEWHERE}/SkillsDetection.jsonl`,
      `n${app}/x_${ELSEWHERE}.jsonl`,
      'p300',
      'n/dev/ttys050',
    ].join('\n');
    expect(parseLsof(lsof, dir)).toEqual(
      new Map([
        // the subagent's file never becomes the holder: the parent runs in this process
        [100, { file: `${app}/x_${RUNNING}.jsonl`, tty: 'ttys044' }],
        [200, { file: `${app}/x_${ELSEWHERE}.jsonl`, tty: null }],
        [300, { file: null, tty: 'ttys050' }],
      ])
    );
  });

  it('keeps the previous holders when ps or lsof fails', async () => {
    const root = path.join(os.tmpdir(), 'omp-holders-test');
    const file = path.join(root, '-w', `x_${RUNNING}.jsonl`);
    const ok = async (command) => (command === 'ps' ? '42 omp\n7 launchd\n' : `p42\nn${file}\n`);
    expect(await currentHolders(root, { exec: ok })).toEqual(new Map([[file, 42]]));
    const lsofFails = async (command) => (command === 'ps' ? '42 omp\n' : null);
    expect(await runningSessionFiles(root, { exec: lsofFails })).toBeNull();
    expect(await currentHolders(root, { exec: lsofFails })).toEqual(new Map([[file, 42]]));
    expect(await currentHolders(root, { exec: async () => null })).toEqual(new Map([[file, 42]]));
    // a scan that answers "no omp runs" is not a failure
    const none = async (command) => (command === 'ps' ? '7 launchd\n' : null);
    expect(await currentHolders(root, { exec: none })).toEqual(new Map());
  });
});

describe('omp turn state from the session tail', () => {
  const message = (role, extra = {}) => ({
    type: 'message',
    message: { role, content: [{ type: 'text', text: 'x' }], ...extra },
  });
  const custom = (customType) => ({ type: 'custom', customType, data: {} });
  const notice = (customType, attribution = 'agent') => ({
    type: 'custom_message',
    customType,
    attribution,
    content: 'x',
  });

  it('classifies the records that open or end a turn and ignores bookkeeping', () => {
    expect(turnSignal(message('assistant', { stopReason: 'toolUse' }))).toBe('working');
    expect(turnSignal(message('user'))).toBe('working');
    expect(turnSignal(message('toolResult'))).toBe('working');
    expect(turnSignal(custom('tool_execution_start'))).toBe('working');
    expect(turnSignal(notice('skill-prompt', 'user'))).toBe('working');
    expect(turnSignal(notice('async-result'))).toBe('working');
    for (const stopReason of ['stop', 'aborted', 'error', 'length']) {
      expect(turnSignal(message('assistant', { stopReason }))).toBe('idle');
    }
    expect(turnSignal(custom('session_exit'))).toBe('idle');
    expect(turnSignal(message('assistant'))).toBe('unknown');
    for (const record of [
      { type: 'title', title: 'x' },
      { type: 'title_change', title: 'x' },
      { type: 'model_usage', purpose: 'title' },
      custom('date-cwd-reminder'),
      custom('system-prompt-digest'),
      notice('eval-state-context'),
      notice('mid-run-todo-nudge'),
    ]) {
      expect(turnSignal(record)).toBeNull();
    }
  });

  let root;
  const stamp = Date.now();
  const write = (file, records, mtime) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, records.map(line).join('\n') + '\n');
    fs.utimesSync(file, mtime / 1000, mtime / 1000);
    return file;
  };
  const session = (id, records, mtime) =>
    write(
      path.join(root, '-w', `2026-11-09T13-53-05-245Z_${id}.jsonl`),
      [
        { type: 'title', v: 1, title: `t ${id.slice(0, 4)}` },
        { type: 'session', version: 3, id, timestamp: '2026-11-09T13:53:05.245Z', cwd: '/w' },
        message('user'),
        ...records,
      ],
      mtime
    );
  const ids = Array.from({ length: 7 }, (_, i) => `01a1d0${i}0-bafe-7128-b415-8612c599aa56`);
  const [TOOL, AFTER_STOP, EXITED, SUBAGENT, STALE_SUB, PANE, HUGE] = ids;
  const running = new Map();

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'omp-turns-'));
    const tenMinAgo = stamp - 10 * 60_000;
    const add = (id, records, mtime) => running.set(session(id, records, mtime), running.size + 1);
    // a long tool run: nothing written for 10 minutes
    add(
      TOOL,
      [message('assistant', { stopReason: 'toolUse' }), custom('tool_execution_start')],
      tenMinAgo
    );
    // the turn ended; title, usage and reminders written just now are no work
    add(
      AFTER_STOP,
      [
        message('assistant', { stopReason: 'stop' }),
        { type: 'model_usage', purpose: 'title' },
        { type: 'title_change', title: 'x' },
        custom('date-cwd-reminder'),
        notice('eval-state-context'),
      ],
      stamp
    );
    add(EXITED, [message('assistant', { stopReason: 'stop' }), custom('session_exit')], stamp);
    // parent idle, its subagent mid-turn and written since
    add(SUBAGENT, [message('assistant', { stopReason: 'stop' })], tenMinAgo);
    write(
      path.join(root, '-w', `2026-11-09T13-53-05-245Z_${SUBAGENT}`, 'Worker.jsonl'),
      [message('user'), message('assistant', { stopReason: 'toolUse' })],
      stamp
    );
    // a subagent left mid-turn before the parent's last write (killed): no work
    add(STALE_SUB, [message('assistant', { stopReason: 'stop' })], stamp);
    write(
      path.join(root, '-w', `2026-11-09T13-53-05-245Z_${STALE_SUB}`, 'Worker.jsonl'),
      [message('user')],
      tenMinAgo
    );
    add(PANE, [message('assistant', { stopReason: 'stop' })], tenMinAgo);
    // a tool result far larger than one read chunk ends the file
    add(
      HUGE,
      [
        message('assistant', { stopReason: 'toolUse' }),
        { type: 'message', message: { role: 'toolResult', content: 'y'.repeat(300_000) } },
      ],
      tenMinAgo
    );
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('reads the open turn from the tail, cached per size and mtime', async () => {
    const file = [...running.keys()].find((f) => f.includes(HUGE));
    const { size, mtimeMs } = fs.statSync(file);
    expect(await readTurnState(file, size, mtimeMs)).toBe('working');
    const done = [...running.keys()].find((f) => f.includes(AFTER_STOP));
    const stat = fs.statSync(done);
    expect(await readTurnState(done, stat.size, stat.mtimeMs)).toBe('idle');
  });

  it('marks running sessions working by turn, subagent or pane output', async () => {
    const pid = (id) => running.get([...running.keys()].find((f) => f.includes(id)));
    const rows = await listOmpSessions({
      sessionsDir: root,
      now: stamp + 1000,
      running,
      panes: new Map([[pid(PANE), { paneId: 'pane-1', active: true }]]),
    });
    const state = Object.fromEntries(rows.map((r) => [r.sessionId, r.displayState]));
    expect(state).toEqual({
      [TOOL]: 'working',
      [AFTER_STOP]: 'idle',
      [EXITED]: 'idle',
      [SUBAGENT]: 'working',
      [STALE_SUB]: 'idle',
      [PANE]: 'working',
      [HUGE]: 'working',
    });
    expect(rows.find((r) => r.sessionId === PANE)).toMatchObject({
      paneId: 'pane-1',
      status: 'busy',
    });
    // a subagent's transcript is no session of its own
    expect(rows).toHaveLength(7);
  });
});

describe('listOmpSessions', () => {
  const list = () =>
    listOmpSessions({
      sessionsDir: dir,
      now,
      running: new Map([
        [files[RUNNING], 94286],
        [files[ELSEWHERE], 17119],
      ]),
      panes: new Map([[94286, { paneId: 'interactive-1794214000000', active: false }]]),
    });

  it('lists running and recent sessions as resumable omp rows, newest first', async () => {
    const rows = await list();
    expect(rows.map((r) => r.sessionId)).toEqual([RUNNING, ELSEWHERE, FINISHED]);
    const [here, elsewhere, finished] = rows;
    expect(here).toMatchObject({
      id: `omp-${RUNNING}`,
      kind: 'interactive',
      ptyCommand: 'omp',
      ptyArgs: ['-r', RUNNING],
      cwd: '/w/app',
      name: 'Antworte nur mit: hallo',
      pid: 94286,
      paneId: 'interactive-1794214000000',
      displayState: 'working',
      state: null,
    });
    expect(elsewhere).toMatchObject({
      pid: 17119,
      paneId: null,
      displayState: 'idle',
      name: 'UPDATE: Build',
    });
    expect(elsewhere.detail).toMatch(/PID 17119/);
    expect(finished).toMatchObject({ pid: null, state: 'done', displayState: 'completed' });
  });

  it('is empty without an omp install', async () => {
    expect(
      await listOmpSessions({ sessionsDir: path.join(dir, 'missing'), running: new Map() })
    ).toEqual([]);
  });
});

describe('omp transcript', () => {
  it('finds a session by id in any project folder and reads its messages', async () => {
    const file = await findOmpSessionFile(FINISHED, dir);
    expect(file).toBe(files[FINISHED]);
    expect(await findOmpSessionFile('../../etc/passwd', dir)).toBeNull();
    const entries = await readOmpTranscriptTail(file);
    expect(entries.map((e) => [e.role, e.text])).toEqual([
      ['user', 'hallo'],
      ['assistant', 'Hallo zurück'],
    ]);
  });

  it('reads back past megabytes of tool output to the earlier prompts', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'omp-tail-')), 's.jsonl');
    const msg = (role, text) =>
      JSON.stringify({ type: 'message', message: { role, content: [{ type: 'text', text }] } });
    const output = JSON.stringify({
      type: 'message',
      message: { role: 'toolResult', content: [{ type: 'text', text: 'ä'.repeat(400_000) }] },
    });
    fs.writeFileSync(
      file,
      [
        msg('user', 'erster Prompt'),
        output,
        output,
        msg('user', 'zweiter Prompt'),
        output,
        msg('assistant', 'fertig'),
      ].join('\n')
    );
    expect((await readOmpTranscriptTail(file)).map((e) => e.text)).toEqual([
      'erster Prompt',
      'zweiter Prompt',
      'fertig',
    ]);
  });
});

describe('stopOmpSession (taking over a session from another terminal)', () => {
  it('ends only the process holding the session and reports a session nobody runs', async () => {
    const holder = spawn('sleep', ['30'], { stdio: 'ignore' });
    const bystander = spawn('sleep', ['30'], { stdio: 'ignore' });
    const exited = new Promise((resolve) => holder.on('exit', (_code, signal) => resolve(signal)));
    try {
      const running = new Map([[files[ELSEWHERE], holder.pid]]);
      const result = await stopOmpSession(ELSEWHERE, { sessionsDir: dir, running });
      expect(result).toEqual({ stopped: holder.pid });
      expect(await exited).toBe('SIGTERM');
      expect(bystander.exitCode).toBeNull();
      expect(await stopOmpSession(FINISHED, { sessionsDir: dir, running })).toEqual({
        stopped: null,
      });
      await expect(
        stopOmpSession(OLD.replace('0000', 'ffff'), { sessionsDir: dir })
      ).rejects.toThrow('not found');
    } finally {
      holder.kill('SIGKILL');
      bystander.kill('SIGKILL');
    }
  });
});

describe('removeOmpSession', () => {
  it('ends the running process, then deletes the session file, artifacts and backups only', async () => {
    const slug = path.join(dir, '-PROJECTS-del');
    fs.mkdirSync(slug);
    const id = '01a1d000-1111-7222-8333-444455556666';
    const keep = '01a1d000-1111-7222-8333-777788889999';
    const base = `2026-11-10T09-00-00-000Z_${id}`;
    const file = path.join(slug, `${base}.jsonl`);
    fs.writeFileSync(file, sessionFile(id, '/w/del'));
    fs.mkdirSync(path.join(slug, base));
    fs.writeFileSync(path.join(slug, base, 'artifact.txt'), 'x');
    fs.writeFileSync(path.join(slug, `${base}.jsonl.1.bak`), 'old');
    const other = path.join(slug, `2026-11-10T09-00-00-000Z_${keep}.jsonl`);
    fs.writeFileSync(other, sessionFile(keep, '/w/del'));
    const holder = spawn('sleep', ['30'], { stdio: 'ignore' });
    const exited = new Promise((resolve) => holder.on('exit', (_code, signal) => resolve(signal)));
    try {
      const running = new Map([[file, holder.pid]]);
      expect(await removeOmpSession(id, { sessionsDir: dir, running })).toEqual({
        stopped: holder.pid,
      });
      expect(await exited).toBe('SIGTERM');
      expect(fs.readdirSync(slug)).toEqual([path.basename(other)]);
      expect(await findOmpSessionFile(id, dir)).toBeNull();
      await expect(removeOmpSession(id, { sessionsDir: dir, running })).rejects.toThrow(
        'not found'
      );
    } finally {
      holder.kill('SIGKILL');
    }
  });
});
