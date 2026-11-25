// The milestone Choice keeps a closed current milestone visible (the server lists only open ones)
import { describe, it, expect } from 'vitest';
import { milestoneOptions } from '../components/BoardView/IssueFields';

const repo = { labels: [], assignees: [], milestones: [{ id: 'm1', title: 'v1' }] };

describe('milestoneOptions', () => {
  it('lists "No milestone" and the open milestones', () => {
    expect(milestoneOptions(repo, 'v1').map((o) => o.value)).toEqual(['', 'v1']);
  });

  it('adds a current milestone that is not open', () => {
    expect(milestoneOptions(repo, 'v0 (closed)')).toContainEqual({
      value: 'v0 (closed)',
      label: 'v0 (closed)',
    });
  });

  it('only "No milestone" while the options load', () => {
    expect(milestoneOptions(null, null)).toEqual([{ value: '', label: 'No milestone' }]);
  });
});
