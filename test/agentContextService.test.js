import { describe, it, expect, vi } from 'vitest';

// node-pty is a native module - keep it out of the unit test
vi.mock('node-pty', () => ({ spawn: vi.fn() }));

const { parseGithubSlug, parseAheadBehind, deriveSubagents } =
  await import('../server/services/agentContextService.js');

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
