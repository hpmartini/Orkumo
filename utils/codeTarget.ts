/**
 * Code mode: which folder a context (agent, issue, PR) opens in the Web-IDE.
 */
import type { AgentContext, AgentRepo, AgentSession, AppConfig } from '../types';

/** Route of the Code mode for `path` */
export const codeUrl = (path: string) => `/code?path=${encodeURIComponent(path)}`;

/** Route filtered to a repo ("owner/name") and, optionally, to the issues of one agent */
const scopedUrl = (route: string) => (repo: string, agentId?: string) =>
  `${route}?${new URLSearchParams(agentId ? { repo, agent: agentId } : { repo })}`;
export const boardUrl = scopedUrl('/board');
/** Full PR view (#191), optionally filtered to a repo */
export const pullsUrl = (repo?: string | null) => (repo ? scopedUrl('/pulls')(repo) : '/pulls');
/** Route of a module mode (docs/MODULES.md), scoped like the board */
export const modeUrl = (id: string) => scopedUrl(`/${id}`);

/** An agent works in its worktree; its cwd is the worktree (or a folder in it) otherwise */
export function agentFolder(
  session: Pick<AgentSession, 'cwd'> | undefined,
  ctx?: AgentContext | null
): string | null {
  return ctx?.repo?.worktreePath || session?.cwd || null;
}

/** Folder of the first linked agent that is still known; null sends the caller to its fallback */
export function linkedAgentFolder(
  jobIds: string[],
  sessionsById: Map<string, Pick<AgentSession, 'cwd'>>,
  contexts: Record<string, AgentContext> = {}
): string | null {
  for (const id of jobIds) {
    const folder = agentFolder(sessionsById.get(id), contexts[id]);
    if (folder) return folder;
  }
  return null;
}

/** Kinds of rows in the Code mode folder picker */
export type CodeTargetKind = 'project' | 'checkout' | 'worktree' | 'folder';

/** One folder the Code mode can open: a project, a merged checkout or worktree of it, an agent dir */
export interface CodeTarget {
  kind: CodeTargetKind;
  path: string;
  /** Folder name, or the user's project name */
  label: string;
  /** Folder name when the label is a project name that differs from it */
  detail: string | null;
  /** Parent folder(s) telling apart rows with the same label */
  qualifier: string | null;
  /** Path shown: home-relative, inside the project for its worktrees */
  display: string;
  /** Lower-cased search text: worktrees only their own name and shown path */
  haystack: string;
  /** An agent works in it (an agent folder from /api/agents/repos lies in it) */
  agent: boolean;
}

/** A project with its other checkouts and worktrees nested below it */
export interface CodeProject extends CodeTarget {
  children: CodeTarget[];
}

export interface CodeGroup {
  /** Lower-cased scan root path, `other` for agent folders outside every project */
  key: string;
  /** Scan root folder (`PROJECTS`), `~`, a parent outside home, or `Other folders` */
  label: string;
  projects: CodeProject[];
}

export const OTHER_FOLDERS_KEY = 'other';

/** Agent worktree folder relative to its repo: `/.claude/worktrees/<name>` and similar */
const WORKTREE_MARKER = /^\/(?:\.claude\/worktrees?|\.worktrees)\/[^/]+$/;
const stripSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
// macOS is case-insensitive: ~/projects and ~/PROJECTS are one folder
const pathKey = (p: string) => stripSlash(p).toLowerCase();
const basename = (p: string) => stripSlash(p).split('/').pop() || p;
const parentOf = (p: string) => stripSlash(p).slice(0, stripSlash(p).lastIndexOf('/')) || '/';
const inside = (child: string, dir: string) => pathKey(child).startsWith(pathKey(dir) + '/');
const byLabel = (a: CodeTarget, b: CodeTarget) =>
  a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) ||
  a.path.localeCompare(b.path);

/** `p` with the home directory shortened to `~` */
export function homeRelative(p: string, home: string | null): string {
  const path = stripSlash(p);
  if (!home) return path;
  if (pathKey(path) === pathKey(home)) return '~';
  return inside(path, home) ? '~' + path.slice(stripSlash(home).length) : path;
}

export const samePath = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && pathKey(a) === pathKey(b);

function target(
  kind: CodeTargetKind,
  path: string,
  label: string,
  display: string,
  detail: string | null,
  search: (string | null)[]
): CodeTarget {
  const haystack = search.filter(Boolean).join(' ').toLowerCase();
  return {
    kind,
    path: stripSlash(path),
    label,
    detail,
    qualifier: null,
    display,
    haystack,
    agent: false,
  };
}

