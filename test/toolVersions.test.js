import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { projectNodeVersion } from '../server/services/toolVersionsService.js';

const project = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
};

describe('projectNodeVersion', () => {
  it('reads .nvmrc first, without the v prefix', async () => {
    const dir = project({
      '.nvmrc': 'v20.11.1\n',
      '.node-version': '18',
      'package.json': '{"engines":{"node":">=16"}}',
    });
    expect(await projectNodeVersion(dir)).toEqual({ version: '20.11.1', source: '.nvmrc' });
  });
  it('falls back to .node-version, then engines.node', async () => {
    expect(await projectNodeVersion(project({ '.node-version': '22' }))).toEqual({
      version: '22',
      source: '.node-version',
    });
    expect(
      await projectNodeVersion(project({ 'package.json': '{"engines":{"node":">=18"}}' }))
    ).toEqual({
      version: '>=18',
      source: 'engines',
    });
  });
  it('is null for an unpinned project or invalid package.json', async () => {
    expect(await projectNodeVersion(project({ 'package.json': '{' }))).toBeNull();
    expect(await projectNodeVersion(project({ '.nvmrc': '  \n' }))).toBeNull();
  });
});
