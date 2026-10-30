import type { WorkflowCard } from '../../utils/workflows';

/** Cards of the picked repos ("owner/name", case-insensitive); nothing picked means all */
export function filterByProjects(cards: WorkflowCard[], repos: readonly string[]): WorkflowCard[] {
  if (!repos.length) return cards;
  const picked = new Set(repos.map((r) => r.toLowerCase()));
  return cards.filter((c) => picked.has(c.item.repo?.toLowerCase() ?? ''));
}
