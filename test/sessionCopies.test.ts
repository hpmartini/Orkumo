import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AgentSession } from '../types';
import {
  collapseCopies,
  paneHolding,
  resumeMakesCopy,
  tabSessionLabel,
  transcriptHolder,
  transcriptIds,
} from '../utils/sessionCopies';

const ORIG = '7305722f-7bed-4a28-a57e-4e46aa40c9dd';
const RESPAWN = '6f6f9c58-de21-4776-b7b4-60c1ef917b1e';

const base = (over: Partial<AgentSession>): AgentSession => ({
  id: 'x',
  sessionId: null,
  kind: 'interactive',
  cwd: '/w/issue-10',
  startedAt: 0,
  name: 'MACC walz-landing#10',
  state: null,
  pinned: false,
  order: null,
  links: [],
  displayState: 'idle',
  ...over,
});

// The 2026-11-06 case: the job (respawned into RESPAWN) plus one process on each of its transcripts
const job = base({
  id: '7305722f',
  kind: 'background',
  sessionId: RESPAWN,
  sessionIds: [RESPAWN, ORIG],
  startedAt: 1,
  displayState: 'idle',
});
const copyOrig = base({ id: 'interactive-3993', sessionId: ORIG, pid: 3993, startedAt: 5 });
const copyRespawn = base({ id: 'interactive-19245', sessionId: RESPAWN, pid: 19245, startedAt: 6 });
const other = base({ id: 'interactive-77', sessionId: 'aaaaaaaa-0000', pid: 77, startedAt: 2 });

describe('session copies (#236)', () => {
  it('AC-4 job + two resumed processes on its transcripts collapse into one row with 2 copies', () => {
    const rows = collapseCopies([copyOrig, job, copyRespawn, other]);
    expect(rows.map((r) => r.id)).toEqual(['7305722f', 'interactive-77']);
    expect(rows[0].copies?.map((c) => c.id)).toEqual(['interactive-3993', 'interactive-19245']);
    expect(rows[1].copies).toBeUndefined();
  });

  it('AC-4 two interactive processes on one transcript: the older one is the row', () => {
    const a = base({ id: 'interactive-1', sessionId: ORIG, pid: 1, startedAt: 1 });
    const b = base({ id: 'interactive-2', sessionId: ORIG, pid: 2, startedAt: 9 });
    const rows = collapseCopies([b, a]);
    expect(rows.map((r) => r.id)).toEqual(['interactive-1']);
    expect(rows[0].copies?.map((c) => c.id)).toEqual(['interactive-2']);
  });

  it('sessions without a transcript id never merge', () => {
    const a = base({ id: 'a' });
    const b = base({ id: 'b' });
    expect(collapseCopies([a, b]).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('transcriptIds lists current id first, deduped', () => {
    expect(transcriptIds(job)).toEqual([RESPAWN, ORIG]);
  });

  it('AC-3 resuming a background job or a running interactive process makes a copy', () => {
    expect(resumeMakesCopy(job)).toBe(true);
    expect(resumeMakesCopy(copyOrig)).toBe(true);
    // Orkumo's own terminal pane (no pid in the client stand-in) hands over instead
    expect(resumeMakesCopy(base({ id: 'interactive-17', ptyArgs: ['--session-id', ORIG] }))).toBe(
      false
    );
  });

  it('AC-3 /resume <id or prefix> finds the job that still holds the transcript', () => {
    expect(transcriptHolder([job, other], ORIG)?.id).toBe('7305722f');
    expect(transcriptHolder([job, other], '6f6f9c58')?.id).toBe('7305722f');
    expect(transcriptHolder([job, other], 'bbbbbbbb-1')).toBeNull();
    expect(transcriptHolder([job], '6f6f')).toBeNull();
  });

  it('AC-5 a terminal pane already running the session is found by its args', () => {
    const term = base({ id: 'interactive-17', ptyArgs: ['--resume', ORIG] });
    expect(paneHolding([term], new Set(['interactive-17']), ORIG)).toBe('interactive-17');
    expect(paneHolding([term], new Set(), ORIG)).toBeNull();
    expect(paneHolding([term], new Set(['interactive-17']), null)).toBeNull();
  });

  it('AC-5 tab label: job id for a background job, short transcript id otherwise', () => {
    expect(tabSessionLabel(job)).toBe('7305722f');
    expect(tabSessionLabel(base({ id: 'interactive-1', ptyArgs: ['--session-id', ORIG] }))).toBe(
      '7305722f'
    );
    expect(tabSessionLabel(base({ id: 'interactive-2', ptyArgs: ['--resume', RESPAWN] }))).toBe(
      '6f6f9c58'
    );
    expect(tabSessionLabel(base({ id: 'shell:1' }))).toBeNull();
  });
});

describe('listSessions: a respawned job reports the transcript it writes now (#236)', () => {
  let tmp: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copies236-'));
    fs.mkdirSync(path.join(tmp, 'jobs', '7305722f'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'jobs', '7305722f', 'state.json'),
      JSON.stringify({ state: 'idle', sessionId: ORIG, resumeSessionId: RESPAWN, cwd: '/w' })
    );
    const bin = path.join(tmp, 'claude');
    fs.writeFileSync(
      bin,
      `#!/bin/sh\necho '[{"kind":"background","id":"7305722f","cwd":"/w","sessionId":"${ORIG}","state":"idle","startedAt":1}]'\n`
    );
    fs.chmodSync(bin, 0o755);
    process.env.CLAUDE_CONFIG_DIR = tmp;
    process.env.CLAUDE_CLI_PATH = bin;
  });
  afterAll(() => {
    delete process.env.CLAUDE_CONFIG_DIR;
    delete process.env.CLAUDE_CLI_PATH;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('sessionId = resumeSessionId, sessionIds keeps the original', async () => {
    const { listSessions } = await import('../server/services/agentService.js');
    const [s] = await listSessions();
    expect(s.sessionId).toBe(RESPAWN);
    expect(s.sessionIds).toEqual([RESPAWN, ORIG]);
  });
});
