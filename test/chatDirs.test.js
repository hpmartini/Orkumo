import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chatDirs } from '../server/services/chatStatus.js';

describe('chatDirs: path completion for /cd', () => {
  let home;
  beforeAll(() => {
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dirs-')));
    for (const d of ['Music', 'MAPLE/system', 'Movies', '.hidden', 'proj'])
      fs.mkdirSync(path.join(home, d), { recursive: true });
    fs.writeFileSync(path.join(home, 'Makefile'), '');
    fs.symlinkSync(path.join(home, 'Music'), path.join(home, 'MusicLink'));
  });
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

  it('lists matching directories as whole arguments, case-insensitive, no files, no dot dirs', async () => {
    expect(await chatDirs(home, '~/m', home)).toEqual([
      '~/MAPLE/',
      '~/Movies/',
      '~/Music/',
      '~/MusicLink/',
    ]);
    expect(await chatDirs(home, '~/.', home)).toEqual(['~/.hidden/']);
  });

  it('walks into a directory and resolves relative paths from the cwd', async () => {
    expect(await chatDirs(home, '~/MAPLE/', home)).toEqual(['~/MAPLE/system/']);
    expect(await chatDirs(path.join(home, 'proj'), '../MA', home)).toEqual(['../MAPLE/']);
  });

  it('lists nothing outside the home directory or for a missing one', async () => {
    expect(await chatDirs(home, '/', home)).toEqual([]);
    expect(await chatDirs(home, '../', home)).toEqual([]);
    expect(await chatDirs(home, '~/nope/', home)).toEqual([]);
  });
});
