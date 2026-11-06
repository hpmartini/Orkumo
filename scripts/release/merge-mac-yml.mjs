#!/usr/bin/env node
// Merges the <channel>-mac.yml files of the arm64 and x64 builds into one (#126).
// electron-updater's MacUpdater picks its zip from `files` by "arm64" in the name, so both must be listed.
// Usage: merge-mac-yml.mjs <out.yml> <in.yml>...
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';

export function mergeMacYml(docs) {
  if (docs.length === 0) throw new Error('no input');
  const versions = new Set(docs.map((d) => d.version));
  if (versions.size !== 1) throw new Error(`version mismatch: ${[...versions].join(', ')}`);
  const files = [];
  for (const doc of docs) {
    for (const file of doc.files ?? []) {
      if (!files.some((f) => f.url === file.url)) files.push(file);
    }
  }
  const zips = files.filter((f) => f.url.endsWith('.zip'));
  if (!zips.some((f) => f.url.includes('arm64')) || !zips.some((f) => !f.url.includes('arm64'))) {
    throw new Error(`need an arm64 and an x64 zip, got: ${files.map((f) => f.url).join(', ')}`);
  }
  // legacy top-level path/sha512 (old updaters): the x64 zip, as a single-arch x64 build writes it
  const legacy = zips.find((f) => !f.url.includes('arm64'));
  const releaseDate = docs
    .map((d) => d.releaseDate)
    .filter(Boolean)
    .sort()
    .at(-1);
  return { ...docs[0], files, path: legacy.url, sha512: legacy.sha512, releaseDate };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [out, ...inputs] = process.argv.slice(2);
  if (!out || inputs.length === 0) {
    console.error('usage: merge-mac-yml.mjs <out.yml> <in.yml>...');
    process.exit(2);
  }
  const merged = mergeMacYml(inputs.map((f) => yaml.load(fs.readFileSync(f, 'utf8'))));
  fs.writeFileSync(out, yaml.dump(merged, { lineWidth: -1 }));
  console.log(`${out}: ${merged.files.map((f) => f.url).join(', ')}`);
}
