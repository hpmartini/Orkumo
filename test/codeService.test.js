import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isWithinRoots, resolveAllowedFolder } from '../server/services/codeService.js';

describe('codeService - isWithinRoots', () => {
  it.each([
    ['/p/repo', ['/p/repo'], true],
    ['/p/repo/.claude/worktrees/x', ['/p/repo'], true],
    ['/p/repox', ['/p/repo'], false],
    ['/p', ['/p/repo'], false],
    ['/etc', ['/p/repo', '/q'], false],
  ])('%s in %j -> %s', (target, roots, expected) => {
    expect(isWithinRoots(target, roots)).toBe(expected);
  });
});

describe('codeService - resolveAllowedFolder', () => {
  let tmp;
  let root;
  let outside;
  beforeAll(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-mode-')));
    root = path.join(tmp, 'projects');
    outside = path.join(tmp, 'secret');
    fs.mkdirSync(path.join(root, 'app', 'src'), { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(root, 'app', 'file.txt'), '');
    fs.symlinkSync(outside, path.join(root, 'escape'));
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('allows a root and folders below it', async () => {
    expect(await resolveAllowedFolder(root, [root])).toBe(root);
    expect(await resolveAllowedFolder(path.join(root, 'app', 'src'), [root])).toBe(
      path.join(root, 'app', 'src')
    );
  });

  it('rejects folders outside, traversal, symlink escapes, files and relative paths', async () => {
    expect(await resolveAllowedFolder(outside, [root])).toBeNull();
    expect(await resolveAllowedFolder(path.join(root, '..', 'secret'), [root])).toBeNull();
    expect(await resolveAllowedFolder(path.join(root, 'escape'), [root])).toBeNull();
    expect(await resolveAllowedFolder(path.join(root, 'app', 'file.txt'), [root])).toBeNull();
    expect(await resolveAllowedFolder('projects/app', [root])).toBeNull();
    expect(await resolveAllowedFolder(undefined, [root])).toBeNull();
    expect(await resolveAllowedFolder(path.join(root, 'missing'), [root])).toBeNull();
  });

  it('opens an exact folder (agent cwd) but not its subfolders', async () => {
    expect(await resolveAllowedFolder(tmp, [], [tmp])).toBe(tmp);
    expect(await resolveAllowedFolder(outside, [], [tmp])).toBeNull();
  });
});
