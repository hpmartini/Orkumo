import { describe, it, expect } from 'vitest';
import {
  insertPosition,
  dropZone,
  layoutForZone,
  positionForZone,
  reorderIndices,
  stepIndices,
  EMPTY_WORKSPACE,
  openSession,
  closeSession,
  closeTab,
  splitInto,
  detachSession,
  moveTab,
  setTabLayout,
  focusSession,
  activateTab,
  pruneMissing,
  tabTitle,
  migrateWorkspace,
  type Workspace,
} from './agentWorkspace';

const open = (...ids: string[]) => ids.reduce(openSession, EMPTY_WORKSPACE);
const shape = (ws: Workspace) => ws.tabs.map((t) => `${t.layout}:${t.panes.join(',')}`);
const activeTab = (ws: Workspace) => ws.tabs.find((t) => t.id === ws.activeTabId);

const rect = { left: 100, top: 50, width: 200, height: 100 };

function apply(order: string[], move: { from: number; to: number } | null): string[] {
  if (!move) return order;
  const next = [...order];
  const [m] = next.splice(move.from, 1);
  next.splice(move.to, 0, m);
  return next;
}

describe('insertPosition', () => {
  it('uses the pointer half', () => {
    expect(insertPosition(rect, 120)).toBe('before');
    expect(insertPosition(rect, 250)).toBe('after');
  });
});

describe('dropZone', () => {
  it('picks the nearest edge', () => {
    expect(dropZone(rect, 105, 100)).toBe('left');
    expect(dropZone(rect, 295, 100)).toBe('right');
    expect(dropZone(rect, 200, 52)).toBe('top');
    expect(dropZone(rect, 200, 148)).toBe('bottom');
  });
  it('handles an empty rect', () => {
    expect(dropZone({ left: 0, top: 0, width: 0, height: 0 }, 0, 0)).toBeDefined();
  });
});

describe('layout / position for zone', () => {
  it('maps zones', () => {
    expect(layoutForZone('left')).toBe('columns');
    expect(layoutForZone('right')).toBe('columns');
    expect(layoutForZone('top')).toBe('rows');
    expect(layoutForZone('bottom')).toBe('rows');
    expect(positionForZone('left')).toBe('before');
    expect(positionForZone('top')).toBe('before');
    expect(positionForZone('right')).toBe('after');
    expect(positionForZone('bottom')).toBe('after');
  });
});

describe('reorderIndices', () => {
  const order = ['a', 'b', 'c', 'd'];
  it('moves before / after a target in both directions', () => {
    expect(apply(order, reorderIndices(order, 'a', 'c', 'before'))).toEqual(['b', 'a', 'c', 'd']);
    expect(apply(order, reorderIndices(order, 'a', 'c', 'after'))).toEqual(['b', 'c', 'a', 'd']);
    expect(apply(order, reorderIndices(order, 'd', 'b', 'before'))).toEqual(['a', 'd', 'b', 'c']);
    expect(apply(order, reorderIndices(order, 'd', 'b', 'after'))).toEqual(['a', 'b', 'd', 'c']);
  });
  it('supports the end of the strip', () => {
    expect(apply(order, reorderIndices(order, 'a', 'd', 'after'))).toEqual(['b', 'c', 'd', 'a']);
  });
  it('returns null for no-ops and unknown ids', () => {
    expect(reorderIndices(order, 'b', 'c', 'before')).toBeNull();
    expect(reorderIndices(order, 'c', 'b', 'after')).toBeNull();
    expect(reorderIndices(order, 'a', 'a', 'after')).toBeNull();
    expect(reorderIndices(order, 'x', 'a', 'after')).toBeNull();
  });
});

describe('stepIndices', () => {
  const order = ['a', 'b', 'c'];
  it('moves one slot', () => {
    expect(apply(order, stepIndices(order, 'b', -1))).toEqual(['b', 'a', 'c']);
    expect(apply(order, stepIndices(order, 'b', 1))).toEqual(['a', 'c', 'b']);
  });
  it('stops at the ends', () => {
    expect(stepIndices(order, 'a', -1)).toBeNull();
    expect(stepIndices(order, 'c', 1)).toBeNull();
  });
});

