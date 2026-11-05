import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const {
  getUsage,
  getSessions,
  parseCodexHomes,
  parseClaudeFile,
  codexLimits,
  claudeLimits,
  claudeOauthLimits,
  windowStart,
  localDate,
  usageRouter,
} = await import('../server/services/usageService.js');

const FIX = path.join(__dirname, 'fixtures', 'usage');
const NOW = Date.parse('2026-10-29T12:00:00Z');
const SOURCES = [
  {
    id: 'claude',
    label: 'Claude Code',
    kind: 'claude',
    dir: path.join(FIX, 'claude'),
    limitsFile: path.join(FIX, 'claude', 'devorbit-rate-limits.json'),
  },
  { id: 'codex-a', label: 'Codex A', kind: 'codex', dir: path.join(FIX, 'codex') },
  { id: 'codex-b', label: 'Codex B', kind: 'codex', dir: path.join(FIX, 'missing') },
];
const usage = (opts) => getUsage({ days: 7, now: NOW, sources: SOURCES, ...opts });
const byId = (r, id) => r.providers.find((p) => p.id === id);

describe('usageService - claude transcripts', () => {
  it('dedupes streamed and forked copies by message id + request id: final tokens, earliest date', async () => {
    const claude = byId(await usage(), 'claude');
    expect(claude.daily).toEqual([
      {
        date: '2026-10-28',
        model: 'claude-x',
        input: 10,
        output: 50,
        cacheRead: 100,
        cacheWrite: 20,
      },
      { date: '2026-10-29', model: 'claude-x', input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
    ]);
    expect(claude.totals).toEqual({
      input: 11,
      output: 52,
      cacheRead: 103,
      cacheWrite: 24,
      total: 190,
    });
    expect(claude.cacheHitRate).toBeCloseTo(103 / (11 + 103 + 24));
    expect(claude.available).toBe(true);
  });

  it('skips synthetic, malformed and out-of-window lines; a wider window includes old ones', async () => {
    const wide = byId(await usage({ days: 30 }), 'claude');
    expect(wide.daily.map((r) => r.date)).toEqual(['2026-10-01', '2026-10-28', '2026-10-29']);
    expect(wide.daily.some((r) => r.model === '<synthetic>')).toBe(false);
  });

  it('parses lines spanning stream chunk boundaries', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-chunk-'));
    const file = path.join(tmp, 's.jsonl');
    const filler = JSON.stringify({ type: 'user', text: 'x'.repeat(300_000) });
    const line = (i) =>
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-10-29T12:00:00Z',
        requestId: `r${i}`,
        message: { id: `m${i}`, model: 'm', usage: { input_tokens: 1, output_tokens: 1 } },
      });
    const lines = [];
    for (let i = 0; i < 20; i++) lines.push(filler, line(i));
    fs.writeFileSync(file, lines.join('\n')); // no trailing newline on purpose
    expect((await parseClaudeFile(file)).entries.size).toBe(20);
  });
});

