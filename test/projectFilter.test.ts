import { describe, it, expect } from 'vitest';
import type { WorkflowCard } from '../utils/workflows';
import { filterByProjects } from '../components/WorkflowView/projectFilter';

describe('filterByProjects', () => {
  const card = (key: string, repo: string) => ({ key, item: { repo } }) as unknown as WorkflowCard;
  const cards = [card('a', 'o/r'), card('b', 'o/r'), card('c', 'o/x')];
  const keys = (repos: string[]) => filterByProjects(cards, repos).map((c) => c.key);

  it('AC-7: keeps the picked repos (case-insensitive); nothing picked means all', () => {
    expect(keys(['o/X'])).toEqual(['c']);
    expect(keys(['o/r', 'o/x'])).toEqual(['a', 'b', 'c']);
    expect(keys([])).toEqual(['a', 'b', 'c']);
    expect(keys(['o/gone'])).toEqual([]);
  });
});