describe('openSession', () => {
  it('opens one tab per new session and activates it', () => {
    const ws = open('a', 'b');
    expect(shape(ws)).toEqual(['single:a', 'single:b']);
    expect(activeTab(ws)?.panes).toEqual(['b']);
  });
  it('re-attaching an open session only focuses it', () => {
    const ws = openSession(open('a', 'b'), 'a');
    expect(ws.tabs).toHaveLength(2);
    expect(activeTab(ws)?.panes).toEqual(['a']);
  });
  it('re-attaching a split pane focuses its pane, not a new tab', () => {
    const split = splitInto(open('a', 'b', 'c'), 'b', 'a', 'right');
    const ws = openSession(openSession(split, 'c'), 'a');
    expect(ws.tabs).toHaveLength(2);
    expect(activeTab(ws)?.panes).toEqual(['a', 'b']);
    expect(activeTab(ws)?.activeSessionId).toBe('a');
  });
});

describe('splitInto', () => {
  it('moves the session into the target tab without adding a tab', () => {
    const ws = splitInto(open('a', 'b'), 'b', 'a', 'right');
    expect(shape(ws)).toEqual(['columns:a,b']);
    expect(activeTab(ws)?.activeSessionId).toBe('b');
  });
  it('honours the zone side and orientation', () => {
    expect(shape(splitInto(open('a', 'b'), 'b', 'a', 'left'))).toEqual(['columns:b,a']);
    expect(shape(splitInto(open('a', 'b'), 'b', 'a', 'bottom'))).toEqual(['rows:a,b']);
    expect(shape(splitInto(open('a', 'b'), 'b', 'a', 'top'))).toEqual(['rows:b,a']);
  });
  it('is a no-op onto itself or an unknown target', () => {
    const ws = open('a', 'b');
    expect(splitInto(ws, 'a', 'a', 'left')).toBe(ws);
    expect(splitInto(ws, 'a', 'zzz', 'left')).toBe(ws);
  });
  it('removes the emptied source tab and re-picks the active tab', () => {
    const ws = splitInto(open('a', 'b', 'c'), 'b', 'c', 'right');
    expect(shape(ws)).toEqual(['single:a', 'columns:c,b']);
    expect(ws.activeTabId).toBe(activeTab(ws)?.id);
  });
  it('takes a pane out of a multi-pane tab and keeps the rest', () => {
    const ws = splitInto(splitInto(open('a', 'b', 'c'), 'b', 'a', 'right'), 'b', 'c', 'right');
    expect(shape(ws)).toEqual(['single:a', 'columns:c,b']);
  });
  it('mixed split directions fall back to grid at three panes', () => {
    let ws = splitInto(open('a', 'b', 'c'), 'b', 'a', 'right');
    ws = splitInto(ws, 'c', 'a', 'bottom');
    expect(shape(ws)).toEqual(['grid:a,c,b']);
  });
  it('same direction keeps columns at three panes', () => {
    let ws = splitInto(open('a', 'b', 'c'), 'b', 'a', 'right');
    ws = splitInto(ws, 'c', 'b', 'right');
    expect(shape(ws)).toEqual(['columns:a,b,c']);
  });
  it('reorders inside one tab', () => {
    const ws = splitInto(splitInto(open('a', 'b'), 'b', 'a', 'right'), 'b', 'a', 'left');
    expect(shape(ws)).toEqual(['columns:b,a']);
  });
});

describe('closeSession / closeTab', () => {
  it('closing the last pane removes the tab and activates a neighbour', () => {
    const ws = closeSession(open('a', 'b', 'c'), 'c');
    expect(shape(ws)).toEqual(['single:a', 'single:b']);
    expect(activeTab(ws)?.panes).toEqual(['b']);
    expect(closeSession(open('a'), 'a')).toEqual(EMPTY_WORKSPACE);
  });
  it('closing one of two panes collapses the tab to single', () => {
    const ws = closeSession(splitInto(open('a', 'b'), 'b', 'a', 'right'), 'b');
    expect(shape(ws)).toEqual(['single:a']);
    expect(activeTab(ws)?.activeSessionId).toBe('a');
  });
  it('closing an inactive tab keeps the active one', () => {
    const ws = closeSession(open('a', 'b'), 'a');
    expect(activeTab(ws)?.panes).toEqual(['b']);
  });
  it('closeTab closes every pane; unknown ids change nothing', () => {
    const split = splitInto(open('a', 'b', 'c'), 'b', 'a', 'right');
    expect(shape(closeTab(split, 't1'))).toEqual(['single:c']);
    expect(closeTab(split, 'nope')).toBe(split);
  });
});

