import { describe, it, expect } from 'vitest';
import type { BoardItem } from '../types';
import { buildWorkflowCards, stageMoves } from '../utils/workflows';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const options = [
  { id: 'todo', name: 'Todo', color: 'GRAY' },
  { id: 'prog', name: 'In Progress', color: 'BLUE' },
  { id: 'done', name: 'Done', color: 'GREEN' },
];

const item = (n: number, over: Partial<BoardItem> = {}): BoardItem => ({
  itemId: `PVTI_${n}`,
  type: 'Issue',
  issueId: `I_${n}`,
  number: n,
  title: `Issue ${n}`,
  url: `https://github.com/o/r/issues/${n}`,
  repo: 'o/r',
  state: 'OPEN',
  stateReason: null,
  statusOptionId: 'todo',
  labels: [{ name: 'mw:go', color: 'aaaaaa' }],
  milestone: null,
  assignees: [],
  parent: null,
  subIssues: { total: 0, completed: 0 },
  pullRequests: [],
  mwBoardSessions: [],
  mwMarkers: [],
  updatedAt: '2026-10-26T10:00:00Z',
  closedAt: null,
  ...over,
});

describe('buildWorkflowCards', () => {
  it('keeps workflow issues, drops others and old finished ones, puts GO-waiting first', () => {
    const cards = buildWorkflowCards(
      [
        item(1),
        item(2, { labels: [] }),
        item(3, { state: 'CLOSED', statusOptionId: 'done', closedAt: '2026-09-01T00:00:00Z' }),
        item(4, {
          statusOptionId: 'prog',
          updatedAt: '2026-10-20T00:00:00Z',
          mwMarkers: [
            { kind: 'start', attrs: { session: 's' }, at: '' },
            { kind: 'briefed', attrs: { path: 'b.md' }, at: '' },
          ],
        }),
      ],
      options,
      {},
      NOW
    );
    expect(cards.map((c) => [c.key, c.state.stage])).toEqual([
      ['o/r#4', 'awaiting'],
      ['o/r#1', 'released'],
    ]);
  });
});

describe('stageMoves', () => {
  it('reports changed stages only, not new cards', () => {
    const cards = buildWorkflowCards([item(1), item(5)], options, {}, NOW);
    expect(stageMoves(new Map([['o/r#1', 2]]), cards)).toEqual([{ key: 'o/r#1', from: 2, to: 0 }]);
  });
});
