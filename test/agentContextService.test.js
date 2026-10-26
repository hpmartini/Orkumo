import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// node-pty is a native module - keep it out of the unit test
vi.mock('node-pty', () => ({ spawn: vi.fn() }));

const {
  parseGithubSlug,
  parseAheadBehind,
  deriveSubagents,
  summarizeChecks,
  mapPullRequest,
  parseListeningSockets,
  parseCwds,
  dirOwnsCwd,
  resolveRepoIdentity,
  gitInfo,
  parseModelFromTranscript,
  sessionModel,
  modelFromFlags,
  transcriptCandidates,
  accumulateCacheUsage,
  contextWindowFor,
} = await import('../server/services/agentContextService.js');

describe('agentContextService - parseGithubSlug', () => {
  it.each([
    ['https://github.com/o/r.git', 'o/r'],
    ['https://github.com/o/r', 'o/r'],
    ['https://user:tok@github.com/o/r.git', 'o/r'],
    ['git@github.com:o/my.repo.git', 'o/my.repo'],
    ['ssh://git@github.com/o/r.git', 'o/r'],
    ['git@gitlab.com:o/r.git', null],
    ['', null],
    [null, null],
  ])('%s -> %s', (remote, slug) => {
    expect(parseGithubSlug(remote)).toBe(slug);
  });
});

describe('agentContextService - parseAheadBehind', () => {
  it('parses behind/ahead', () => {
    expect(parseAheadBehind('2\t5\n')).toEqual({ ahead: 5, behind: 2 });
  });
  it('defaults without upstream', () => {
    expect(parseAheadBehind(null)).toEqual({ ahead: 0, behind: 0 });
  });
});

describe('agentContextService - deriveSubagents', () => {
  it('counts unfinished agent fan entries', () => {
    const state = {
      fan: [
        { kind: 'agent', label: 'a' },
        { kind: 'agent', id: 'b', doneAt: 1 },
        { kind: 'shell' },
      ],
    };
    expect(deriveSubagents(state)).toEqual({ running: 1, total: 2, names: ['a'] });
  });
  it('falls back to inFlight kinds', () => {
    expect(deriveSubagents({ inFlight: { kinds: ['local_agent'] } }).running).toBe(1);
    expect(deriveSubagents(null)).toEqual({ running: 0, total: 0, names: [] });
  });
});

describe('agentContextService - PR mapping', () => {
  const base = {
    number: 7,
    title: 't',
    url: 'u',
    author: { login: 'me' },
    isDraft: false,
    headRefName: 'h',
    baseRefName: 'main',
    updatedAt: '2026-01-01T00:00:00Z',
    reviewDecision: '',
    mergeable: 'MERGEABLE',
  };
  it('summarizes mixed checks', () => {
    expect(
      summarizeChecks([
        { status: 'COMPLETED', conclusion: 'SUCCESS' },
        { status: 'COMPLETED', conclusion: 'SKIPPED' },
        { status: 'IN_PROGRESS', conclusion: '' },
        { state: 'FAILURE' },
        { state: 'SUCCESS' },
      ])
    ).toEqual({ ci: 'failure', ciPassed: 3, ciFailed: 1, ciPending: 1 });
    expect(summarizeChecks([]).ci).toBe('none');
    expect(summarizeChecks([{ status: 'QUEUED' }]).ci).toBe('pending');
    expect(summarizeChecks([{ state: 'PENDING' }]).ci).toBe('pending');
  });
  it('mergeReady needs non-draft, mergeable, green/no ci, no requested changes', () => {
    expect(mapPullRequest(base, 'o/r')).toMatchObject({
      author: 'me',
      reviewDecision: null,
      ci: 'none',
      mergeReady: true,
      repoSlug: 'o/r',
    });
    expect(mapPullRequest({ ...base, isDraft: true }, 'o/r').mergeReady).toBe(false);
    expect(mapPullRequest({ ...base, mergeable: 'CONFLICTING' }, 'o/r').mergeReady).toBe(false);
    expect(mapPullRequest({ ...base, reviewDecision: 'CHANGES_REQUESTED' }, 'o/r').mergeReady).toBe(
      false
    );
    expect(
      mapPullRequest({ ...base, statusCheckRollup: [{ state: 'FAILURE' }] }, 'o/r').mergeReady
    ).toBe(false);
    expect(mapPullRequest({ ...base, reviewDecision: 'REVIEW_REQUIRED' }, 'o/r').mergeReady).toBe(
      false
    );
    expect(mapPullRequest({ ...base, mergeStateStatus: 'BLOCKED' }, 'o/r').mergeReady).toBe(false);
    expect(mapPullRequest({ ...base, mergeable: 'weird' }, 'o/r').mergeable).toBe('UNKNOWN');
  });
});

