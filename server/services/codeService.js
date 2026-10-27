/**
 * Code mode: which folders the Web-IDE may open.
 */
import fsp from 'fs/promises';
import path from 'path';

/** true when `target` is one of `roots` or lies below one (all already resolved). */
export function isWithinRoots(target, roots) {
  return roots.some((root) => {
    const rel = path.relative(root, target);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

const real = (p) => fsp.realpath(p).catch(() => null);

const realAll = async (dirs) =>
  (await Promise.all([...new Set(dirs.filter(Boolean))].map(real))).filter(Boolean);

/**
 * Real path of `target` when it is a directory inside one of `roots` or exactly one of `exact`,
 * else null. Agent cwds go into `exact`: an agent started in $HOME must not open all of $HOME's
 * subfolders (~/.ssh). Symlinks are resolved on both sides so a link cannot point out of a root.
 */
export async function resolveAllowedFolder(target, roots, exact = []) {
  if (typeof target !== 'string' || !path.isAbsolute(target)) return null;
  const resolved = await real(target);
  if (!resolved) return null;
  const stat = await fsp.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) return null;
  if ((await realAll(exact)).includes(resolved)) return resolved;
  return isWithinRoots(resolved, await realAll(roots)) ? resolved : null;
}
