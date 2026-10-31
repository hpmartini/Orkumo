import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';

const root = resolve(__dirname, '..');

function serverFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : serverFiles(p);
    return e.name.endsWith('.js') && !e.name.includes('.test.') ? [p] : [];
  });
}

describe('Dockerfile.api', () => {
  // The API image copies only server/ plus listed shared modules; a missing one crashes the container on start.
  it('copies every module the server imports from outside server/', () => {
    const dockerfile = readFileSync(join(root, 'Dockerfile.api'), 'utf8');
    const outside = new Set();
    for (const file of serverFiles(join(root, 'server'))) {
      for (const [, spec] of readFileSync(file, 'utf8').matchAll(/from '(\.[^']+)'/g)) {
        const target = relative(root, resolve(dirname(file), spec));
        if (!target.startsWith('server/') && !target.startsWith('..')) outside.add(target);
      }
    }
    expect(outside.size).toBeGreaterThan(0);
    for (const target of outside) expect(dockerfile, target).toContain(target);
  });
});
