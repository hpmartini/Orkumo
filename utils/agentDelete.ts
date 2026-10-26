/**
 * Asks before a background session is deleted (#94). Resolves to false without
 * calling `remove` when the user cancels.
 */
export async function confirmDelete(
  name: string,
  remove: () => Promise<unknown>,
  ask: (message: string) => boolean = (message) => window.confirm(message)
): Promise<boolean> {
  if (!ask(`Delete session "${name}"?\n\nThis removes the session and its worktree.`)) return false;
  await remove();
  return true;
}