describe('usageService - codex rollouts', () => {
  it('attributes cumulative deltas, ignores repeats and only counts last usage of a resumed file', async () => {
    const codex = byId(await usage(), 'codex-a');
    expect(codex.daily).toEqual([
      {
        date: '2026-10-28',
        model: 'gpt-a',
        input: 600,
        output: 100,
        cacheRead: 400,
        cacheWrite: 0,
      },
      { date: '2026-10-29', model: 'gpt-a', input: 300, output: 50, cacheRead: 200, cacheWrite: 0 },
      {
        date: '2026-10-29',
        model: 'gpt-b',
        input: 1500,
        output: 300,
        cacheRead: 1500,
        cacheWrite: 0,
      },
    ]);
    expect(codex.totals.total).toBe(2400 + 450 + 2100);
  });

  it('reports a missing home as unavailable with zero totals', async () => {
    const missing = byId(await usage(), 'codex-b');
    expect(missing).toMatchObject({
      available: false,
      limits: null,
      cacheHitRate: null,
      daily: [],
      totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    });
  });

  it('picks rate-limit windows by length, not position', async () => {
    const { limits } = byId(await usage(), 'codex-a');
    expect(limits).toEqual({
      fiveHour: { usedPercent: 10, resetsAt: 1793280000000, windowMinutes: 300 },
      weekly: { usedPercent: 30, resetsAt: 1793700000000, windowMinutes: 10080 },
      source: 'rollout',
      asOf: Date.parse('2026-10-29T12:00:00Z'),
      plan: 'team',
    });
  });

  it('a codex window past its reset with no newer snapshot is at 0 % (#184: 5h bar vanished)', () => {
    const raw = { primary: { used_percent: 99, window_minutes: 300, resets_at: NOW / 1000 - 1 } };
    expect(codexLimits({ raw, asOf: 1 }, NOW).fiveHour).toEqual({
      usedPercent: 0,
      resetsAt: null,
      reset: true,
      windowMinutes: 300,
    });
    expect(codexLimits({ raw, asOf: 1 }, NOW).weekly).toBeNull();
  });

  it('an idle account without rollouts in the window keeps its last snapshot (#184 Codex B)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-idle-'));
    const day = path.join(dir, 'sessions', '2026', '09', '24');
    fs.mkdirSync(day, { recursive: true });
    const file = path.join(day, 'rollout-2026-09-24T10-00-00-idle.jsonl');
    const asOf = Date.parse('2026-09-24T10:00:00Z');
    const rate_limits = {
      primary: { used_percent: 40, window_minutes: 300, resets_at: asOf / 1000 + 3600 },
      secondary: { used_percent: 55, window_minutes: 10080, resets_at: NOW / 1000 + 3600 },
    };
    fs.writeFileSync(
      file,
      JSON.stringify({
        timestamp: '2026-09-24T10:00:00Z',
        type: 'event_msg',
        payload: { type: 'token_count', info: null, rate_limits },
      }) + '\n'
    );
    fs.utimesSync(file, asOf / 1000, asOf / 1000);
    const src = { id: 'idle', label: 'Idle', kind: 'codex', dir };
    const [idle] = (await getUsage({ days: 7, now: NOW, sources: [src] })).providers;
    expect(idle.totals.total).toBe(0);
    expect(idle.limits).toMatchObject({
      asOf,
      fiveHour: { usedPercent: 0, reset: true },
      weekly: { usedPercent: 55 },
    });
  });
});

describe('usageService - sessions (#184)', () => {
  it('one row per transcript in the window with tokens and first/last activity', async () => {
    const { sessions } = await getSessions({ days: 7, now: NOW, sources: SOURCES });
    const byIdS = Object.fromEntries(sessions.map((s) => [s.id, s]));
    expect(Object.keys(byIdS).sort()).toEqual(
      [
        'claude:forked',
        'claude:session',
        'codex-a:rollout-2026-10-28T12-00-00-aaa',
        'codex-a:rollout-2026-10-28T13-00-00-bbb',
      ].sort()
    );
    expect(byIdS['codex-a:rollout-2026-10-28T12-00-00-aaa']).toMatchObject({
      provider: 'Codex A',
      firstMs: Date.parse('2026-10-28T12:00:00Z'),
      lastMs: Date.parse('2026-10-29T12:00:00Z'),
      tokens: 1650,
    });
    for (const s of sessions) expect(s.lastMs).toBeGreaterThanOrEqual(s.firstMs);
  });

  it('skips subagent transcripts and keeps the custom title and cwd', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-sess-'));
    const proj = path.join(dir, 'projects', 'p');
    fs.mkdirSync(path.join(proj, 'abc', 'subagents'), { recursive: true });
    const line = (ts, out) =>
      JSON.stringify({
        type: 'assistant',
        timestamp: ts,
        cwd: '/repo',
        gitBranch: 'feat/x',
        requestId: ts,
        message: { id: ts, model: 'm', usage: { input_tokens: 1, output_tokens: out } },
      });
    const body = [
      JSON.stringify({ type: 'custom-title', customTitle: 'Mein Titel' }),
      line('2026-10-29T08:00:00Z', 9),
      line('2026-10-29T11:00:00Z', 19),
    ].join('\n');
    fs.writeFileSync(path.join(proj, 'abc.jsonl'), body);
    fs.writeFileSync(path.join(proj, 'abc', 'subagents', 'agent-1.jsonl'), body);
    const src = { id: 'c', label: 'Claude', kind: 'claude', dir };
    const { sessions } = await getSessions({ days: 1, now: NOW, sources: [src] });
    expect(sessions).toEqual([
      {
        id: 'c:abc',
        providerId: 'c',
        provider: 'Claude',
        title: 'Mein Titel',
        cwd: '/repo',
        branch: 'feat/x',
        firstMs: Date.parse('2026-10-29T08:00:00Z'),
        lastMs: Date.parse('2026-10-29T11:00:00Z'),
        tokens: 30,
      },
    ]);
  });
});

