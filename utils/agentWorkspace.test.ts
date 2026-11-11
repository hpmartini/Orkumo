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
  openBrowser,
  browserUrl,
  openShell,
  shellCwd,
  type DropZone,
  type SplitNode,
  type Workspace,
} from './agentWorkspace';

const open = (...ids: string[]) => ids.reduce(openSession, EMPTY_WORKSPACE);
const shape = (ws: Workspace) => ws.tabs.map((t) => `${t.layout}:${t.panes.join(',')}`);
const tree = (node: SplitNode): string =>
  'pane' in node ? node.pane : `${node.dir}(${node.children.map(tree).join(',')})`;
const slots = (node: SplitNode): string[] =>
  'pane' in node ? [node.id] : [node.id, ...node.children.flatMap(slots)];
const slotOf = (node: SplitNode, pane: string): string | undefined =>
  'pane' in node
    ? node.pane === pane
      ? node.id
      : undefined
    : node.children.map((c) => slotOf(c, pane)).find(Boolean);
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
  it('#212 AC-1: a pane dropped below A splits only A; B keeps the full height', () => {
    let ws = splitInto(open('a', 'b', 'c'), 'b', 'a', 'right');
    const before = ws.tabs[0].root;
    ws = splitInto(ws, 'c', 'a', 'bottom');
    expect(shape(ws)).toEqual(['custom:a,c,b']);
    expect(tree(ws.tabs[0].root)).toBe('row(column(a,c),b)');
    // B's slot and the root's are untouched: their panels stay mounted and keep their size
    expect(slotOf(ws.tabs[0].root, 'b')).toBe(slotOf(before, 'b'));
    expect(ws.tabs[0].root.id).toBe(before.id);
    // the new node sits in A's old slot
    expect((ws.tabs[0].root as { children: SplitNode[] }).children[0].id).toBe(slotOf(before, 'a'));
  });
  it('#212 AC-2: every edge splits only the target, on the right side of it', () => {
    const base = splitInto(open('a', 'b', 'c'), 'b', 'a', 'right');
    const drop = (zone: DropZone) => tree(splitInto(base, 'c', 'b', zone).tabs[0].root);
    expect(drop('left')).toBe('row(a,row(c,b))');
    expect(drop('right')).toBe('row(a,row(b,c))');
    expect(drop('top')).toBe('row(a,column(c,b))');
    expect(drop('bottom')).toBe('row(a,column(b,c))');
  });
  it('#212 AC-2: slot ids stay unique over many splits', () => {
    let ws = open('a', 'b', 'c', 'd', 'e');
    ws = splitInto(ws, 'b', 'a', 'right');
    ws = splitInto(ws, 'c', 'a', 'bottom');
    ws = splitInto(ws, 'd', 'c', 'right');
    ws = splitInto(ws, 'e', 'b', 'top');
    expect(tree(ws.tabs[0].root)).toBe('row(column(a,row(c,d)),column(e,b))');
    const ids = slots(ws.tabs[0].root);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('#212 AC-3: closing or detaching a pane collapses its parent, the rest stays', () => {
    let ws = splitInto(open('a', 'b', 'c', 'd'), 'b', 'a', 'right');
    ws = splitInto(ws, 'c', 'a', 'bottom');
    ws = splitInto(ws, 'd', 'c', 'right');
    const before = ws.tabs[0].root;
    const closed = closeSession(ws, 'd').tabs[0].root;
    expect(tree(closed)).toBe('row(column(a,c),b)');
    expect(slotOf(closed, 'a')).toBe(slotOf(before, 'a'));
    expect(slotOf(closed, 'b')).toBe(slotOf(before, 'b'));
    const detached = detachSession(ws, 'a');
    expect(detached.tabs.map((t) => tree(t.root))).toEqual(['row(row(c,d),b)', 'a']);
    expect(slotOf(detached.tabs[0].root, 'b')).toBe(slotOf(before, 'b'));
    expect(closeSession(closeSession(open('a'), 'a'), 'a').tabs).toEqual([]);
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
    // #212 AC-7: the buttons lay all panes out flat again, whatever the tree was
    let nested = splitInto(open('a', 'b', 'c', 'd', 'e'), 'b', 'a', 'right');
    for (const id of ['c', 'd', 'e']) nested = splitInto(nested, id, 'a', 'bottom');
    const flat = (layout: 'columns' | 'rows' | 'grid') => {
      const tab = setTabLayout(nested, 't1', layout).tabs[0];
      expect(tab.layout).toBe(layout);
      return tree(tab.root);
    };
    expect(tree(nested.tabs[0].root)).toBe('row(column(column(column(a,e),d),c),b)');
    expect(flat('columns')).toBe('row(a,e,d,c,b)');
    expect(flat('rows')).toBe('column(a,e,d,c,b)');
    expect(flat('grid')).toBe('column(row(a,e),row(d,c),b)');
    expect(setTabLayout(nested, 't1', 'grid').tabs[0].activeSessionId).toBe(
      nested.tabs[0].activeSessionId
    );
    expect(setTabLayout(split, 't1', 'single')).toBe(split);
  });
  it('focusSession ignores unknown ids; activateTab switches tabs', () => {
    const ws = open('a', 'b');
    expect(focusSession(ws, 'x')).toBe(ws);
    expect(activateTab(ws, 't1').activeTabId).toBe('t1');
  });

  it("focusSession on a pane makes it the tab's active session (drives the rail reveal)", () => {
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
  it('#212 AC-4: loads the flat shape before the split tree without losing a pane', () => {
    // as written by the app before #212 (localStorage devOrbitAgentWorkspace.v2)
    const stored = {
      tabs: [
        { id: 't1', panes: ['a'], layout: 'single', activeSessionId: 'a' },
        {
          id: 't4',
          panes: ['b', 'browser:1:http://localhost:3000/'],
          layout: 'columns',
          activeSessionId: 'b',
        },
        { id: 't2', panes: ['c', 'd', 'shell:1:/tmp'], layout: 'rows', activeSessionId: 'd' },
        { id: 't7', panes: ['e', 'f', 'g', 'h', 'i'], layout: 'grid', activeSessionId: 'h' },
      ],
      activeTabId: 't2',
    };
    const ws = migrateWorkspace(stored);
    expect(ws.tabs.map((t) => [t.id, t.panes, t.layout, t.activeSessionId])).toEqual(
      stored.tabs.map((t) => [t.id, t.panes, t.layout, t.activeSessionId])
    );
    expect(ws.activeTabId).toBe('t2');
    expect(ws.tabs.map((t) => tree(t.root))).toEqual([
      'a',
      'row(b,browser:1:http://localhost:3000/)',
      'column(c,d,shell:1:/tmp)',
      'column(row(e,f),row(g,h),i)',
    ]);
    for (const t of ws.tabs) expect(new Set(slots(t.root)).size).toBe(slots(t.root).length);
  });
  it('#212 AC-4: repairs a damaged tree instead of dropping the tab', () => {
    const ws = migrateWorkspace({
      tabs: [
        {
          id: 't1',
          root: {
            id: 's1',
            dir: 'row',
            children: [
              { id: 's1', pane: 'a' },
              { dir: 'column', children: [{ pane: 'b' }, { pane: 'a' }, 'junk'] },
              { id: 's9', dir: 'diagonal', children: [{ id: 's8', pane: 'lost' }] },
            ],
          },
          activeSessionId: 'b',
        },
        { id: 't2', root: { dir: 'row', children: [] }, panes: ['c', 'd'], layout: 'rows' },
      ],
      activeTabId: 't1',
    });
    expect(ws.tabs.map((t) => tree(t.root))).toEqual(['row(a,b)', 'column(c,d)']);
    expect(ws.tabs[0].activeSessionId).toBe('b');
    expect(new Set(slots(ws.tabs[0].root)).size).toBe(3);
  });
});

describe('openBrowser', () => {
  const url = 'http://localhost:5173/';
  it('splits a browser pane right of the clicking pane', () => {
    const ws = openBrowser(splitInto(open('a', 'b'), 'b', 'a', 'right'), 'a', url);
    const tab = activeTab(ws)!;
    expect(tab.panes.map((p) => browserUrl(p) ?? p)).toEqual(['a', url, 'b']);
    expect(tab.layout).toBe('custom');
    expect(browserUrl(tab.activeSessionId)).toBe(url);
  });

  it("reuses the tab's browser pane for the next link", () => {
    const first = openBrowser(open('a'), 'a', url);
    const ws = openBrowser(first, 'a', 'https://github.com/x');
    expect(activeTab(ws)!.panes.map((p) => browserUrl(p) ?? p)).toEqual([
      'a',
      'https://github.com/x',
    ]);
  });

  it('gives each tab its own browser pane', () => {
    const ws = openBrowser(openBrowser(open('a', 'b'), 'a', url), 'b', url);
    const browsers = ws.tabs.flatMap((t) => t.panes).filter((p) => browserUrl(p));
    expect(new Set(browsers).size).toBe(2);
  });

  it('ignores unknown panes and non-http urls', () => {
    const ws = open('a');
    expect(openBrowser(ws, 'zz', url)).toBe(ws);
    expect(openBrowser(ws, 'a', 'file:///etc/passwd')).toBe(ws);
  });

  it('survives prune and migration', () => {
    const ws = openBrowser(open('a'), 'a', url);
    expect(pruneMissing(ws, new Set(['a']))).toEqual(ws);
    expect(migrateWorkspace(JSON.parse(JSON.stringify(ws)))).toEqual(ws);
  });

  it('parses only browser pane ids', () => {
    expect(browserUrl('abc123')).toBeNull();
    expect(browserUrl('browser:1:https://a.b/c?d=1:2')).toBe('https://a.b/c?d=1:2');
  });
});

describe('openShell (#207)', () => {
  const cwd = '/Users/me/PROJECTS/app';

  it('opens a shell as its own active tab', () => {
    const ws = openShell(open('a'), cwd);
    expect(ws.tabs).toHaveLength(2);
    expect(activeTab(ws)?.panes).toEqual([`shell:1:${cwd}`]);
    expect(shellCwd(activeTab(ws)!.panes[0])).toBe(cwd);
  });

  it('gives several shells in one directory unique ids', () => {
    const ws = openShell(openShell(EMPTY_WORKSPACE, cwd), cwd);
    const ids = ws.tabs.flatMap((t) => t.panes);
    expect(ids).toEqual([`shell:1:${cwd}`, `shell:2:${cwd}`]);
  });

  it('reuses a freed number and ignores an empty cwd', () => {
    const ws = openShell(openShell(EMPTY_WORKSPACE, cwd), '/tmp');
    const freed = closeSession(ws, `shell:1:${cwd}`);
    expect(activeTab(openShell(freed, cwd))?.panes).toEqual([`shell:1:${cwd}`]);
    expect(openShell(ws, '')).toBe(ws);
  });

  it('survives prune and migration', () => {
    const ws = openShell(open('a'), cwd);
    expect(pruneMissing(ws, new Set(['a']))).toEqual(ws);
    expect(migrateWorkspace(JSON.parse(JSON.stringify(ws)))).toEqual(ws);
  });

  it('parses only shell pane ids, colons in the path included', () => {
    expect(shellCwd('abc123')).toBeNull();
    expect(shellCwd('shell:1:')).toBeNull();
    expect(shellCwd('browser:1:https://a.b')).toBeNull();
    expect(shellCwd('shell:3:/a/b:c')).toBe('/a/b:c');
  });
});
