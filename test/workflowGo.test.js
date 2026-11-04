import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/services/agentService.js', () => ({ runOnHost: vi.fn() }));

const { runOnHost } = await import('../server/services/agentService.js');
const {
  applyGo,
  kickPoll,
  startNow,
  workflowGoSchema,
  workflowStartSchema,
  MW_BOARD_JOB,
  POLL_FALLBACK,
} = await import('../server/services/workflowGo.js');

const URL_ = 'https://github.com/o/r/issues/7';
const KICK = ['kickstart', `gui/${process.getuid()}/${MW_BOARD_JOB}`];
const GO = ['mw', ['board', 'go', URL_, '--json']];
const ctx = (go, labels = ['mw:go']) => ({
  source: 'src',
  item: { itemId: 'PVTI_1', url: URL_, labels: labels.map((name) => ({ name })) },
  state: { go },
});
const ok = (stdout, code = 0) => ({ code, stdout, stderr: '' });
/** argparse of an mw without `board go`, as the installed mw 7.6 prints it */
const OLD_MW = {
  code: 2,
  stdout: '',
  stderr:
    "usage: mw board [-h] {poll,install,ask,briefed,done,add} ...\nmw board: error: argument bcmd: invalid choice: 'go' (choose from 'poll', 'install', 'ask', 'briefed', 'done', 'add')",
};
const calls = () => vi.mocked(runOnHost).mock.calls.map((c) => c.slice(0, 2));

