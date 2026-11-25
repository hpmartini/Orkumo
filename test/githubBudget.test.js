import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFile } from 'child_process';

vi.mock('child_process', () => {
  const execFile = vi.fn();
  return { execFile, default: { execFile } };
});
// node-pty is a native module - keep it out of the unit test
vi.mock('node-pty', () => ({ spawn: vi.fn() }));

const {
  MIN_BACKOFF_MS,
  MAX_BACKOFF_MS,
  noteRateLimit,
  noteSuccess,
  limitedUntil,
  resetRateLimits,
  githubPolling,
  restGet,
  clearEtagCache,
} = await import('../server/services/githubApi.js');
const { ghInfo } = await import('../server/services/agentContextService.js');

/** `gh api -i` stand-in: `route(path)` -> { status, etag?, body?, headers? }; 304 when the ETag matches */
function ghApi(route) {
  const calls = [];
  vi.mocked(execFile).mockImplementation((cmd, args, _opts, cb) => {
    const path = args[args.length - 1];
    const sent = args.find((a) => String(a).startsWith('If-None-Match: '))?.slice(15) ?? null;
    calls.push({ path, etag: sent });
    let r = route(path);
    if (r.etag && sent === r.etag) r = { status: 304, etag: r.etag };
    const head = [
      `HTTP/2.0 ${r.status} X`,
      ...(r.etag ? [`Etag: ${r.etag}`] : []),
      ...Object.entries(r.headers || {}).map(([k, v]) => `${k}: ${v}`),
    ].join('\r\n');
    const out = `${head}\r\n\r\n${r.body === undefined ? '' : JSON.stringify(r.body)}`;
    if (r.status >= 300)
      cb(Object.assign(new Error('exit 1'), { code: 1 }), out, `gh: HTTP ${r.status}`);
    else cb(null, out, '');
  });
  return calls;
}

const pull = (n, over = {}) => ({
  number: n,
  title: `PR ${n}`,
  html_url: `https://github.com/o/r/pull/${n}`,
  user: { login: 'me' },
  draft: false,
  head: { ref: `feat/${n}`, sha: `sha${n}` },
  base: { ref: 'main' },
  updated_at: '2026-11-25T10:00:00Z',
  requested_reviewers: [],
  requested_teams: [],
  ...over,
});

beforeEach(() => {
  resetRateLimits();
  clearEtagCache();
  vi.mocked(execFile).mockReset();
  process.env.ORKUMO_GITHUB_POLL = '1';
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.ORKUMO_GITHUB_POLL;
});

describe('githubApi - rate-limit backoff', () => {
  it('pauses at least 120 s, doubles per hit up to 30 min, and a success ends the escalation', () => {
    let now = 1_000_000;
    const waits = [];
    for (let i = 0; i < 6; i++) {
      waits.push(noteRateLimit('graphql', { now }) - now);
      now += waits.at(-1) + 1;
    }
    expect(waits[0]).toBe(MIN_BACKOFF_MS);
    expect(waits.slice(0, 5)).toEqual([120_000, 240_000, 480_000, 960_000, 1_800_000]);
    expect(waits[5]).toBe(MAX_BACKOFF_MS);
    noteSuccess('graphql');
    expect(noteRateLimit('graphql', { now }) - now).toBe(MIN_BACKOFF_MS);
    // the REST budget is counted apart
    expect(limitedUntil('rest', now)).toBe(0);
  });

  it('a hit during the pause does not escalate (calls already in flight)', () => {
    const until = noteRateLimit('graphql', { now: 0 });
    expect(noteRateLimit('graphql', { now: 1_000 })).toBe(until);
    expect(noteRateLimit('graphql', { now: until + 1 }) - (until + 1)).toBe(2 * MIN_BACKOFF_MS);
  });

  it('a success in flight during the pause keeps the escalation', () => {
    const until = noteRateLimit('graphql', { now: Date.now() });
    noteSuccess('graphql');
    expect(noteRateLimit('graphql', { now: until + 1 }) - (until + 1)).toBe(2 * MIN_BACKOFF_MS);
  });
});

describe('githubApi - polling switch', () => {
  it('follows ORKUMO_GITHUB_POLL; unset, only production servers poll', () => {
    expect(githubPolling({ ORKUMO_GITHUB_POLL: '0', NODE_ENV: 'production' })).toBe(false);
    expect(githubPolling({ ORKUMO_GITHUB_POLL: '1' })).toBe(true);
    expect(githubPolling({ NODE_ENV: 'production' })).toBe(true);
    expect(githubPolling({ NODE_ENV: 'development' })).toBe(false);
    expect(githubPolling({})).toBe(false);
  });
});

