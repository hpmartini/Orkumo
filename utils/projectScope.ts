/**
 * Context scope of the dashboard (#184): a cwd belongs to the scope when it is one of the
 * project paths or lies below one (worktrees under `.claude/worktrees` included).
 * `undefined` scope = global dashboard, everything matches.
 */
export function inProjectScope(cwd: string | undefined, projectPaths?: string[]): boolean {
  if (!projectPaths) return true;
  if (!cwd) return false;
  return projectPaths.some((p) => {
    const root = p.replace(/\/+$/, '');
    return cwd === root || cwd.startsWith(root + '/');
  });
}