describe('usageService - claude limits', () => {
  it('reads the statusline snapshot and marks the reset five-hour window stale', async () => {
    const { limits } = byId(await usage(), 'claude');
    expect(limits).toEqual({
      fiveHour: { usedPercent: null, resetsAt: 1793271600000, windowMinutes: 300 },
      weekly: { usedPercent: 42, resetsAt: 1793700000000, windowMinutes: 10080 },
      source: 'statusline',
      asOf: 1793268000000,
    });
  });

  it('falls back to the cached utilization in .claude.json', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-cj-'));
    const claudeJson = path.join(tmp, '.claude.json');
    fs.writeFileSync(
      claudeJson,
      JSON.stringify({
        cachedUsageUtilization: {
          utilization: {
            five_hour: { utilization: 12, resets_at: '2026-10-29T14:00:00+00:00' },
            seven_day: { utilization: 83, resets_at: '2026-10-12T05:00:00+00:00' },
          },
        },
      })
    );
    const limits = await claudeLimits({ limitsFile: path.join(tmp, 'none.json'), claudeJson }, NOW);
    expect(limits).toMatchObject({
      fiveHour: { usedPercent: 12, resetsAt: Date.parse('2026-10-29T14:00:00Z') },
      weekly: { usedPercent: null },
      source: 'claude-cache',
    });
  });

  it('a plan without a 5h window (statusline has no five_hour) yields fiveHour null (#184)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-no5h-'));
    const limitsFile = path.join(tmp, 'snap.json');
    fs.writeFileSync(
      limitsFile,
      JSON.stringify({
        capturedAt: NOW,
        rate_limits: { seven_day: { used_percentage: 7, resets_at: NOW / 1000 + 3600 } },
      })
    );
    const limits = await claudeLimits({ limitsFile }, NOW);
    expect(limits.fiveHour).toBeNull();
    expect(limits.weekly).toMatchObject({ usedPercent: 7 });
  });

  it('reads live limits from the subscription endpoint: week only when the plan has no 5h window', async () => {
    let seen;
    const fetchFn = async (url, init) => {
      seen = { url, auth: init.headers.Authorization };
      return {
        ok: true,
        json: async () => ({
          five_hour: null,
          seven_day: { utilization: 27, resets_at: new Date(NOW + 86400000).toISOString() },
        }),
      };
    };
    const readOauth = async () => ({
      accessToken: 't0k',
      expiresAt: NOW + 1000,
      subscriptionType: 'max',
    });
    const limits = await claudeOauthLimits({ dir: '/x' }, NOW, { readOauth, fetchFn });
    expect(seen).toEqual({ url: 'https://api.anthropic.com/api/oauth/usage', auth: 'Bearer t0k' });
    expect(limits).toEqual({
      fiveHour: null,
      weekly: { usedPercent: 27, resetsAt: NOW + 86400000, windowMinutes: 10080 },
      source: 'oauth',
      asOf: NOW,
      plan: 'max',
    });
    expect(JSON.stringify(limits)).not.toContain('t0k');
  });

  it('skips the endpoint with an expired or missing login, or a failed response', async () => {
    const fetchFn = async () => ({ ok: false });
    const expired = async () => ({ accessToken: 'x', expiresAt: NOW - 1 });
    let called = false;
    const spy = async () => ((called = true), { ok: true, json: async () => ({}) });
    expect(await claudeOauthLimits({}, NOW, { readOauth: expired, fetchFn: spy })).toBeNull();
    expect(
      await claudeOauthLimits({}, NOW, { readOauth: async () => null, fetchFn: spy })
    ).toBeNull();
    expect(called).toBe(false);
    const ok = async () => ({ accessToken: 'x', expiresAt: NOW + 1 });
    expect(await claudeOauthLimits({}, NOW, { readOauth: ok, fetchFn })).toBeNull();
    const unknownShape = async () => ({ ok: true, json: async () => ({ limits: [] }) });
    expect(await claudeOauthLimits({}, NOW, { readOauth: ok, fetchFn: unknownShape })).toBeNull();
  });

  it('has no limits without a source', async () => {
    expect(await claudeLimits({}, NOW)).toBeNull();
  });
});

