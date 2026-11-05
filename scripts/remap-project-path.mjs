#!/usr/bin/env node
// Rewrites Orkumo's stored settings after a project folder moved (issue #196): project IDs are
// sha256(path), so contexts, favorites, archive and ports keyed by the old path would be orphaned.
// Backs up each file first. Usage: remap-project-path.mjs [--dry-run] <old-root> <new-root> <data-dir>...
import fs from 'node:fs';
import path from 'node:path';
import { buildIdRemap, rewriteSettingsText } from '../server/services/directoryMigration.js';

const args = process.argv.slice(2);
const dry = args[0] === '--dry-run';
if (dry) args.shift();
const [oldRoot, newRoot, ...dataDirs] = args;
if (!oldRoot || !newRoot || dataDirs.length === 0) {
  console.error('usage: remap-project-path.mjs [--dry-run] <old-root> <new-root> <data-dir>...');
  process.exit(2);
}

// Every directory a project could live in (scanner depth); IDs that occur nowhere are no-ops.
const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'dist-landing', 'coverage']);
function dirsUnder(root, depth) {
  const out = [root];
  if (depth === 0 || !fs.existsSync(root)) return out;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.isDirectory() && !SKIP.has(e.name)) out.push(...dirsUnder(path.join(root, e.name), depth - 1));
  }
  return out;
}

const renames = [[oldRoot, newRoot]];
// Before the move (dry run) the tree still sits at the old root.
const base = fs.existsSync(newRoot) ? newRoot : oldRoot;
const paths = dirsUnder(base, 4).map((p) => newRoot + p.slice(base.length));
const idPairs = buildIdRemap(paths, renames);
if (dry) console.log(`${idPairs.length} candidate project IDs under ${newRoot}`);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
for (const dir of dataDirs) {
  for (const name of ['settings.json', 'config.json']) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const next = rewriteSettingsText(text, renames, idPairs);
    if (next === text) continue;
    if (dry) {
      const ids = idPairs.filter(([oldId]) => text.includes(oldId)).length;
      console.log(`would: rewrite ${file} (${ids} project IDs, old root occurs ${text.split(oldRoot).length - 1}x)`);
      continue;
    }
    fs.copyFileSync(file, `${file}.bak-${stamp}`);
    fs.writeFileSync(file, next);
    console.log(`+ ${file}: ${oldRoot} -> ${newRoot} (backup .bak-${stamp})`);
  }
}
