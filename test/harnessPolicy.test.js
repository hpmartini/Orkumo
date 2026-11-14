import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  HARNESS_COMMANDS,
  HARNESS_MODEL_SUPPORT,
  harnessArgsError,
  isHarnessCommand,
  resolveHarnessBinary,
} from '../config/harnesses.js';
import { MAX_HARNESS_PROMPT } from '../config/limits.js';
import { HARNESS_MODEL_FLAG } from '../utils/agentSessions';

describe('harness policy (#195)', () => {
  it('knows exactly the four harnesses', () => {
    expect([...HARNESS_COMMANDS].sort()).toEqual(['codex', 'omp', 'opencode', 'pi']);
    for (const bad of ['claude', 'bash', 'sh', 'ssh', '/opt/homebrew/bin/codex', '__proto__']) {
      expect(isHarnessCommand(bad)).toBe(false);
    }
  });

  it('allows no args, or a single prompt after -- where supported', () => {
    for (const id of HARNESS_COMMANDS) expect(harnessArgsError(id, [])).toBeNull();
    for (const id of ['omp', 'codex', 'pi']) {
      expect(harnessArgsError(id, ['--', 'fix the "login"; $(rm -rf ~) bug\nplease'])).toBeNull();
    }
    expect(harnessArgsError('opencode', ['--', 'hi'])).toMatch(/no arguments/);
  });

  it('rejects every flag and every other argument shape', () => {
    for (const args of [
      ['--config', 'x.yml'],
      ['--api-key', 'k'],
      ['-c'],
      ['resume', '--last'],
      ['hello'],
      ['--', 'a', 'b'],
      ['--', ''],
      ['--', '   '],
      ['--', 'a\0b'],
      ['--', 'x'.repeat(MAX_HARNESS_PROMPT + 1)],
      'not-an-array',
      [1, 2],
    ]) {
      for (const id of ['omp', 'codex', 'pi']) expect(harnessArgsError(id, args)).not.toBeNull();
    }
    expect(harnessArgsError('bash', [])).toBe('Unknown harness');
  });

  it('resumes only in each harness’s own form, and only with a session id', () => {
    const id = '01a1c095-7edd-72eb-9c97-4afdcd01f56e';
    expect(harnessArgsError('omp', ['-r', id])).toBeNull();
    expect(harnessArgsError('pi', ['--session', id])).toBeNull();
    expect(harnessArgsError('codex', ['resume', id])).toBeNull();
    expect(
      harnessArgsError('opencode', ['--session', 'ses_e387fa255ffe16nILLAOprRkzX'])
    ).toBeNull();
    for (const args of [
      ['-r'],
      ['-r', '01a1c095'],
      ['-r', '../../etc/passwd'],
      ['-r', `${id}`, '--api-key'],
      ['-r', '--config=x.yml'],
      ['--resume', id],
    ]) {
      expect(harnessArgsError('omp', args)).not.toBeNull();
    }
    for (const other of ['codex', 'pi', 'opencode']) {
      expect(harnessArgsError(other, ['-r', id])).not.toBeNull();
    }
    expect(harnessArgsError('codex', ['resume', '--last'])).not.toBeNull();
    expect(harnessArgsError('opencode', ['--session', id])).not.toBeNull();
    expect(harnessArgsError('pi', ['--session', '../x.jsonl'])).not.toBeNull();
  });

  it('#19 AK-2: a plain model name may come first, where the CLI takes one', () => {
    for (const id of ['omp', 'codex', 'pi']) {
      expect(harnessArgsError(id, ['--model', 'gpt-5-codex'])).toBeNull();
      expect(
        harnessArgsError(id, ['--model', 'anthropic/claude-sonnet-4-5:high', '--', 'hi'])
      ).toBeNull();
    }
    for (const args of [
      ['--model'],
      ['--model', ''],
      ['--model', '--config=x.yml'],
      ['--model', '-x'],
      ['--model', 'a b'],
      ['--model', 'x'.repeat(81)],
      ['--model', 'opus', '--api-key', 'k'],
      ['--model', 'opus', 'hello'],
      ['--model', 'opus', '--model', 'sonnet'],
    ]) {
      expect(harnessArgsError('codex', args)).not.toBeNull();
    }
    // no model with a resume, none for opencode
    expect(
      harnessArgsError('codex', ['--model', 'o3', 'resume', '01a1c095-7edd-72eb-9c97-4afdcd01f56e'])
    ).not.toBeNull();
    expect(harnessArgsError('opencode', ['--model', 'x'])).toMatch(/no model/);
  });

  it('the client offers --model exactly where the server allows it', () => {
    for (const id of HARNESS_COMMANDS) expect(HARNESS_MODEL_FLAG[id]).toBe(HARNESS_MODEL_SUPPORT[id]);
  });

  it('resolves only executables named after the harness, null when missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
    const bin = path.join(dir, 'pi');
    fs.writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 });
    const env = { HOME: dir, PATH: dir };
    expect(resolveHarnessBinary('pi', env)).toBe(bin);
    expect(resolveHarnessBinary('claude', env)).toBeNull();
    fs.rmSync(bin);
    const empty = { HOME: dir, PATH: '' };
    // the fixed dirs (/opt/homebrew/bin …) may still hold a real install; a fake name never resolves
    expect(resolveHarnessBinary('bash', empty)).toBeNull();
    fs.rmSync(dir, { recursive: true });
  });
});
