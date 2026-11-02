/**
 * Groups dispatch-target directories for the directory picker (#158):
 * pinned entries (home, current) first, then one group per parent directory.
 */

export interface DirectoryChoice {
  name: string;
  path: string;
  source: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  /** Merged sources of all spellings of this path, e.g. ['repo', 'session'] */
  sources: string[];
  /** Directory basename or worktree origin, only when it differs from `name` */
  detail: string | null;
  /** Names of the merged spellings, still searchable */
  aliases: string[];
}

export interface DirectoryGroup {
  /** Parent path (or 'pinned'), stable React key */
  key: string;
  /** Parent path with home shortened to `~`; null for the pinned group */
  label: string | null;
  entries: DirectoryEntry[];
}

const WORKTREE_MARKER = '/.claude/worktrees/';

/** Real paths win over app config paths, which may be typed in another case */
const SOURCE_PRIORITY = ['home', 'repo', 'worktree', 'session', 'configured', 'app'];

const stripSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
// The server runs on macOS (case-insensitive FS): ~/projects and ~/PROJECTS are one folder
const pathKey = (p: string) => stripSlash(p).toLowerCase();
const rank = (source: string) => {
  const i = SOURCE_PRIORITY.indexOf(source);
  return i === -1 ? SOURCE_PRIORITY.length : i;
};
const basename = (p: string) => p.split('/').pop() || p;
const parentOf = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/';
const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

export const samePath = (a: string | null, b: string | null) =>
  !!a && !!b && pathKey(a) === pathKey(b);

export function shortenHome(p: string, home: string | null): string {
  if (!home) return p;
  if (pathKey(p) === pathKey(home)) return '~';
  return pathKey(p).startsWith(pathKey(home) + '/') ? '~' + p.slice(stripSlash(home).length) : p;
}

/** One entry per directory, case-insensitively; sources of all spellings merged */
export function dedupeDirectories(choices: DirectoryChoice[]): DirectoryEntry[] {
  const byKey = new Map<string, { best: DirectoryChoice; sources: string[]; names: string[] }>();
  for (const choice of choices) {
    const key = pathKey(choice.path);
    const hit = byKey.get(key);
    if (!hit) {
      byKey.set(key, { best: choice, sources: [choice.source], names: [choice.name] });
      continue;
    }
    if (!hit.sources.includes(choice.source)) hit.sources.push(choice.source);
    if (!hit.names.includes(choice.name)) hit.names.push(choice.name);
    if (rank(choice.source) < rank(hit.best.source)) hit.best = choice;
  }
  return [...byKey.values()].map(({ best, sources, names }) => {
    const path = stripSlash(best.path);
    return {
      name: best.name,
      path,
      sources: sources.sort((a, b) => rank(a) - rank(b)),
      detail: byText(basename(path), best.name) === 0 ? null : basename(path),
      aliases: names.filter((n) => n !== best.name),
    };
  });
}

type GroupItem = { primary: string; worktree: boolean; entry: DirectoryEntry };

// Worktrees sort right after their repo: same primary key, repo first
const byItem = (a: GroupItem, b: GroupItem) =>
  byText(a.primary, b.primary) ||
  Number(a.worktree) - Number(b.worktree) ||
  byText(a.entry.name, b.entry.name);

export function groupDirectories(
  choices: DirectoryChoice[],
  opts: { home?: string | null; current?: string | null; query?: string } = {}
): DirectoryGroup[] {
  const home = opts.home ?? null;
  const query = (opts.query || '').trim().toLowerCase();
  const pinnedKeys = [opts.current, home].filter(Boolean).map((p) => pathKey(p as string));

  const entries = dedupeDirectories(choices);
  const nameByPath = new Map(entries.map((e) => [pathKey(e.path), e.name]));
  const pinned: DirectoryEntry[] = [];
  const groups = new Map<string, { label: string; labelRank: number; items: GroupItem[] }>();

  for (const entry of entries) {
    const haystack = [entry.name, ...entry.aliases, entry.path].join(' ').toLowerCase();
    if (query && !haystack.includes(query)) continue;
    if (pinnedKeys.includes(pathKey(entry.path))) {
      pinned.push(entry);
      continue;
    }
    const wt = entry.path.indexOf(WORKTREE_MARKER);
    // Worktrees sit next to their repo, in the repo's parent group
    const repoRoot = wt === -1 ? null : entry.path.slice(0, wt);
    const parent = parentOf(repoRoot ?? entry.path);
    const item: GroupItem = repoRoot
      ? {
          primary: nameByPath.get(pathKey(repoRoot)) ?? basename(repoRoot),
          worktree: true,
          entry: { ...entry, detail: `worktree of ${basename(repoRoot)}` },
        }
      : { primary: entry.name, worktree: false, entry };
    const key = pathKey(parent);
    const group = groups.get(key) ?? { label: '', labelRank: Infinity, items: [] };
    groups.set(key, group);
    // Parent spelling follows the best-ranked member, like the entry paths
    if (rank(entry.sources[0]) < group.labelRank) {
      group.label = shortenHome(parent, home);
      group.labelRank = rank(entry.sources[0]);
    }
    group.items.push(item);
  }

  // Current before home
  pinned.sort((a, b) => pinnedKeys.indexOf(pathKey(a.path)) - pinnedKeys.indexOf(pathKey(b.path)));
  const result: DirectoryGroup[] = pinned.length
    ? [{ key: 'pinned', label: null, entries: pinned }]
    : [];
  for (const [key, group] of [...groups.entries()].sort((a, b) => byText(a[1].label, b[1].label))) {
    result.push({ key, label: group.label, entries: group.items.sort(byItem).map((i) => i.entry) });
  }
  return result;
}
