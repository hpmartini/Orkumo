import { describe, it, expect, vi } from 'vitest';

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
