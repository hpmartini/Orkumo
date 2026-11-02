/**
 * Configured project directories (admin panel, `config.directories`) as the roots that
 * project lists cluster by. Paths compare case-insensitively (macOS file system).
 */

const isUnder = (parent: string, child: string) => {
  const p = parent.toLowerCase().replace(/\/+$/, '');
  const c = child.toLowerCase();
  return c === p || c.startsWith(`${p}/`);
};

/** Most specific configured directory containing `path`, or null */
export function projectRoot(path: string, dirs: string[]): string | null {
  return dirs.filter((d) => isUnder(d, path)).sort((a, b) => b.length - a.length)[0] ?? null;
}

/** `path` shown relative to its root (`~` for the home directory otherwise) */
export function shortPath(path: string, root: string | null): string {
  if (root) return path.slice(root.replace(/\/+$/, '').length + 1) || '.';
  return path.replace(/^\/Users\/[^/]+/, '~');
}

export interface RootGroup<T> {
  /** null: outside every configured directory */
  root: string | null;
  items: T[];
}

/** Items clustered by root in the order of `dirs`; items outside every root come last */
export function groupByRoot<T>(
  items: T[],
  rootOf: (item: T) => string | null,
  dirs: string[]
): RootGroup<T>[] {
  const groups = new Map<string | null, T[]>([...dirs.map((d) => [d, []] as [string, T[]])]);
  groups.set(null, []);
  for (const item of items) (groups.get(rootOf(item)) ?? groups.get(null)!).push(item);
  return [...groups]
    .filter(([, list]) => list.length > 0)
    .map(([root, list]) => ({ root, items: list }));
}

/**
 * Root a context belongs to: the configured directory holding most of its projects
 * (ties: first in `dirs`). The "all" context (`appIds === null`) and contexts without
 * known projects have none.
 */
export function contextRoot(
  appIds: string[] | null,
  apps: { id: string; path: string }[],
  dirs: string[]
): string | null {
  if (!appIds) return null;
  const members = new Set(appIds);
  const counts = new Map<string, number>();
  for (const app of apps) {
    if (!members.has(app.id)) continue;
    const root = projectRoot(app.path, dirs);
    if (root) counts.set(root, (counts.get(root) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const dir of dirs) {
    if ((counts.get(dir) ?? 0) > (best ? counts.get(best)! : 0)) best = dir;
  }
  return best;
}
