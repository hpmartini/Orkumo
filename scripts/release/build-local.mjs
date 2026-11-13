#!/usr/bin/env node
// electron-builder for local builds (`bun run electron:build*`), stamped `<version>-rc.<N>.dev.<sha>` with N the
// highest rc known (GitHub releases, drafts included, and git tags): semver puts that above `-rc.N` and below
// `-rc.N+1`, so an installed local build is offered the next GitHub release (electron/updater.js) and never an
// older one (a plain `-dev.<sha>` ranked below every rc and was "updated" back to an old release).
// CI stamps `-rc.N` from the tag instead (.woodpecker/release-*.yml).
// The version goes in via extraMetadata, so package.json is never rewritten.
// Usage: build-local.mjs <electron-builder args>...
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function devVersion(pkgVersion, sha, latestRc = 0) {
  const base = String(pkgVersion).split(/[-+]/)[0];
  const id = String(sha || 'local').toLowerCase();
  // semver forbids leading zeros in numeric identifiers, so an all-digit sha gets a letter
  const shaId = /^\d+$/.test(id) ? `g${id}` : id;
  return `${base}-rc.${Math.max(0, Number(latestRc) || 0)}.dev.${shaId}`;
}

/** Highest N of `v<base>-rc.N` among `names` (tags or release names); 0 without any */
export function latestRcOf(base, names) {
  const re = new RegExp(`^v?${base.replace(/\./g, '\\.')}-rc\\.(\\d+)$`);
  let max = 0;
  for (const name of names) {
    const m = re.exec(String(name).trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

const run = (cmd, args, cwd) => {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const base = String(version).split(/[-+]/)[0];
  // Best effort: offline the git tags still name every published rc
  const names = [
    ...run('git', ['tag', '--list', `v${base}-rc.*`], root).split('\n'),
    ...run('gh', ['release', 'list', '--limit', '100', '--json', 'tagName', '--jq', '.[].tagName'], root).split('\n'),
  ];
  const sha = run('git', ['rev-parse', '--short=7', 'HEAD'], root).trim();
  const stamped = devVersion(version, sha, latestRcOf(base, names));
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