describe('agentContextService - listening servers', () => {
  it('parses sockets, any local address, drops duplicates', () => {
    const out = [
      'p100',
      'cnode',
      'Lhape',
      'n*:5173',
      'n[::1]:5173',
      'n127.0.0.1:8080',
      'p200',
      'cpostgres',
      'n192.168.1.5:5432',
    ].join('\n');
    expect(parseListeningSockets(out)).toEqual([
      { pid: 100, command: 'node', port: 5173 },
      { pid: 100, command: 'node', port: 8080 },
      { pid: 200, command: 'postgres', port: 5432 },
    ]);
  });
  it('parses cwds', () => {
    const m = parseCwds('p100\nfcwd\nn/a/b\np200\nfcwd\nn/c\n');
    expect(m.get(100)).toBe('/a/b');
    expect(m.get(200)).toBe('/c');
  });
  it('matches equal or ancestor dirs only', () => {
    expect(dirOwnsCwd('/a/b', '/a/b')).toBe(true);
    expect(dirOwnsCwd('/a/b', '/a/b/c')).toBe(true);
    expect(dirOwnsCwd('/a/b', '/a/bc')).toBe(false);
    expect(dirOwnsCwd('/', '/a')).toBe(false);
  });
});

describe('agentContextService - resolveRepoIdentity', () => {
  it('main checkout keeps its own folder name', () => {
    expect(
      resolveRepoIdentity({ top: '/a/proj', gitDir: '/a/proj/.git', commonDir: '/a/proj/.git' })
    ).toEqual({ name: 'proj', isWorktree: false, worktreeName: null, worktreePath: null });
  });
  it('linked worktree resolves to the main checkout name', () => {
    expect(
      resolveRepoIdentity({
        top: '/a/proj/.claude/worktrees/feat',
        gitDir: '/a/proj/.git/worktrees/feat',
        commonDir: '/a/proj/.git',
      })
    ).toEqual({
      name: 'proj',
      isWorktree: true,
      worktreeName: 'feat',
      worktreePath: '/a/proj/.claude/worktrees/feat',
    });
  });
  it('bare repo strips the .git suffix', () => {
    expect(
      resolveRepoIdentity({
        top: '/w/feat',
        gitDir: '/r/proj.git/worktrees/feat',
        commonDir: '/r/proj.git',
      }).name
    ).toBe('proj');
  });
  it('submodule (git-dir == common-dir) is not a worktree', () => {
    const dir = '/a/proj/.git/modules/sub';
    expect(
      resolveRepoIdentity({ top: '/a/proj/sub', gitDir: dir, commonDir: dir }).isWorktree
    ).toBe(false);
  });
});

