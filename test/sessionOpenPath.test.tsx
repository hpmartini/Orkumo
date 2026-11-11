import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AgentSession } from '../types';
import { openPlan } from '../utils/sessionCopies';
import { buildAttachUrl } from '../components/AgentsView/AgentTerminal';
import { CopyWarningDialog } from '../components/AgentsView/CopyWarningDialog';

// #236 open path: rail decision → attach URL the pane opens → real PTY spawn with a claude stub
// that logs its argv. Fake ids, so a real CLI could never touch a real job.
const JOB = 'fa4e0236';
const ORIG = 'fa4e0236-0000-4000-8000-000000000001';
const RESPAWN = 'b0b00236-0000-4000-8000-000000000002';

const job: AgentSession = {
  id: JOB,
  sessionId: RESPAWN,
  sessionIds: [RESPAWN, ORIG],
  kind: 'background',
  cwd: '/w/issue-10',
  startedAt: 1,
  name: 'MACC walz-landing#10',
  state: 'idle',
  pinned: false,
  order: null,
  links: [],
  displayState: 'idle',
};

let tmp: string;
let argvLog: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'open236-'));
  argvLog = path.join(tmp, 'argv.log');
  const bin = path.join(tmp, 'claude');
  fs.writeFileSync(bin, `#!/bin/sh\necho "$*" >> "${argvLog}"\n`);
  fs.chmodSync(bin, 0o755);
  vi.stubEnv('CLAUDE_CLI_PATH', bin);
});
afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const waitFor = async (ok: () => boolean) => {
  for (let i = 0; i < 50 && !ok(); i++) await new Promise((r) => setTimeout(r, 100));
};

describe('opening a background job (#236)', () => {
  it('AC-1/AC-2 the rail attaches: PTY runs `claude attach <id>`, no --resume, no stop', async () => {
    expect(openPlan(job, [], new Set())).toEqual({ type: 'attach' });
    const url = new URL(buildAttachUrl(job.id, job.cwd, 80, 24));
    const args = JSON.parse(url.searchParams.get('args') || '[]');
    expect(url.searchParams.get('command')).toBe('claude');

    const { createPtySession, killPtySession } = await import('../server/services/ptyService.js');
    const res = createPtySession('t236', tmp, 80, 24, { command: 'claude', args });
    expect(res.success).toBe(true);
    await waitFor(() => fs.existsSync(argvLog));
    killPtySession('t236');
    const calls = fs.readFileSync(argvLog, 'utf8').trim().split('\n');
    expect(calls).toEqual([`attach ${JOB}`]);
  });

  it('AC-5 a second open focuses the pane that holds the session', () => {
    const pane = {
      ...job,
      id: 'interactive-17',
      kind: 'interactive' as const,
      ptyArgs: ['--resume', RESPAWN],
    };
    const resumed = { ...pane, id: 'interactive-9', ptyArgs: undefined, sessionId: RESPAWN };
    expect(openPlan(resumed, [pane], new Set(['interactive-17']))).toEqual({
      type: 'focus',
      paneId: 'interactive-17',
    });
    expect(openPlan(resumed, [pane], new Set())).toEqual({ type: 'resume', sessionId: RESPAWN });
  });

  it('a Claude app session opens its claude.ai page, never a resume that would fork it', () => {
    const url = 'https://claude.ai/code/session_01D4z4TC53UyrwHVYaCd5x3m';
    const app: AgentSession = {
      ...job,
      id: 'interactive-221',
      kind: 'app',
      pid: 221,
      sessionId: ORIG,
      app: { url, origin: 'ios', statusCategory: null },
    };
    expect(openPlan(app, [], new Set())).toEqual({ type: 'app', url });
  });

  it('an omp session opens the pane that runs it, else resumes with `omp -r <id>`', () => {
    const id = '01a1c095-7edd-72eb-9c97-4afdcd01f56e';
    const omp: AgentSession = {
      ...job,
      id: `omp-${id}`,
      kind: 'interactive',
      sessionId: id,
      ptyCommand: 'omp',
      ptyArgs: ['-r', id],
      paneId: 'interactive-1794214000000',
    };
    expect(openPlan(omp, [], new Set(['interactive-1794214000000']))).toEqual({
      type: 'focus',
      paneId: 'interactive-1794214000000',
    });
    // pane closed (its process ended with it): the row attaches, i.e. runs its ptyArgs
    expect(openPlan(omp, [], new Set())).toEqual({ type: 'attach' });
    // a Chat pane resumed the session: focus it, never a takeover that would end the chat
    const chat: AgentSession = {
      ...job,
      id: 'c1',
      kind: 'interactive',
      chat: true,
      harness: 'omp',
      sessionId: id,
    };
    expect(openPlan({ ...omp, paneId: null, pid: 4242 }, [chat], new Set(['c1']))).toEqual({
      type: 'focus',
      paneId: 'c1',
    });
  });
});

describe('CopyWarningDialog (#236 AC-3)', () => {
  const setup = (handover: boolean) => {
    const run = vi.fn();
    const close = vi.fn();
    render(<CopyWarningDialog holder={job} handover={handover} onConfirm={run} onClose={close} />);
    return { run, close };
  };

  it('Cancel starts nothing', () => {
    const { run, close } = setup(false);
    expect(screen.getByRole('alertdialog').textContent).toMatch(/Erzeugt Kopie/);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    cleanup();
  });

  it('Create copy runs exactly once', () => {
    const { run } = setup(false);
    fireEvent.click(screen.getByRole('button', { name: 'Create copy' }));
    expect(run).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('says "stops" only when the caller stops the holder', () => {
    setup(false);
    expect(screen.getByRole('alertdialog').textContent).toMatch(/second process/);
    expect(screen.getByRole('alertdialog').textContent).not.toMatch(/stops/);
    cleanup();
    setup(true);
    expect(screen.getByRole('alertdialog').textContent).toMatch(/stops that process/);
    cleanup();
  });
});
