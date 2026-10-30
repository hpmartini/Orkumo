import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/services/agentService.js', () => ({ runOnHost: vi.fn() }));
vi.mock('../server/services/workflowService.js', () => ({ approve: vi.fn() }));

const { runOnHost } = await import('../server/services/agentService.js');
const { approve } = await import('../server/services/workflowService.js');
const { applyGo, kickPoll, workflowGoSchema, MW_BOARD_JOB } =
  await import('../server/services/workflowGo.js');

const KICK = ['kickstart', `gui/${process.getuid()}/${MW_BOARD_JOB}`];
const ctx = (go) => ({
  source: 'src',
  item: { itemId: 'PVTI_1', labels: [{ name: 'mw:go' }] },
  run: { runId: 'r-1' },
  state: { go },
});

describe('workflowGo', () => {
  let updateIssue;
  beforeEach(() => {
    vi.mocked(runOnHost).mockReset().mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    vi.mocked(approve).mockReset();
    updateIssue = vi.fn().mockResolvedValue({ itemId: 'PVTI_1' });
  });

  it('poll GO kickstarts the mw-board launchd job, without -k', async () => {
    const r = await applyGo(ctx({ kind: 'poll' }), { kind: 'poll' }, { updateIssue });
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(runOnHost).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runOnHost).mock.calls[0].slice(0, 2)).toEqual(['launchctl', KICK]);
    expect(updateIssue).not.toHaveBeenCalled();
  });

  it('poll GO not offered by the fresh state: 409, nothing runs', async () => {
    for (const offered of [null, { kind: 'build' }]) {
      const r = await applyGo(ctx(offered), { kind: 'poll' }, { updateIssue });
      expect(r.status).toBe(409);
    }
    expect(runOnHost).not.toHaveBeenCalled();
  });

  it('a failed kickstart is an error for the poll GO', async () => {
    vi.mocked(runOnHost).mockResolvedValue({
      code: 113,
      stdout: '',
      stderr: 'Could not find service',
    });
    await expect(applyGo(ctx({ kind: 'poll' }), { kind: 'poll' }, { updateIssue })).rejects.toThrow(
      /Could not find service/
    );
  });

  it('build GO sets mw:build, then starts the poll', async () => {
    const r = await applyGo(ctx({ kind: 'build' }), { kind: 'build' }, { updateIssue });
    expect(updateIssue).toHaveBeenCalledWith('src', 'PVTI_1', { labels: ['mw:go', 'mw:build'] });
    expect(vi.mocked(runOnHost).mock.calls[0].slice(0, 2)).toEqual(['launchctl', KICK]);
    expect(updateIssue.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(runOnHost).mock.invocationCallOrder[0]
    );
    expect(r).toEqual({
      status: 200,
      body: { ok: true, item: { itemId: 'PVTI_1' }, pollError: null },
    });
  });

  it('build GO keeps the label when the kickstart fails and reports the error', async () => {
    vi.mocked(runOnHost).mockResolvedValue({
      code: 113,
      stdout: '',
      stderr: 'Could not find service',
    });
    const r = await applyGo(ctx({ kind: 'build' }), { kind: 'build' }, { updateIssue });
    expect(updateIssue).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(200);
    expect(r.body.pollError).toMatch(/Could not find service/);
  });

  it('approve GO still goes to the mw run', async () => {
    const go = { kind: 'approve', runId: 'r-1', stage: 'plan', sha: 'abcdef1' };
    vi.mocked(approve).mockResolvedValue({ ok: true });
    const r = await applyGo(ctx(go), go, { updateIssue });
    expect(approve).toHaveBeenCalledWith({ runId: 'r-1' }, 'plan', 'abcdef1');
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(runOnHost).not.toHaveBeenCalled();
  });

  it('kickPoll takes the host uid when given (Docker)', async () => {
    await kickPoll('501');
    expect(vi.mocked(runOnHost).mock.calls[0][1]).toEqual(['kickstart', `gui/501/${MW_BOARD_JOB}`]);
  });

  it('schema: poll is strict, unknown kinds are rejected (route answers 400)', () => {
    expect(workflowGoSchema.safeParse({ kind: 'poll' }).success).toBe(true);
    expect(workflowGoSchema.safeParse({ kind: 'poll', args: ['-k'] }).success).toBe(false);
    expect(workflowGoSchema.safeParse({ kind: 'kick' }).success).toBe(false);
  });
});