describe('detachSession', () => {
  it('moves a pane into its own tab right after the old one', () => {
    const ws = detachSession(splitInto(open('a', 'b', 'c'), 'b', 'a', 'right'), 'b');
    expect(shape(ws)).toEqual(['single:a', 'single:b', 'single:c']);
    expect(activeTab(ws)?.panes).toEqual(['b']);
  });
  it('only focuses a session that is already alone', () => {
    const ws = detachSession(open('a', 'b'), 'a');
    expect(ws.tabs).toHaveLength(2);
    expect(activeTab(ws)?.panes).toEqual(['a']);
  });
  it('never reuses a live tab id', () => {
    const ws = detachSession(splitInto(open('a', 'b'), 'b', 'a', 'right'), 'a');
    expect(new Set(ws.tabs.map((t) => t.id)).size).toBe(ws.tabs.length);
  });
});

describe('moveTab / setTabLayout / focus', () => {
  it('reorders tabs by id', () => {
    const ws = open('a', 'b', 'c');
    expect(shape(moveTab(ws, 't3', 't1', 'before'))).toEqual(['single:c', 'single:a', 'single:b']);
    expect(moveTab(ws, 't1', 't1', 'after')).toBe(ws);
  });
  it('layout override needs two panes', () => {
    const solo = open('a');
    expect(setTabLayout(solo, 't1', 'grid')).toBe(solo);
    const split = splitInto(open('a', 'b'), 'b', 'a', 'right');
    expect(shape(setTabLayout(split, 't1', 'rows'))).toEqual(['rows:a,b']);
    expect(setTabLayout(split, 't1', 'single')).toBe(split);
  });
  it('focusSession ignores unknown ids; activateTab switches tabs', () => {
    const ws = open('a', 'b');
    expect(focusSession(ws, 'x')).toBe(ws);
    expect(activateTab(ws, 't1').activeTabId).toBe('t1');
  });

  it('focusSession on a pane makes it the tab\'s active session (drives the rail reveal)', () => {
    const ws = splitInto(open('a', 'b'), 'b', 'a', 'right');
    const tab = ws.tabs.find((t) => t.panes.includes('a'))!;
    const other = tab.panes.find((id) => id !== tab.activeSessionId)!;
    const next = focusSession(ws, other);
    expect(next.tabs.find((t) => t.id === tab.id)!.activeSessionId).toBe(other);
    expect(next.activeTabId).toBe(tab.id);
  });
});

describe('pruneMissing', () => {
  it('drops vanished sessions lazily and keeps the others', () => {
    const ws = pruneMissing(splitInto(open('a', 'b', 'c'), 'b', 'a', 'right'), new Set(['b', 'c']));
    expect(shape(ws)).toEqual(['single:b', 'single:c']);
  });
});

describe('tabTitle', () => {
  it('names one, joins two, counts more', () => {
    expect(tabTitle(['a'])).toBe('a');
    expect(tabTitle(['a', 'b'])).toBe('a + b');
    expect(tabTitle(['a', 'b', 'c'])).toBe('3 agents');
  });
});

describe('migrateWorkspace', () => {
  it('converts the legacy shape to one tab per id', () => {
    const ws = migrateWorkspace({ openIds: ['a', 'b', 'a'], activeId: 'a' });
    expect(shape(ws)).toEqual(['single:a', 'single:b']);
    expect(activeTab(ws)?.panes).toEqual(['a']);
  });
  it('falls back for garbage and unknown active ids', () => {
    expect(migrateWorkspace(null)).toEqual(EMPTY_WORKSPACE);
    expect(migrateWorkspace('x')).toEqual(EMPTY_WORKSPACE);
    expect(migrateWorkspace({ openIds: ['a', 'b'], activeId: 'zz' }).activeTabId).toBe('t2');
  });
  it('round-trips the current shape and repairs it', () => {
    const ws = splitInto(open('a', 'b'), 'b', 'a', 'bottom');
    expect(migrateWorkspace(JSON.parse(JSON.stringify(ws)))).toEqual(ws);
    const fixed = migrateWorkspace({
      tabs: [
        { id: 'x', panes: ['a', 'b'], layout: 'bogus', activeSessionId: 'nope' },
        { id: 'y', panes: ['b', 'c'], layout: 'single', activeSessionId: 'c' },
        { id: 'z', panes: [] },
      ],
      activeTabId: 'gone',
    });
    expect(shape(fixed)).toEqual(['columns:a,b', 'single:c']);
    expect(fixed.tabs[0].activeSessionId).toBe('a');
    expect(fixed.activeTabId).toBe('y');
  });
});
