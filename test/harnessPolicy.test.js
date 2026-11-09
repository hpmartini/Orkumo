import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  HARNESS_COMMANDS,
  MAX_HARNESS_PROMPT,
  harnessArgsError,
  isHarnessCommand,
  resolveHarnessBinary,
} from '../config/harnesses.js';

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

  it('lets only omp resume, and only a session UUID', () => {
    const id = '01a1c095-7edd-72eb-9c97-4afdcd01f56e';
    expect(harnessArgsError('omp', ['-r', id])).toBeNull();
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
