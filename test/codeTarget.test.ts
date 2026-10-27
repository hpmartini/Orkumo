import { describe, it, expect } from 'vitest';
import {
  agentFolder,
  boardUrl,
  codeFolders,
  codeUrl,
  linkedAgentFolder,
} from '../utils/codeTarget';
import type { AgentContext } from '../types';

const ctx = (worktreePath: string | null) =>
  ({ repo: { worktreePath } }) as unknown as AgentContext;

describe('codeTarget', () => {
  it('codeUrl encodes the path', () => {
    expect(codeUrl('/a b/c')).toBe('/code?path=%2Fa%20b%2Fc');
  });

  it('boardUrl filters by repo and optionally by agent', () => {
    expect(boardUrl('o/r')).toBe('/board?repo=o%2Fr');
    expect(boardUrl('o/r', 'job1')).toBe('/board?repo=o%2Fr&agent=job1');
  });

  it('agentFolder prefers the worktree over the cwd', () => {
    expect(agentFolder({ cwd: '/r/.claude/worktrees/x/sub' }, ctx('/r/.claude/worktrees/x'))).toBe(
      '/r/.claude/worktrees/x'
    );
    expect(agentFolder({ cwd: '/r' }, ctx(null))).toBe('/r');
    expect(agentFolder(undefined)).toBeNull();
  });

  it('linkedAgentFolder takes the first known agent', () => {
    const sessions = new Map([['b', { cwd: '/b' }]]);
    expect(linkedAgentFolder(['gone', 'b'], sessions)).toBe('/b');
    expect(linkedAgentFolder(['gone'], sessions)).toBeNull();
    expect(linkedAgentFolder(['b'], sessions, { b: ctx('/b/wt') })).toBe('/b/wt');
  });

  it('codeFolders lists projects first, one entry per path, no archived apps', () => {
    const folders = codeFolders(
      [
        { name: 'Zeta', path: '/z' },
        { name: 'Old', path: '/o', isArchived: true },
      ],
      [
        { name: 'z', path: '/z' },
        { name: 'wt', path: '/z/.claude/worktrees/wt' },
        { name: 'alpha', path: '/a' },
      ]
    );
    expect(folders.map((f) => [f.group, f.name])).toEqual([
      ['Projects', 'Zeta'],
      ['Worktrees & agents', 'alpha'],
      ['Worktrees & agents', 'wt'],
    ]);
  });
});
