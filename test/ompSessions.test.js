import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  parseSessionHead,
  parseOmpPids,
  parseLsof,
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
    });
    expect(parseSessionHead(sessionFile(RUNNING, '/w', { prompt: 'Antworte\n nur' })).title).toBe(
      'Antworte nur'
    );
    expect(parseSessionHead(line({ type: 'session', id: 'nope', cwd: '/w' }))).toBeNull();
    expect(parseSessionHead('garbage')).toBeNull();
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

describe('listOmpSessions', () => {
  const list = () =>
    listOmpSessions({
      sessionsDir: dir,
      now,
      running: new Map([
        [files[RUNNING], 94286],
        [files[ELSEWHERE], 17119],
      ]),
      panes: new Map([[94286, 'interactive-1794214000000']]),
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

  it('points a session a Chat pane runs at that chat, not at "another terminal"', async () => {
    const rows = await listOmpSessions({
      sessionsDir: dir,
      now,
      running: new Map([[files[ELSEWHERE], 17119]]),
      chats: new Map([
        [ELSEWHERE, 'chat-1'],
        [FINISHED, 'chat-2'],
      ]),
    });
    expect(rows.find((r) => r.sessionId === ELSEWHERE)).toMatchObject({
      paneId: 'chat-1',
      detail: 'running in Orkumo',
    });
    // a chat id alone does not make a finished session running
    expect(rows.find((r) => r.sessionId === FINISHED)).toMatchObject({ pid: null, paneId: null });
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
