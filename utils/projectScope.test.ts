import { describe, expect, it } from 'vitest';
import { inProjectScope } from './projectScope';

describe('inProjectScope', () => {
  it('matches everything without a scope', () => {
    expect(inProjectScope('/x', undefined)).toBe(true);
    expect(inProjectScope(undefined, undefined)).toBe(true);
  });
  it('matches the project and paths below it, not siblings with the same prefix', () => {
    const paths = ['/p/Orkumo/'];
    expect(inProjectScope('/p/Orkumo', paths)).toBe(true);
    expect(inProjectScope('/p/Orkumo/.claude/worktrees/a', paths)).toBe(true);
    expect(inProjectScope('/p/OrkumoX', paths)).toBe(false);
    expect(inProjectScope(undefined, paths)).toBe(false);
  });
  it('an empty context matches nothing', () => {
    expect(inProjectScope('/p/Orkumo', [])).toBe(false);
  });
});
