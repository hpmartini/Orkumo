import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { cloneTarget, isRepoSlug } from '../server/services/githubRepos.js';

describe('githubRepos', () => {
  it('accepts owner/name and rejects paths, options and dot names', () => {
    expect(isRepoSlug('hpmartini/Orkumo')).toBe(true);
    expect(isRepoSlug('a-b/c.d_e')).toBe(true);
    for (const bad of ['-x/y', 'a/b/c', 'a/..', 'a/.', '../x', 'a', 'a/', 'a b/c', 1])
      expect(isRepoSlug(bad)).toBe(false);
  });

  it('clones only into a scan directory, never over an existing folder', () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clone-')));
    fs.mkdirSync(path.join(root, 'taken'));
    expect(cloneTarget('o/repo', root, [root])).toBe(path.join(root, 'repo'));
    expect(() => cloneTarget('o/repo', os.tmpdir(), [root])).toThrow(/project directories/);
    expect(() => cloneTarget('o/taken', root, [root])).toThrow(/already exists/);
    expect(() => cloneTarget('o/..', root, [root])).toThrow(/owner\/name/);
    fs.rmSync(root, { recursive: true });
  });
});
