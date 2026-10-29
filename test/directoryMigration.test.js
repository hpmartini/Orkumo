import { describe, it, expect } from 'vitest';
import { buildIdRemap, rewriteSettingsText } from '../server/services/directoryMigration.js';

const genId = (p) => `id(${p})`;
const renames = [['/Users/x/projects', '/Users/x/PROJECTS']];

describe('buildIdRemap', () => {
  it('maps IDs of paths under a renamed root from the stored to the canonical spelling', () => {
    const pairs = buildIdRemap(
      ['/Users/x/PROJECTS/a', '/Users/x/PROJECTS', '/Users/x/WEBSITES/b', '/Users/x/PROJECTSX/c'],
      renames,
      genId
    );
    expect(pairs).toEqual([
      ['id(/Users/x/projects/a)', 'id(/Users/x/PROJECTS/a)'],
      ['id(/Users/x/projects)', 'id(/Users/x/PROJECTS)'],
    ]);
  });
});

describe('rewriteSettingsText', () => {
  it('replaces IDs and root prefixes, also inside string-encoded JSON', () => {
    const text = JSON.stringify({
      favorites: ['old1'],
      contexts: [{ appIds: ['old1', 'keep'] }],
      ui: JSON.stringify({ collapsed: ['project:dir:/Users/x/projects/a'] }),
      other: '/Users/x/projectsX',
    });
    const out = JSON.parse(rewriteSettingsText(text, renames, [['old1', 'new1']]));
    expect(out.favorites).toEqual(['new1']);
    expect(out.contexts[0].appIds).toEqual(['new1', 'keep']);
    expect(JSON.parse(out.ui).collapsed).toEqual(['project:dir:/Users/x/PROJECTS/a']);
    expect(out.other).toBe('/Users/x/projectsX');
  });
});