describe('usageService - helpers', () => {
  it('parses codex homes with labels, slugs and ~', () => {
    expect(parseCodexHomes('Codex A=~/.codex, Work Acct=/x/y,bad')).toEqual([
      { id: 'codex-a', label: 'Codex A', kind: 'codex', dir: path.join(os.homedir(), '.codex') },
      { id: 'work-acct', label: 'Work Acct', kind: 'codex', dir: '/x/y' },
    ]);
  });

  it('window starts at local midnight days-1 days ago', () => {
    expect(localDate(windowStart(NOW, 7))).toBe('2026-10-23');
    expect(localDate(windowStart(NOW, 1))).toBe(localDate(NOW));
  });
});

describe('usageService - router', () => {
  const handler = usageRouter.stack[0].route.stack[0].handle;
  it.each(['0', '91', 'abc', '7.5', ''])('rejects days=%s', async (days) => {
    let status;
    const res = { status: (s) => ((status = s), res), json: () => res };
    await handler({ query: { days } }, res);
    expect(status).toBe(400);
  });
});

describe('claude-rate-limits-tap.sh', () => {
  const script = path.join(__dirname, '..', 'scripts', 'claude-rate-limits-tap.sh');
  const run = (input, args, dir) =>
    spawnSync('bash', [script, ...args], {
      input,
      encoding: 'utf8',
      env: { ...process.env, HOME: dir, CLAUDE_CONFIG_DIR: dir },
    });

  it('snapshots rate_limits and passes stdin through to the wrapped command', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-tap-'));
    const input = JSON.stringify({
      model: { id: 'x' },
      rate_limits: { five_hour: { used_percentage: 5, resets_at: 1793271600 } },
    });
    const res = run(input, ['cat'], dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe(input);
    const snap = JSON.parse(fs.readFileSync(path.join(dir, 'devorbit-rate-limits.json'), 'utf8'));
    expect(snap.rate_limits).toEqual({ five_hour: { used_percentage: 5, resets_at: 1793271600 } });
    expect(Math.abs(snap.capturedAt - Date.now())).toBeLessThan(60_000);
    expect(fs.readdirSync(dir)).toEqual(['devorbit-rate-limits.json']); // no tmp leftovers
  });

  it('writes nothing without rate_limits and keeps the wrapped exit code', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-tap-'));
    const res = run('not json', ['sh', '-c', 'cat; exit 3'], dir);
    expect(res.status).toBe(3);
    expect(res.stdout).toBe('not json');
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
