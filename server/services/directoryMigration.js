import fs from 'fs';
import { getConfig, updateConfig, canonicalDir } from './configService.js';
import { getDataFilePath } from './dataPath.js';
import { scanAllDirectories, generateProjectId } from './scannerService.js';

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Old -> new project IDs for every path under a renamed root.
 * @param {string[]} paths project paths in canonical spelling
 * @param {Array<[string, string]>} renames [stored, canonical] root pairs
 */
export function buildIdRemap(paths, renames, genId = generateProjectId) {
  const pairs = [];
  for (const p of paths) {
    for (const [stored, canonical] of renames) {
      if (p !== canonical && !p.startsWith(`${canonical}/`)) continue;
      pairs.push([genId(stored + p.slice(canonical.length)), genId(p)]);
      break;
    }
  }
  return pairs;
}

/** Rewrite IDs and root prefixes in raw settings JSON (covers nested, string-encoded UI state too). */
export function rewriteSettingsText(text, renames, idPairs) {
  let out = text;
  for (const [oldId, newId] of idPairs) out = out.replaceAll(oldId, newId);
  for (const [stored, canonical] of renames) {
    out = out.replace(new RegExp(`${escapeRegExp(stored)}(?=[/"\\\\])`, 'g'), canonical);
  }
  return out;
}

/**
 * One-time heal of project directories stored in a non-canonical spelling (e.g. `/Users/x/projects`
 * for `/Users/x/PROJECTS`). Project IDs are sha256(path), so settings referencing the old IDs
 * (contexts, favorites, archive, custom ports...) are remapped. Backs up both files first.
 */
export function migrateDirectorySpelling() {
  const config = getConfig();
  const renames = (config.directories || [])
    .map((dir) => [dir, canonicalDir(dir)])
    .filter(([stored, canonical]) => stored !== canonical);
  if (renames.length === 0) return { migrated: false };

  const configFile = getDataFilePath('config.json');
  const settingsFile = getDataFilePath('settings.json');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const file of [configFile, settingsFile]) {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-${stamp}`);
  }

  const canonicalOf = new Map(renames);
  updateConfig({
    directories: [...new Set(config.directories.map((d) => canonicalOf.get(d) ?? d))],
  });

  const idPairs = buildIdRemap(
    scanAllDirectories().map((a) => a.path),
    renames
  );
  if (fs.existsSync(settingsFile)) {
    const text = fs.readFileSync(settingsFile, 'utf-8');
    fs.writeFileSync(settingsFile, rewriteSettingsText(text, renames, idPairs));
  }
  console.log(
    `[Config] Canonicalized ${renames.map(([s, c]) => `${s} -> ${c}`).join(', ')}; ` +
      `remapped ${idPairs.length} project IDs (backup suffix .bak-${stamp})`
  );
  return { migrated: true, renames, idPairs };
}