/**
 * Rows with the same label get as many parent folders as it takes to tell them apart. A folder
 * directly in home gets none: its path (`~/MAGOS`) already says so.
 */
function disambiguate(rows: CodeTarget[], home: string | null) {
  const byLabelKey = new Map<string, CodeTarget[]>();
  for (const row of rows) {
    const key = row.label.toLowerCase();
    byLabelKey.set(key, [...(byLabelKey.get(key) ?? []), row]);
  }
  for (const same of byLabelKey.values()) {
    if (same.length < 2) continue;
    const parents = same.map((r) =>
      homeRelative(parentOf(r.path), home).split('/').filter(Boolean)
    );
    const deepest = Math.max(...parents.map((p) => p.length));
    let names: string[] = [];
    for (let depth = 1; depth <= deepest; depth++) {
      names = parents.map((p) => p.slice(-depth).join('/') || '/');
      if (new Set(names.map((n) => n.toLowerCase())).size === names.length) break;
    }
    same.forEach((row, i) => {
      if (names[i] === '~') return;
      row.qualifier = names[i];
      row.haystack += ` ${names[i].toLowerCase()}`;
    });
  }
}

/** Scan root a project sits in: first folder under home, else its parent directory */
function scanRoot(path: string, home: string | null): { key: string; label: string } {
  if (home && inside(path, home)) {
    const rest = path.slice(stripSlash(home).length + 1).split('/');
    if (rest.length === 1) return { key: pathKey(home), label: '~' };
    return { key: pathKey(`${home}/${rest[0]}`), label: rest[0] };
  }
  const parent = parentOf(path);
  return { key: pathKey(parent), label: parent };
}

/**
 * Folder picker model of Code mode: one entry per project (its other checkouts and worktrees
 * nested), grouped by scan root; agent folders outside every project in a final group.
 * A project shows its folder name unless the user named it, then that name with the folder.
 */
