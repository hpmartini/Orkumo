import { describe, it, expect } from 'vitest';
import { contextRoot, groupByRoot, projectRoot, shortPath } from '../utils/projectDirs';

const dirs = ['/Users/x/PROJECTS', '/Users/x/WEBSITES', '/Users/x/PROJECTS/sub'];
const apps = [
  { id: 'a', path: '/Users/x/PROJECTS/a' },
  { id: 'b', path: '/Users/x/WEBSITES/b' },
  { id: 'c', path: '/Users/x/WEBSITES/c' },
  { id: 'd', path: '/Users/x/.claude' },
  { id: 'e', path: '/Users/x/PROJECTS/sub/e' },
];

describe('projectRoot', () => {
  it('picks the most specific configured dir, case-insensitively', () => {
    expect(projectRoot('/Users/x/projects/sub/e', dirs)).toBe('/Users/x/PROJECTS/sub');
    expect(projectRoot('/Users/x/PROJECTSX/a', dirs)).toBeNull();
  });
});

describe('shortPath', () => {
  it('is relative to the root, or home-abbreviated without one', () => {
    expect(shortPath('/Users/x/WEBSITES/b', '/Users/x/WEBSITES')).toBe('b');
    expect(shortPath('/Users/x/.claude', null)).toBe('~/.claude');
  });
});

describe('groupByRoot', () => {
  it('clusters in configured order and puts paths outside every root last', () => {
    const groups = groupByRoot(apps, (a) => projectRoot(a.path, dirs), dirs);
    expect(groups.map((g) => [g.root, g.items.map((a) => a.id)])).toEqual([
      ['/Users/x/PROJECTS', ['a']],
      ['/Users/x/WEBSITES', ['b', 'c']],
      ['/Users/x/PROJECTS/sub', ['e']],
      [null, ['d']],
    ]);
  });
});

describe('contextRoot', () => {
  it('is the root holding most member projects', () => {
    expect(contextRoot(['a', 'b', 'c', 'd'], apps, dirs)).toBe('/Users/x/WEBSITES');
    expect(contextRoot(['a', 'b'], apps, dirs)).toBe('/Users/x/PROJECTS');
  });

  it('is null for the all context and for contexts without known projects', () => {
    expect(contextRoot(null, apps, dirs)).toBeNull();
    expect(contextRoot(['d', 'gone'], apps, dirs)).toBeNull();
  });
});