describe('githubApi - conditional REST GET', () => {
  it('sends the last ETag and answers a 304 from the remembered data', async () => {
    const calls = ghApi(() => ({ status: 200, etag: 'W/"a"', body: [{ id: 1 }] }));
    expect(await restGet('repos/o/r/pulls')).toEqual([{ id: 1 }]);
    expect(await restGet('repos/o/r/pulls')).toEqual([{ id: 1 }]);
    expect(calls).toEqual([
      { path: 'repos/o/r/pulls', etag: null },
      { path: 'repos/o/r/pulls', etag: 'W/"a"' },
    ]);
  });

  it('a rate-limit answer pauses REST reads: no request until the backoff ends', async () => {
    const calls = ghApi(() => ({
      status: 403,
      headers: { 'X-Ratelimit-Remaining': '0' },
      body: { message: 'API rate limit exceeded for user ID 1.' },
    }));
    await expect(restGet('repos/o/r/issues')).rejects.toMatchObject({ rateLimited: true });
    await expect(restGet('repos/o/r/issues')).rejects.toMatchObject({ rateLimited: true });
    expect(calls).toHaveLength(1);
    expect(limitedUntil('rest')).toBeGreaterThanOrEqual(Date.now() + MIN_BACKOFF_MS - 1_000);
  });

  it('a secondary rate limit (429 with retry-after) waits the longer of both', async () => {
    ghApi(() => ({
      status: 429,
      headers: { 'Retry-After': '600' },
      body: { message: 'You have exceeded a secondary rate limit.' },
    }));
    await expect(restGet('repos/o/r/issues')).rejects.toMatchObject({ rateLimited: true });
    expect(limitedUntil('rest')).toBeGreaterThanOrEqual(Date.now() + 590_000);
  });
});