export function codeTargets(
  apps: Pick<
    AppConfig,
    'name' | 'path' | 'paths' | 'worktrees' | 'missingWorktrees' | 'userNamed'
  >[],
  repos: Pick<AgentRepo, 'path'>[],
  home: string | null
): CodeGroup[] {
  const seen = new Set<string>();
  const claim = (p: string) => {
    const key = pathKey(p);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  // Deleted worktrees git still lists are no rows, nor do stale agent dirs in them bring them back
  for (const app of apps) for (const p of app.missingWorktrees ?? []) claim(p);
  const projects: CodeProject[] = [];
  for (const app of apps) {
    if (!claim(app.path)) continue;
    const folder = basename(app.path);
    const named = !!app.userNamed && app.name.toLowerCase() !== folder.toLowerCase();
    const label = named ? app.name : folder;
    const display = homeRelative(app.path, home);
    const project: CodeProject = {
      // Package names stay searchable without being shown
      ...target('project', app.path, label, display, named ? folder : null, [
        label,
        folder,
        display,
        app.path,
        app.name,
      ]),
      children: [],
    };
    const nest = (kind: CodeTargetKind, p: string) => {
      if (!claim(p)) return;
      // Worktrees inside the project show their path from there (.claude/worktrees/x)
      const shown = inside(p, project.path)
        ? stripSlash(p).slice(project.path.length + 1)
        : homeRelative(p, home);
      project.children.push(target(kind, p, basename(p), shown, null, [basename(p), shown]));
    };
    for (const p of app.paths ?? []) nest('checkout', p);
    for (const p of app.worktrees ?? []) nest('worktree', p);
    projects.push(project);
  }

  const others: CodeProject[] = [];
  for (const repo of repos) {
    const path = stripSlash(repo.path);
    if (seen.has(pathKey(path))) continue;
    const owner = projects.find((p) => [p, ...p.children].some((t) => inside(path, t.path)));
    if (owner) {
      // A worktree git does not list (yet) still belongs to its project; other subfolders do not
      const rest = path.slice(owner.path.length);
      if (inside(path, owner.path) && WORKTREE_MARKER.test(rest) && claim(path))
        owner.children.push(
          target('worktree', path, basename(path), rest.slice(1), null, [
            basename(path),
            rest.slice(1),
          ])
        );
      continue;
    }
    if (!claim(path)) continue;
    const display = homeRelative(path, home);
    others.push({
      ...target('folder', path, basename(path), display, null, [basename(path), display, path]),
      children: [],
    });
  }
  for (const project of projects)
    for (const child of project.children)
      child.agent = repos.some((r) => samePath(r.path, child.path) || inside(r.path, child.path));

  disambiguate([...projects, ...others], home);
  const groups = new Map<string, CodeGroup>();
  for (const project of projects) {
    // Merged checkouts before worktrees
    project.children.sort(
      (a, b) => Number(a.kind === 'worktree') - Number(b.kind === 'worktree') || byLabel(a, b)
    );
    disambiguate(project.children, home);
    const root = scanRoot(project.path, home);
    const group = groups.get(root.key) ?? { ...root, projects: [] };
    groups.set(root.key, group);
    group.projects.push(project);
  }
  const result = [...groups.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  );
  for (const group of result) group.projects.sort(byLabel);
  if (others.length)
    result.push({ key: OTHER_FOLDERS_KEY, label: 'Other folders', projects: others.sort(byLabel) });
  return result;
}

/** A row of the picker list: a folder, or the toggle of a project's further worktrees */
export type CodeRow =
  | { type: 'target'; project: CodeProject; target: CodeTarget }
  | { type: 'more'; project: CodeProject; count: number; expanded: boolean; all: boolean };

export interface CodeSection {
  key: string;
  label: string;
  /** Projects (or other folders) in the section */
  count: number;
  rows: CodeRow[];
}

export interface CodeRows {
  sections: CodeSection[];
  /** While searching: projects matching every term, worktrees matching by themselves */
  projects: number;
  worktrees: number;
}

/** Key of a project's expanded worktrees in the picker's stored open/closed state */
export const worktreesKey = (project: Pick<CodeTarget, 'path'>) => `wt:${pathKey(project.path)}`;

/**
 * Picker rows. Without a query a project shows its merged checkouts and the worktrees agents work
 * in or that is open, the rest behind one "N more worktrees" row. With a query (every
 * whitespace-separated term must match), a project shows when it matches, a worktree only when
 * it matches by its own name or path (terms may also match its project); a matching project
 * keeps its other worktrees behind the toggle row.
 */
export function codeRows(
  groups: CodeGroup[],
  opts: { query?: string; current?: string | null; expanded?: ReadonlySet<string> } = {}
): CodeRows {
  const terms = (opts.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const expanded = opts.expanded ?? new Set<string>();
  const has = (t: CodeTarget, term: string) => t.haystack.includes(term);
  let projectHits = 0;
  let worktreeHits = 0;
  const sections: CodeSection[] = [];
  for (const group of groups) {
    const rows: CodeRow[] = [];
    let count = 0;
    for (const project of group.projects) {
      const projectMatch = terms.every((term) => has(project, term));
      const shown = terms.length
        ? project.children.filter(
            (c) =>
              terms.some((term) => has(c, term)) &&
              terms.every((term) => has(c, term) || has(project, term))
          )
        : project.children.filter(
            (c) => c.kind !== 'worktree' || c.agent || samePath(c.path, opts.current)
          );
      if (terms.length && !projectMatch && !shown.length) continue;
      count++;
      if (terms.length) {
        projectHits += Number(projectMatch);
        worktreeHits += shown.length;
      }
      rows.push({ type: 'target', project, target: project });
      for (const c of shown) rows.push({ type: 'target', project, target: c });
      // A worktree matching alone keeps its project as a frame, without the project's rest
      if (terms.length && !projectMatch) continue;
      const rest = project.children.filter((c) => !shown.includes(c));
      if (!rest.length) continue;
      const open = expanded.has(worktreesKey(project));
      rows.push({
        type: 'more',
        project,
        count: rest.length,
        expanded: open,
        all: shown.every((c) => c.kind !== 'worktree'),
      });
      if (open) for (const c of rest) rows.push({ type: 'target', project, target: c });
    }
    if (count) sections.push({ key: group.key, label: group.label, count, rows });
  }
  return { sections, projects: projectHits, worktrees: worktreeHits };
}

/** The row for `path` and the project it belongs to */
export function findCodeTarget(
  groups: CodeGroup[],
  path: string | null | undefined
): { project: CodeProject; target: CodeTarget } | null {
  if (!path) return null;
  for (const group of groups)
    for (const project of group.projects)
      for (const row of [project, ...project.children])
        if (samePath(row.path, path)) return { project, target: row };
  return null;
}

/** Recently opened folders, newest first, one entry per path */
export function pushRecent(recent: string[], path: string, max = 12): string[] {
  return [path, ...recent.filter((p) => !samePath(p, path))].slice(0, max);
}
