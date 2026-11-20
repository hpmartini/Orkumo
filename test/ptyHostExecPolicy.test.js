import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isAllowedExec, loadRules } from '../pty-host/execPolicy.js';
import { MAX_EXEC_INPUT, parseExecRequest, runExec } from '../pty-host/execRun.js';

const RULES = [
  { command: 'wf-tool', args: ['start', '{issue}', '--json'] },
  { command: 'launchctl', args: ['kickstart', 'gui/{uid}/my.job'] },
];
const url = 'https://github.com/o/r/issues/7';
const allowed = (command, args) => isAllowedExec(command, args, 501, RULES);

describe('pty-host isAllowedExec', () => {
  it('claude stays allowed with any arguments, even without rules', () => {
    expect(isAllowedExec('claude', ['agents', '--json'], 501, [])).toBe(true);
  });

  it('without rules nothing else runs', () => {
    expect(isAllowedExec('wf-tool', ['start', url, '--json'], 501, [])).toBe(false);
  });

  it('a rule allows exactly its argv; {issue} only a GitHub issue URL', () => {
    expect(allowed('wf-tool', ['start', url, '--json'])).toBe(true);
    for (const args of [
      ['start', url],
      ['start', url, '--json', 'x'],
      ['start', 'https://github.com/o/r/pull/7', '--json'],
      ['start', `${url};rm`, '--json'],
      ['start', `${url} --force`, '--json'],
      ['stop', url, '--json'],
      ['start', '{issue}', '--json'],
      'start ' + url,
      [1, 2, 3],
    ]) {
      expect(allowed('wf-tool', args)).toBe(false);
    }
  });

  it('{uid} is the host user only', () => {
    expect(allowed('launchctl', ['kickstart', 'gui/501/my.job'])).toBe(true);
    expect(allowed('launchctl', ['kickstart', 'gui/0/my.job'])).toBe(false);
    expect(allowed('launchctl', ['kickstart', 'gui/{uid}/my.job'])).toBe(false);
    expect(allowed('launchctl', ['kickstart', '-k', 'gui/501/my.job'])).toBe(false);
  });

  it('other commands stay refused', () => {
    for (const cmd of ['/bin/launchctl', 'sh', './wf-tool', undefined, 42]) {
      expect(allowed(cmd, ['start', url, '--json'])).toBe(false);
    }
  });
});

describe('loadRules', () => {
  let tmp;
  afterEach(() => tmp && fs.rmSync(tmp, { recursive: true, force: true }));
  const write = (content) => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-rules-'));
    const f = path.join(tmp, 'rules.json');
    fs.writeFileSync(f, content);
    return f;
  };

  it('missing file: no rules', () => {
    expect(loadRules('/nonexistent/exec-rules.json')).toEqual([]);
  });

  it('broken JSON: no rules; invalid entries are dropped', () => {
    expect(loadRules(write('{'))).toEqual([]);
    const bad = [{ command: 'x' }, { command: '', args: [] }, { command: 'y', args: [1] }];
    expect(loadRules(write(JSON.stringify([...RULES, ...bad])))).toEqual(RULES);
  });
});

describe('pty-host /exec request', () => {
  const ok = (command, args) => allowed(command, args);

  it('checks argv against the allowlist; input never changes the verdict', () => {
    const args = ['start', url, '--json'];
    expect(parseExecRequest({ command: 'wf-tool', args, input: '{"a":1}' }, ok)).toEqual({
      command: 'wf-tool',
      args,
      cwd: undefined,
      timeout: 60000,
      input: '{"a":1}',
    });
    expect(
      parseExecRequest({ command: 'wf-tool', args: ['stop', url, '--json'], input: 'x' }, ok)
    ).toEqual({ status: 403, error: 'Command not allowed' });
  });

  it('refuses input that is no string or exceeds 16 KB', () => {
    const args = ['start', url, '--json'];
    expect(parseExecRequest({ command: 'wf-tool', args, input: { a: 1 } }, ok).status).toBe(400);
    expect(
      parseExecRequest({ command: 'wf-tool', args, input: 'x'.repeat(MAX_EXEC_INPUT + 1) }, ok)
        .status
    ).toBe(400);
    expect(
      parseExecRequest({ command: 'wf-tool', args, input: 'x'.repeat(MAX_EXEC_INPUT) }, ok)
    ).not.toHaveProperty('error');
  });

  it('runExec hands input to stdin and closes it; without input stdin stays untouched', async () => {
    const cat = ['-e', 'process.stdin.pipe(process.stdout)'];
    expect(await runExec(process.execPath, cat, { timeout: 10000, input: '{"x":1}' })).toEqual({
      code: 0,
      stdout: '{"x":1}',
      stderr: '',
    });
    const quick = await runExec(process.execPath, ['-e', 'process.exit(2)'], {
      timeout: 10000,
      input: 'x'.repeat(MAX_EXEC_INPUT),
    });
    expect(quick.code).toBe(2);
  });
});
