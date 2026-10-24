import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { BoardItem, BoardStatusOption } from '../types';
import { BoardGrid, type BoardColumn } from '../components/BoardView/BoardGrid';

const options: BoardStatusOption[] = [
  { id: 'todo', name: 'Todo', color: 'GRAY' },
  { id: 'done', name: 'Done', color: 'GREEN' },
];
const columns: BoardColumn[] = options.map((option) => ({ key: option.id, option }));
const item: BoardItem = {
  itemId: 'PVTI_1',
  type: 'Issue',
  number: 1,
  title: 'Karte',
  url: 'https://github.com/o/r/issues/1',
  repo: 'o/r',
  state: 'OPEN',
  statusOptionId: 'todo',
  labels: [],
  milestone: null,
  assignees: [],
  parent: null,
  subIssues: { total: 0, completed: 0 },
  pullRequests: [],
  mwBoardSessions: [],
  updatedAt: '2026-10-01T00:00:00Z',
  closedAt: null,
};

function renderGrid(onMove = vi.fn()) {
  render(
    <BoardGrid
      columns={columns}
      options={options}
      lanes={[{ key: 'all', title: 'Alle', parent: null, items: [item], done: 0, total: 1 }]}
      laneMode="none"
      now={Date.parse('2026-10-02T00:00:00Z')}
      selectedKey={null}
      hideRepo={() => false}
      agentsByIssue={new Map()}
      sessionsById={new Map()}
      onOpen={vi.fn()}
      onAgent={vi.fn()}
      onMove={onMove}
      onReset={vi.fn()}
    />
  );
  return onMove;
}

const head = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });

describe('BoardGrid column folding', () => {
  beforeEach(() => localStorage.removeItem('devOrbitBoardColumns'));

  it('folds Done by default and keeps other columns open', () => {
    renderGrid();
    expect(head('Done').getAttribute('aria-expanded')).toBe('false');
    expect(head('Todo').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Karte')).toBeTruthy();
  });

  it('toggles any column by clicking its name and remembers it', () => {
    renderGrid();
    fireEvent.click(head('Todo'));
    fireEvent.click(head('Done'));
    expect(head('Todo').getAttribute('aria-expanded')).toBe('false');
    expect(head('Done').getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByText('Karte')).toBeNull();

    cleanup();
    renderGrid();
    expect(head('Todo').getAttribute('aria-expanded')).toBe('false');
    expect(head('Done').getAttribute('aria-expanded')).toBe('true');
  });

  it('accepts drops on a folded column', () => {
    const onMove = renderGrid();
    const cell = screen.getByTitle('Auf Done ziehen');
    const dataTransfer = { types: ['x'], getData: () => 'PVTI_1' };
    fireEvent.drop(cell, { dataTransfer });
    expect(onMove).toHaveBeenCalledWith('PVTI_1', 'done');
  });
});
