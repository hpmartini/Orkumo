#!/usr/bin/env node
// electron-builder for local builds (`bun run electron:build*`), stamped `<version>-dev.<sha>`: below every
// `-rc.N` of the same version, so an installed local build is offered the next GitHub release
// (electron/updater.js). CI stamps `-rc.N` from the tag instead (.woodpecker/release-*.yml).
// The version goes in via extraMetadata, so package.json is never rewritten.
// Usage: build-local.mjs <electron-builder args>...
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function devVersion(pkgVersion, sha) {
  const base = String(pkgVersion).split(/[-+]/)[0];
  const id = String(sha || 'local').toLowerCase();
  // semver forbids leading zeros in numeric identifiers, so an all-digit sha gets a letter
  return `${base}-dev.${/^\d+$/.test(id) ? `g${id}` : id}`;
}

function shortSha(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'local';
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const stamped = devVersion(version, shortSha(root));
  console.log(`[build-local] version ${stamped}`);
  const { status, error } = spawnSync(
    'electron-builder',
    [`-c.extraMetadata.version=${stamped}`, ...process.argv.slice(2)],
    { cwd: root, stdio: 'inherit' }
  );
  if (error) {
    console.error(`[build-local] cannot start electron-builder: ${error.message}`);
    process.exit(1);
  }
  process.exit(status ?? 1);
}
