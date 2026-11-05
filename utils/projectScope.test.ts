import { describe, expect, it } from 'vitest';
import { inProjectScope } from './projectScope';

describe('inProjectScope', () => {
  it('matches everything without a scope', () => {
    expect(inProjectScope('/x', undefined)).toBe(true);
    expect(inProjectScope(undefined, undefined)).toBe(true);
  });
  it('matches the project and paths below it, not siblings with the same prefix', () => {
    const paths = ['/p/DevHub/'];
    expect(inProjectScope('/p/DevHub', paths)).toBe(true);
    expect(inProjectScope('/p/DevHub/.claude/worktrees/a', paths)).toBe(true);
    expect(inProjectScope('/p/DevHubX', paths)).toBe(false);
    expect(inProjectScope(undefined, paths)).toBe(false);
  });
  it('an empty context matches nothing', () => {
    expect(inProjectScope('/p/DevHub', [])).toBe(false);
  });
});