describe('workflowGo', () => {
  let updateIssue;
  beforeEach(() => {
    vi.mocked(runOnHost).mockReset().mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    updateIssue = vi.fn().mockResolvedValue({ itemId: 'PVTI_1' });
  });

  it('poll GO ("Jetzt starten") calls mw board go for the issue, no label write', async () => {
    vi.mocked(runOnHost).mockResolvedValue(ok('{"action": "start", "reason": "Todo mit mw:go"}'));
    const r = await applyGo(ctx({ kind: 'poll' }), { kind: 'poll' }, { updateIssue });
    expect(r).toEqual({
      status: 200,
      body: { ok: true, start: { action: 'start', reason: 'Todo mit mw:go' } },
    });
    expect(calls()).toEqual([GO]);
    expect(updateIssue).not.toHaveBeenCalled();
  });

  it('old mw without board go: poll GO kickstarts the launchd job, without -k', async () => {
    vi.mocked(runOnHost).mockResolvedValueOnce(OLD_MW).mockResolvedValueOnce(ok(''));
    const r = await applyGo(ctx({ kind: 'poll' }), { kind: 'poll' }, { updateIssue });
    expect(calls()).toEqual([GO, ['launchctl', KICK]]);
    expect(r.body.start).toEqual({ action: 'poll', reason: POLL_FALLBACK });
  });

  it('poll GO not offered by the fresh state: 409, nothing runs', async () => {
    for (const offered of [null, { kind: 'build' }]) {
      const r = await applyGo(ctx(offered), { kind: 'poll' }, { updateIssue });
      expect(r.status).toBe(409);
    }
    expect(runOnHost).not.toHaveBeenCalled();
  });

  it('a failed kickstart is an error for the poll GO', async () => {
    vi.mocked(runOnHost).mockResolvedValueOnce(OLD_MW).mockResolvedValue({
      code: 113,
      stdout: '',
      stderr: 'Could not find service',
    });
    await expect(applyGo(ctx({ kind: 'poll' }), { kind: 'poll' }, { updateIssue })).rejects.toThrow(
      /Could not find service/
    );
  });

  it('build GO sets mw:build, then calls mw board go <url> --json', async () => {
    vi.mocked(runOnHost).mockResolvedValue(ok('{"action": "resume", "reason": "mw:build"}'));
    const r = await applyGo(ctx({ kind: 'build' }), { kind: 'build' }, { updateIssue });
    expect(updateIssue).toHaveBeenCalledWith('src', 'PVTI_1', { labels: ['mw:go', 'mw:build'] });
    expect(calls()).toEqual([GO]);
    expect(updateIssue.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(runOnHost).mock.invocationCallOrder[0]
    );
    expect(r).toEqual({
      status: 200,
      body: {
        ok: true,
        item: { itemId: 'PVTI_1' },
        start: { action: 'resume', reason: 'mw:build' },
      },
    });
  });

  it('AC-2: build GO with mw:build already set writes it exactly once', async () => {
    vi.mocked(runOnHost).mockResolvedValue(ok('{"action": "resume", "reason": ""}'));
    await applyGo(
      ctx({ kind: 'build' }, ['mw:go', 'mw:build']),
      { kind: 'build' },
      { updateIssue }
    );
    expect(updateIssue).toHaveBeenCalledWith('src', 'PVTI_1', { labels: ['mw:go', 'mw:build'] });
  });

  it('build GO keeps the label when the start fails and reports the error', async () => {
    vi.mocked(runOnHost).mockResolvedValueOnce(OLD_MW).mockResolvedValue({
      code: 113,
      stdout: '',
      stderr: 'Could not find service',
    });
    const r = await applyGo(ctx({ kind: 'build' }), { kind: 'build' }, { updateIssue });
    expect(updateIssue).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(200);
    expect(r.body.start).toEqual({
      action: 'error',
      reason: expect.stringMatching(/Could not find service/),
    });
  });

  describe('AC-3: startNow', () => {
    it('started: mw board go with fixed argument list, result passed through', async () => {
      vi.mocked(runOnHost).mockResolvedValue(ok('{"action": "start", "reason": "Todo"}\n'));
      expect(await startNow(URL_)).toEqual({ action: 'start', reason: 'Todo' });
      expect(calls()).toEqual([GO]);
      expect(vi.mocked(runOnHost).mock.calls[0][2]).toMatchObject({ timeout: 60_000 });
    });

    it('no capacity: non-zero exit with JSON is a result, not an error, and no poll kick', async () => {
      vi.mocked(runOnHost).mockResolvedValue(
        ok('{"action": "none", "reason": "kein Platz frei (4/4)"}', 3)
      );
      expect(await startNow(URL_)).toEqual({ action: 'none', reason: 'kein Platz frei (4/4)' });
      expect(calls()).toEqual([GO]);
    });

    it('fallback: mw without board go kicks the poll', async () => {
      vi.mocked(runOnHost).mockResolvedValueOnce(OLD_MW).mockResolvedValueOnce(ok(''));
      expect(await startNow(URL_)).toEqual({ action: 'poll', reason: POLL_FALLBACK });
      expect(calls()).toEqual([GO, ['launchctl', KICK]]);
    });

    it('fallback: no mw on the PATH (ENOENT) kicks the poll', async () => {
      vi.mocked(runOnHost)
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'spawn mw ENOENT' })
        .mockResolvedValueOnce(ok(''));
      expect(await startNow(URL_)).toEqual({ action: 'poll', reason: POLL_FALLBACK });
    });

    it('any other failure of mw board go is an error, no poll kick', async () => {
      vi.mocked(runOnHost).mockResolvedValue({ code: 1, stdout: '', stderr: 'Traceback: boom' });
      await expect(startNow(URL_)).rejects.toThrow(/boom/);
      expect(calls()).toEqual([GO]);
    });
  });

  it('AC-5: a URL outside github.com/<owner>/<repo>/issues/<n> is a 400, mw never runs', async () => {
    for (const url of [
      'https://github.com/o/r/pull/7',
      'https://github.com/o/r/issues/7 --help',
      'https://github.com/o/r/issues/7/../../x',
      'https://evil.com/o/r/issues/7',
      'http://github.com/o/r/issues/7',
      '--json',
      'https://github.com/o/r/issues/7\n',
      'https://github.com/o/r/issues/',
    ]) {
      expect(workflowStartSchema.safeParse({ url }).success).toBe(false);
      await expect(startNow(url)).rejects.toMatchObject({ status: 400 });
    }
    expect(workflowStartSchema.safeParse({ url: URL_, x: 1 }).success).toBe(false);
    expect(workflowStartSchema.safeParse({ url: URL_ }).success).toBe(true);
    expect(runOnHost).not.toHaveBeenCalled();
  });

  it('#136 AC-4: stale build GO (state no longer offers it): 409, no label', async () => {
    for (const offered of [null, { kind: 'poll' }]) {
      const r = await applyGo(ctx(offered), { kind: 'build' }, { updateIssue });
      expect(r.status).toBe(409);
    }
    expect(updateIssue).not.toHaveBeenCalled();
    expect(runOnHost).not.toHaveBeenCalled();
  });

  it('kickPoll takes the host uid when given (Docker)', async () => {
    await kickPoll('501');
    expect(vi.mocked(runOnHost).mock.calls[0][1]).toEqual(['kickstart', `gui/501/${MW_BOARD_JOB}`]);
  });

  it('#136 AC-4: /workflows/go schema takes build only; poll, approve and extras are rejected (400)', () => {
    expect(workflowGoSchema.safeParse({ kind: 'build' }).success).toBe(true);
    expect(workflowGoSchema.safeParse({ kind: 'build', label: 'x' }).success).toBe(false);
    expect(workflowGoSchema.safeParse({ kind: 'poll' }).success).toBe(false);
    expect(workflowGoSchema.safeParse({ kind: 'kick' }).success).toBe(false);
    const approve = { kind: 'approve', runId: 'r-1', stage: 'plan', sha: 'abcdef1' };
    expect(workflowGoSchema.safeParse(approve).success).toBe(false);
  });
});