describe('agentContextService - gitInfo with a real git worktree', () => {
  it('names a linked worktree after the main repository', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devorbit-wt-')));
    try {
      const main = path.join(root, 'main-repo');
      const git = (...args) =>
        execFileSync('git', ['-C', main, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
          stdio: 'ignore',
        });
      fs.mkdirSync(main);
      git('init', '-q');
      git('commit', '-q', '--allow-empty', '-m', 'init');
      const wt = path.join(main, '.claude', 'worktrees', 'feature-x');
      git('worktree', 'add', '-q', '-b', 'feature-x', wt);

      expect(await gitInfo(main)).toMatchObject({
        name: 'main-repo',
        isWorktree: false,
        worktreeName: null,
      });
      expect(await gitInfo(wt)).toMatchObject({
        name: 'main-repo',
        isWorktree: true,
        worktreeName: 'feature-x',
        branch: 'feature-x',
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('agentContextService - parseModelFromTranscript', () => {
  const line = (o) => JSON.stringify(o);
  const asst = (model, extra = {}) => line({ type: 'assistant', message: { model }, ...extra });

  it('returns the model of the latest assistant entry (model switch mid-session)', () => {
    const text = [
      line({ type: 'user', message: { role: 'user' } }),
      asst('claude-sonnet-5-5'),
      line({ type: 'user', message: { role: 'user' } }),
      asst('claude-opus-5-5'),
      '',
    ].join('\n');
    expect(parseModelFromTranscript(text)).toBe('claude-opus-5-5');
  });
  it('skips synthetic and sub-agent entries', () => {
    const text = [
      asst('claude-opus-5-5'),
      asst('claude-haiku-5-5', { isSidechain: true }),
      asst('<synthetic>'),
    ].join('\n');
    expect(parseModelFromTranscript(text)).toBe('claude-opus-5-5');
  });
  it('tolerates a partial first line and returns null without assistant entries', () => {
    expect(parseModelFromTranscript('ial":"x"}\n' + asst('claude-sonnet-5-5'))).toBe(
      'claude-sonnet-5-5'
    );
    expect(parseModelFromTranscript('{"type":"user"}\nnot json')).toBeNull();
    expect(parseModelFromTranscript('')).toBeNull();
  });
});

describe('agentContextService - sessionModel with session data', () => {
  const asst = (model, extra = {}) =>
    JSON.stringify({ type: 'assistant', message: { model }, ...extra });
  const user = JSON.stringify({ type: 'user', message: { role: 'user' } });

  function withTranscript(lines, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-'));
    const file = path.join(dir, 'session.jsonl');
    fs.writeFileSync(file, lines.join('\n') + '\n');
    return Promise.resolve(fn(file)).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
  }
  // A session that entered a worktree: cwd's slug has no transcript, the job state's scan path does
  const session = (transcriptPath) => ({
    sessionId: 'no-such-session',
    cwd: '/nonexistent/repo',
    worktree: null,
    transcriptPath,
  });

  it('reads Opus from the scan path when the cwd slug has no transcript', () =>
    withTranscript([user, asst('claude-opus-5-5')], async (file) => {
      expect(await sessionModel(session(file))).toBe('claude-opus-5-5');
    }));
  it('reads Sonnet', () =>
    withTranscript([user, asst('claude-sonnet-5-5')], async (file) => {
      expect(await sessionModel(session(file))).toBe('claude-sonnet-5-5');
    }));
  it('follows a model switch mid-session, ignoring sub-agent turns', () =>
    withTranscript(
      [
        asst('claude-opus-5-5'),
        user,
        asst('claude-sonnet-5-5'),
        asst('claude-haiku-5-5', { isSidechain: true }),
      ],
      async (file) => {
        expect(await sessionModel(session(file))).toBe('claude-sonnet-5-5');
        // Switch back: appending changes mtime, so the cache must not hold the old model
        await new Promise((r) => setTimeout(r, 20));
        fs.appendFileSync(file, user + '\n' + asst('claude-opus-5-5') + '\n');
        expect(await sessionModel(session(file))).toBe('claude-opus-5-5');
      }
    ));
  it('returns null without any transcript, so the start flag stands in', async () => {
    expect(await sessionModel(session(null))).toBeNull();
    expect(modelFromFlags(['-n', 'x', '--effort', 'medium', '--model', 'claude-opus-5-5'])).toBe(
      'claude-opus-5-5'
    );
    expect(modelFromFlags(['--model', 'sonnet', '--model', 'opus'])).toBe('opus');
    expect(modelFromFlags(['--model'])).toBeNull();
    expect(modelFromFlags(null)).toBeNull();
  });
  it('tries the scan path before the slug guesses, without duplicates', () => {
    const files = transcriptCandidates({
      sessionId: 'abc',
      cwd: '/repo',
      worktree: '/repo/.claude/worktrees/x',
      transcriptPath: '/t/abc.jsonl',
    });
    expect(files[0]).toBe('/t/abc.jsonl');
    expect(files).toHaveLength(3);
    expect(transcriptCandidates({ sessionId: null, cwd: '/repo', transcriptPath: null })).toEqual([]);
  });
});

describe('agentContextService - prompt cache usage', () => {
  const turn = (id, ts, usage, extra = {}) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: ts,
      message: { id, model: 'claude-opus-5-5', usage },
      ...extra,
    });
  const written1h = {
    input_tokens: 2,
    cache_creation_input_tokens: 1000,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_1h_input_tokens: 1000, ephemeral_5m_input_tokens: 0 },
  };
  const read = {
    input_tokens: 2,
    cache_creation_input_tokens: 10,
    cache_read_input_tokens: 1000,
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
  };

  it('counts turns, hits and keeps the 1h TTL on read-only turns', () => {
    const text = [
      turn('a', '2026-10-23T10:00:00.000Z', written1h),
      turn('b', '2026-10-23T10:05:00.000Z', read),
    ].join('\n');
    const u = accumulateCacheUsage(null, text);
    expect(u).toMatchObject({
      turns: 2,
      hits: 1,
      ttlMs: 3_600_000,
      cachedTokens: 1012,
      readTokens: 1000,
      inputTokens: 2014,
    });
    expect(u.lastAt).toBe(Date.parse('2026-10-23T10:05:00.000Z'));
  });

  it('counts a turn split over several lines once and skips sidechains and garbage', () => {
    const text = [
      turn('a', '2026-10-23T10:00:00.000Z', read),
      turn('a', '2026-10-23T10:00:02.000Z', read),
      turn('s', '2026-10-23T10:01:00.000Z', read, { isSidechain: true }),
      '{not json',
      JSON.stringify({ type: 'user', timestamp: '2026-10-23T10:02:00.000Z', message: {} }),
    ].join('\n');
    const u = accumulateCacheUsage(null, text);
    expect(u.turns).toBe(1);
    expect(u.lastAt).toBe(Date.parse('2026-10-23T10:00:02.000Z'));
    expect(u.ttlMs).toBe(300_000);
  });

  it('accumulates across incremental chunks and picks 5m when written with 5m', () => {
    const five = {
      ...written1h,
      cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 1000 },
    };
    const first = accumulateCacheUsage(null, turn('a', '2026-10-23T10:00:00.000Z', written1h));
    const next = accumulateCacheUsage(first, turn('b', '2026-10-23T10:01:00.000Z', five));
    expect(next).toMatchObject({ turns: 2, hits: 0, ttlMs: 300_000 });
    expect(first.turns).toBe(1);
    expect(accumulateCacheUsage(null, '').turns).toBe(0);
  });

  it('derives the context window', () => {
    expect(contextWindowFor('claude-opus-5-5', 150_000)).toBe(200_000);
    expect(contextWindowFor('claude-opus-5-5[1m]', 10)).toBe(1_000_000);
    expect(contextWindowFor(null, 300_000)).toBe(1_000_000);
  });
});