describe('agentContextService - PRs and issues over REST with ETags', () => {
  const routes = (state) => (path) => {
    if (path.includes('/pulls?'))
      return { status: 200, etag: `"l${state.list}"`, body: state.pulls };
    if (path.includes('/issues?'))
      return { status: 200, etag: '"i"', body: [{ number: 9 }, { number: 3, pull_request: {} }] };
    if (/\/pulls\/\d+\/reviews/.test(path)) {
      if (state.reviewsFail) return { status: 500, body: { message: 'boom' } };
      return { status: 200, etag: `"rv${state.reviews.length}"`, body: state.reviews };
    }
    if (/\/pulls\/\d+$/.test(path))
      return { status: 200, etag: '"d"', body: { mergeable: true, mergeable_state: 'clean' } };
    if (path.includes('/status?')) {
      if (state.ciFail) return { status: 502, body: { message: 'Bad gateway' } };
      return { status: 200, etag: `"s${state.ci}"`, body: { statuses: [{ state: state.ci }] } };
    }
    if (path.includes('/check-runs')) return { status: 200, etag: '"c"', body: { check_runs: [] } };
    throw new Error(`unexpected ${path}`);
  };

  it('maps REST pulls to AgentPullRequest and counts issues without PRs', async () => {
    const bot = pull(2, { user: { login: 'dependabot[bot]', type: 'Bot' } });
    const state = { list: 1, pulls: [pull(1), bot], reviews: [], ci: 'success' };
    ghApi(routes(state));
    const info = await ghInfo('o/rest-map');
    expect(info.issues).toEqual({ open: 1, url: 'https://github.com/o/rest-map/issues' });
    expect(info.pulls.items[0]).toMatchObject({
      number: 1,
      url: 'https://github.com/o/r/pull/1',
      author: 'me',
      headRef: 'feat/1',
      baseRef: 'main',
      mergeable: 'MERGEABLE',
      ci: 'success',
      ciPassed: 1,
      reviewDecision: null,
      mergeReady: true,
      repoSlug: 'o/rest-map',
    });
    // as gh named them: the PR view's author filter keeps working
    expect(info.pulls.items[1].author).toBe('app/dependabot');
  });

  it('derives the review decision from the latest review per reviewer: changes requested wins', async () => {
    const state = {
      list: 1,
      pulls: [pull(1)],
      reviews: [
        { user: { login: 'a' }, state: 'CHANGES_REQUESTED' },
        { user: { login: 'b' }, state: 'APPROVED' },
        { user: { login: 'a' }, state: 'COMMENTED' },
      ],
      ci: 'success',
    };
    ghApi(routes(state));
    const info = await ghInfo('o/rest-review');
    expect(info.pulls.items[0]).toMatchObject({
      reviewDecision: 'CHANGES_REQUESTED',
      mergeReady: false,
    });
  });

  it('an unchanged PR with finished CI costs only the two 304 list reads on the next poll', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const state = { list: 1, pulls: [pull(1)], reviews: [], ci: 'success' };
    const calls = ghApi(routes(state));
    await ghInfo('o/rest-quiet');
    calls.length = 0;
    vi.setSystemTime(1_000_000 + 61_000);
    const info = await ghInfo('o/rest-quiet');
    expect(calls.map((c) => c.path).sort()).toEqual([
      'repos/o/rest-quiet/issues?state=open&per_page=100',
      'repos/o/rest-quiet/pulls?state=open&per_page=100',
    ]);
    expect(calls.every((c) => c.etag)).toBe(true);
    expect(info.pulls.items[0].ci).toBe('success');
  });

  it('pending CI is re-read until it finishes; a new head re-reads the PR', async () => {
    vi.useFakeTimers({ now: 2_000_000 });
    const state = { list: 1, pulls: [pull(1)], reviews: [], ci: 'pending' };
    const calls = ghApi(routes(state));
    expect((await ghInfo('o/rest-ci')).pulls.items[0].ci).toBe('pending');
    state.ci = 'failure';
    calls.length = 0;
    vi.setSystemTime(2_000_000 + 61_000);
    expect((await ghInfo('o/rest-ci')).pulls.items[0].ci).toBe('failure');
    expect(calls.some((c) => c.path.includes('/commits/sha1/status?'))).toBe(true);

    state.list = 2;
    state.pulls = [
      pull(1, { head: { ref: 'feat/1', sha: 'sha1b' }, updated_at: '2026-11-25T11:00:00Z' }),
    ];
    state.ci = 'success';
    calls.length = 0;
    vi.setSystemTime(2_000_000 + 122_000);
    expect((await ghInfo('o/rest-ci')).pulls.items[0].ci).toBe('success');
    expect(calls.map((c) => c.path)).toEqual(
      expect.arrayContaining([
        'repos/o/rest-ci/pulls/1',
        'repos/o/rest-ci/commits/sha1b/status?per_page=100',
      ])
    );
  });

  it('in the rate limit: keeps the last data and sends nothing until the backoff ends', async () => {
    vi.useFakeTimers({ now: 3_000_000 });
    const state = { list: 1, pulls: [pull(1)], reviews: [], ci: 'success' };
    let limited = false;
    const calls = ghApi((path) =>
      limited
        ? {
            status: 403,
            headers: { 'X-Ratelimit-Remaining': '0' },
            body: { message: 'API rate limit exceeded' },
          }
        : routes(state)(path)
    );
    await ghInfo('o/rest-limit');
    limited = true;
    vi.setSystemTime(3_000_000 + 61_000);
    expect((await ghInfo('o/rest-limit')).pulls.items[0].number).toBe(1);
    const sent = calls.length;
    // the pause (120 s from the limit at +61 s) spans the next polls: nothing is sent
    for (const step of [10_000, 20_000, 61_000]) {
      vi.setSystemTime(Date.now() + step);
      expect((await ghInfo('o/rest-limit')).pulls.items[0].number).toBe(1);
    }
    expect(calls.length).toBe(sent);
    vi.setSystemTime(Date.now() + 61_000);
    await ghInfo('o/rest-limit');
    expect(calls.length).toBeGreaterThan(sent);
  });

  it('with polling off, no GitHub call', async () => {
    process.env.ORKUMO_GITHUB_POLL = '0';
    const calls = ghApi(() => ({ status: 200, body: [] }));
    expect(await ghInfo('o/rest-off')).toEqual({ issues: null, pulls: null });
    expect(calls).toHaveLength(0);
  });

  it('CI that could not be read counts as pending, never as "no CI" (not merge-ready)', async () => {
    const state = { list: 1, pulls: [pull(1)], reviews: [], ci: 'success', ciFail: true };
    ghApi(routes(state));
    expect((await ghInfo('o/rest-ci-fail')).pulls.items[0]).toMatchObject({
      ci: 'pending',
      mergeReady: false,
    });
  });

  it('a failed review read is retried with the next detail refresh', async () => {
    vi.useFakeTimers({ now: 4_000_000 });
    const state = {
      list: 1,
      pulls: [pull(1)],
      reviews: [{ user: { login: 'a' }, state: 'CHANGES_REQUESTED' }],
      ci: 'success',
      reviewsFail: true,
    };
    ghApi(routes(state));
    expect((await ghInfo('o/rest-review-retry')).pulls.items[0].reviewDecision).toBe(null);
    state.reviewsFail = false;
    vi.setSystemTime(4_000_000 + 5 * 60_000 + 1);
    expect((await ghInfo('o/rest-review-retry')).pulls.items[0].reviewDecision).toBe(
      'CHANGES_REQUESTED'
    );
  });
});
