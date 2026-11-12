/** dataTransfer type marking a dragged agent tab / pane (what is dragged lives in component state) */
export const AGENT_TAB_MIME = 'application/x-devorbit-agent-tab';

export type DropZone = 'left' | 'right' | 'top' | 'bottom';
export type InsertPosition = 'before' | 'after';

interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Which half of a tab the pointer is over (horizontal strip) */
export function insertPosition(rect: RectLike, x: number): InsertPosition {
  return x < rect.left + rect.width / 2 ? 'before' : 'after';
}

/** Edge zone of a pane closest to the pointer (diagonals resolve by the nearer edge) */
export function dropZone(rect: RectLike, x: number, y: number): DropZone {
  const fx = rect.width ? (x - rect.left) / rect.width : 0.5;
  const fy = rect.height ? (y - rect.top) / rect.height : 0.5;
  const distances: [DropZone, number][] = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy],
  ];
  return distances.reduce((best, d) => (d[1] < best[1] ? d : best))[0];
}

/** Split orientation for a zone: left/right side by side, top/bottom stacked */
export function layoutForZone(zone: DropZone): 'columns' | 'rows' {
  return zone === 'left' || zone === 'right' ? 'columns' : 'rows';
}

/**
 * Index move that puts `id` directly before/after `targetId`, in the
 * `(from, to)` form of splice-out then splice-in. Null when nothing changes.
 */
export function reorderIndices(
  order: string[],
  id: string,
  targetId: string,
  position: InsertPosition
): { from: number; to: number } | null {
  const from = order.indexOf(id);
  const target = order.indexOf(targetId);
  if (from < 0 || target < 0 || id === targetId) return null;
  const slot = position === 'before' ? target : target + 1;
  const to = from < slot ? slot - 1 : slot;
  return to === from ? null : { from, to };
}

/** Move by one slot (keyboard); null at the ends */
export function stepIndices(
  order: string[],
  id: string,
  delta: -1 | 1
): { from: number; to: number } | null {
  const from = order.indexOf(id);
  const to = from + delta;
  return from < 0 || to < 0 || to >= order.length ? null : { from, to };
}

/** Zone -> position relative to the anchor pane (left/top come first) */
export function positionForZone(zone: DropZone): InsertPosition {
  return zone === 'left' || zone === 'top' ? 'before' : 'after';
}

// ---------------------------------------------------------------------------
// Workspace model: tabs hold panes (session ids) in a split tree. A session lives in at
// most one tab; splitting moves a session into another tab's tree, never adds a tab.
// ---------------------------------------------------------------------------

export type PaneLayout = 'single' | 'columns' | 'rows' | 'grid';
/** What a tab's tree amounts to; `custom` is any nesting the layout buttons do not produce */
export type TabLayout = PaneLayout | 'custom';

/**
 * Split tree (#212): a leaf is a pane, a node lays its children out side by side (`row`) or
 * stacked (`column`). `id` names the slot, unique within the tab and stable while the tree is
 * rearranged, so the rendering keeps panels (and their sizes) that a change does not touch.
 */
export type SplitNode =
  | { id: string; pane: string }
  | { id: string; dir: 'row' | 'column'; children: SplitNode[] };

export interface WorkspaceTab {
  id: string;
  root: SplitNode;
  /** Leaves of `root` in reading order (derived, also what older versions read back) */
  panes: string[];
  /** Derived from `root` */
  layout: TabLayout;
  activeSessionId: string;
}

export interface Workspace {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
}

export const EMPTY_WORKSPACE: Workspace = { tabs: [], activeTabId: null };

const isLeaf = (node: SplitNode): node is { id: string; pane: string } => 'pane' in node;

export const leaves = (node: SplitNode): string[] =>
  isLeaf(node) ? [node.pane] : node.children.flatMap(leaves);

const slotIds = (node: SplitNode): string[] =>
  isLeaf(node) ? [node.id] : [node.id, ...node.children.flatMap(slotIds)];

/** `count` slot ids not used in `root` */
function freshIds(root: SplitNode | null, count: number): string[] {
  const used = new Set(root ? slotIds(root) : []);
  const ids: string[] = [];
  for (let n = 1; ids.length < count; n++) {
    if (!used.has(`s${n}`)) ids.push(`s${n}`);
  }
  return ids;
}

const isLeafRow = (node: SplitNode) =>
  !isLeaf(node) && node.dir === 'row' && node.children.length === 2 && node.children.every(isLeaf);

function layoutOf(root: SplitNode): TabLayout {
  if (isLeaf(root)) return 'single';
  if (root.children.every(isLeaf)) return root.dir === 'row' ? 'columns' : 'rows';
  const last = root.children[root.children.length - 1];
  const grid =
    root.dir === 'column' &&
    root.children.slice(0, -1).every(isLeafRow) &&
    (isLeaf(last) || isLeafRow(last));
  return grid ? 'grid' : 'custom';
}

/** All panes flat: side by side, stacked, or two per row (an odd last pane spans the width) */
function flatRoot(panes: string[], layout: PaneLayout): SplitNode {
  const ids = freshIds(null, panes.length * 2);
  const leaf = (pane: string) => ({ id: ids.shift()!, pane });
  if (panes.length === 1) return leaf(panes[0]);
  if (layout !== 'grid' || panes.length === 2) {
    return {
      id: ids.shift()!,
      dir: layout === 'rows' ? 'column' : 'row',
      children: panes.map(leaf),
    };
  }
  const rows: SplitNode[] = [];
  for (let i = 0; i < panes.length; i += 2) {
    const pair = panes.slice(i, i + 2).map(leaf);
    rows.push(pair.length === 1 ? pair[0] : { id: ids.shift()!, dir: 'row', children: pair });
  }
  return { id: ids.shift()!, dir: 'column', children: rows };
}

/**
 * `root` without the panes `keep` rejects. A node left with one child collapses into it: the
 * child takes over the node's slot, so the sibling fills the freed space and nothing else moves.
 */
export function prunedRoot(root: SplitNode, keep: (pane: string) => boolean): SplitNode | null {
  if (isLeaf(root)) return keep(root.pane) ? root : null;
  const children = root.children
    .map((child) => prunedRoot(child, keep))
    .filter((child): child is SplitNode => child !== null);
  if (children.length === root.children.length && children.every((c, i) => c === root.children[i]))
    return root;
  if (children.length === 0) return null;
  return children.length === 1 ? { ...children[0], id: root.id } : { ...root, children };
}

const mapLeaf = (
  root: SplitNode,
  pane: string,
  fn: (leaf: { id: string; pane: string }) => SplitNode
): SplitNode =>
  isLeaf(root)
    ? root.pane === pane
      ? fn(root)
      : root
    : { ...root, children: root.children.map((child) => mapLeaf(child, pane, fn)) };

const makeTab = (id: string, root: SplitNode, activeSessionId: string): WorkspaceTab => ({
  id,
  root,
  panes: leaves(root),
  layout: layoutOf(root),
  activeSessionId,
});

const soloTab = (id: string, pane: string) => makeTab(id, { id: 's1', pane }, pane);

const tabIndexOf = (ws: Workspace, sessionId: string) =>
  ws.tabs.findIndex((t) => t.panes.includes(sessionId));

function nextTabId(tabs: WorkspaceTab[]): string {
  const used = new Set(tabs.map((t) => t.id));
  let n = tabs.length + 1;
  while (used.has(`t${n}`)) n++;
  return `t${n}`;
}

/** Remove a session from its tab; an emptied tab vanishes and the active tab / pane are re-picked */
function removeSession(ws: Workspace, sessionId: string): Workspace {
  const index = tabIndexOf(ws, sessionId);
  if (index < 0) return ws;
  const tab = ws.tabs[index];
  const root = prunedRoot(tab.root, (pane) => pane !== sessionId);
  if (!root) {
    const tabs = ws.tabs.filter((t) => t.id !== tab.id);
    const activeTabId =
      ws.activeTabId === tab.id ? ((tabs[index] ?? tabs[index - 1])?.id ?? null) : ws.activeTabId;
    return { tabs, activeTabId };
  }
  const panes = leaves(root);
  const paneIndex = tab.panes.indexOf(sessionId);
  const activeSessionId =
    tab.activeSessionId === sessionId
      ? (panes[paneIndex] ?? panes[paneIndex - 1])
      : tab.activeSessionId;
  return {
    ...ws,
    tabs: ws.tabs.map((t) => (t === tab ? makeTab(t.id, root, activeSessionId) : t)),
  };
}

/** Focus a session: activates its tab and pane. Unknown sessions change nothing. */
export function focusSession(ws: Workspace, sessionId: string): Workspace {
  const tab = ws.tabs[tabIndexOf(ws, sessionId)];
  if (!tab) return ws;
  if (ws.activeTabId === tab.id && tab.activeSessionId === sessionId) return ws;
  return {
    tabs: ws.tabs.map((t) => (t === tab ? { ...t, activeSessionId: sessionId } : t)),
    activeTabId: tab.id,
  };
}

/** Attach: focus the existing pane, or open a new single-pane tab */
export function openSession(ws: Workspace, sessionId: string): Workspace {
  if (tabIndexOf(ws, sessionId) >= 0) return focusSession(ws, sessionId);
  const id = nextTabId(ws.tabs);
  return { tabs: [...ws.tabs, soloTab(id, sessionId)], activeTabId: id };
}

export function activateTab(ws: Workspace, tabId: string): Workspace {
  return ws.activeTabId === tabId || !ws.tabs.some((t) => t.id === tabId)
    ? ws
    : { ...ws, activeTabId: tabId };
}

/** Close one pane (the session keeps running, it is just no longer attached here) */
export const closeSession = removeSession;

export function closeTab(ws: Workspace, tabId: string): Workspace {
  const tab = ws.tabs.find((t) => t.id === tabId);
  return tab ? tab.panes.reduce(removeSession, ws) : ws;
}

/**
 * Split the pane `targetId` and put `sessionId` on the zone's side of it. Only the target gives
 * up space (half of it); every other pane keeps its place. The session leaves its old tab.
 * No-op for self / unknown target.
 */
export function splitInto(
  ws: Workspace,
  sessionId: string,
  targetId: string,
  zone: DropZone
): Workspace {
  if (sessionId === targetId || tabIndexOf(ws, targetId) < 0) return ws;
  const without = removeSession(ws, sessionId);
  const targetTab = without.tabs[tabIndexOf(without, targetId)];
  const [a, b] = freshIds(targetTab.root, 2);
  const root = mapLeaf(targetTab.root, targetId, (leaf) => {
    const pair = [
      { id: a, pane: targetId },
      { id: b, pane: sessionId },
    ];
    // The new node takes the target's slot: its neighbours keep their panels
    return {
      id: leaf.id,
      dir: layoutForZone(zone) === 'columns' ? 'row' : 'column',
      children: positionForZone(zone) === 'after' ? pair : pair.reverse(),
    };
  });
  return {
    tabs: without.tabs.map((t) => (t.id === targetTab.id ? makeTab(t.id, root, sessionId) : t)),
    activeTabId: targetTab.id,
  };
}

/** Pull a pane out into its own tab right after its old one. Single-pane tabs are just focused. */
export function detachSession(ws: Workspace, sessionId: string): Workspace {
  const index = tabIndexOf(ws, sessionId);
  if (index < 0) return ws;
  if (ws.tabs[index].panes.length === 1) return focusSession(ws, sessionId);
  const without = removeSession(ws, sessionId);
  const id = nextTabId(without.tabs);
  const tabs = [...without.tabs];
  tabs.splice(index + 1, 0, soloTab(id, sessionId));
  return { tabs, activeTabId: id };
}

/** Put a tab directly before/after another tab */
export function moveTab(
  ws: Workspace,
  tabId: string,
  targetId: string,
  position: InsertPosition
): Workspace {
  const move = reorderIndices(
    ws.tabs.map((t) => t.id),
    tabId,
    targetId,
    position
  );
  if (!move) return ws;
  const tabs = [...ws.tabs];
  tabs.splice(move.to, 0, tabs.splice(move.from, 1)[0]);
  return { ...ws, tabs };
}

/** Rearrange all panes of a tab flat (layout buttons); ignored for tabs with fewer than two panes */
export function setTabLayout(ws: Workspace, tabId: string, layout: PaneLayout): Workspace {
  const tab = ws.tabs.find((t) => t.id === tabId);
  if (!tab || tab.panes.length < 2 || layout === 'single' || tab.layout === layout) return ws;
  const root = flatRoot(tab.panes, layout);
  return {
    ...ws,
    tabs: ws.tabs.map((t) => (t === tab ? makeTab(t.id, root, t.activeSessionId) : t)),
  };
}

/** Drop sessions that no longer exist (call only once the session list has loaded) */
export function pruneMissing(ws: Workspace, existing: ReadonlySet<string>): Workspace {
  return ws.tabs
    .flatMap((t) => t.panes)
    .filter((id) => !existing.has(id) && browserUrl(id) === null && shellCwd(id) === null)
    .reduce(removeSession, ws);
}

// Browser panes live next to session panes; the url is part of the pane id so it persists
const BROWSER_PREFIX = 'browser:';

/** Url of a browser pane id (`browser:<n>:<url>`), null for session panes */
export function browserUrl(paneId: string): string | null {
  if (!paneId.startsWith(BROWSER_PREFIX)) return null;
  const rest = paneId.slice(BROWSER_PREFIX.length);
  const colon = rest.indexOf(':');
  return colon < 0 ? null : rest.slice(colon + 1);
}

/**
 * Show `url` in the browser pane of `fromId`'s tab: reuse that tab's browser pane,
 * else split one in right of `fromId`. Only http(s); unknown panes change nothing.
 */
export function openBrowser(ws: Workspace, fromId: string, url: string): Workspace {
  const tab = ws.tabs[tabIndexOf(ws, fromId)];
  if (!tab || !/^https?:\/\//i.test(url)) return ws;
  const used = new Set(ws.tabs.flatMap((t) => t.panes));
  let n = 1;
  while ([...used].some((id) => id.startsWith(`${BROWSER_PREFIX}${n}:`))) n++;
  const id = `${BROWSER_PREFIX}${n}:${url}`;
  const existing = tab.panes.find((p) => browserUrl(p) !== null);
  if (!existing) return splitInto(ws, id, fromId, 'right');
  return {
    tabs: ws.tabs.map((t) =>
      t === tab
        ? makeTab(
            t.id,
            mapLeaf(t.root, existing, (leaf) => ({ ...leaf, pane: id })),
            id
          )
        : t
    ),
    activeTabId: tab.id,
  };
}

// Shell panes (#207): a plain shell, no agent; the cwd is part of the id so it persists
const SHELL_PREFIX = 'shell:';

/** Working directory of a shell pane id (`shell:<n>:<cwd>`), null for other panes */
export function shellCwd(paneId: string): string | null {
  if (!paneId.startsWith(SHELL_PREFIX)) return null;
  const rest = paneId.slice(SHELL_PREFIX.length);
  const colon = rest.indexOf(':');
  return colon < 0 || !rest.slice(colon + 1) ? null : rest.slice(colon + 1);
}

/** Open a new shell in `cwd` as its own, active tab; several shells per directory are fine */
export function openShell(ws: Workspace, cwd: string): Workspace {
  if (!cwd) return ws;
  const used = ws.tabs.flatMap((t) => t.panes);
  let n = 1;
  while (used.some((id) => id.startsWith(`${SHELL_PREFIX}${n}:`))) n++;
  return openSession(ws, `${SHELL_PREFIX}${n}:${cwd}`);
}

/** Tab title: the name for one pane, "A + B" for two, "N agents" beyond */
export function tabTitle(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return names.length === 2 ? `${names[0]} + ${names[1]}` : `${names.length} agents`;
}

const isLayout = (v: unknown): v is PaneLayout =>
  v === 'single' || v === 'columns' || v === 'rows' || v === 'grid';

/**
 * Normalise anything read from storage: the current shape (tabs with a split tree), the flat
 * shape before #212 (`panes` + `layout`), the legacy `{openIds, activeId}` shape (one tab per
 * id), or garbage (empty workspace). A duplicate session keeps its first pane; malformed tabs
 * and tree parts are dropped.
 */
export function migrateWorkspace(raw: unknown): Workspace {
  if (!raw || typeof raw !== 'object') return EMPTY_WORKSPACE;
  const data = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const fresh = (x: unknown): x is string => {
    if (typeof x !== 'string' || !x || seen.has(x)) return false;
    seen.add(x);
    return true;
  };
  const sessionIds = (v: unknown): string[] => (Array.isArray(v) ? v : []).filter(fresh);
  // Stored slot ids are kept while unique in their tab; missing or doubled ones are replaced
  let slots = new Set<string>();
  const slotId = (v: unknown): string => {
    if (typeof v !== 'string' || !v || slots.has(v)) return '';
    slots.add(v);
    return v;
  };
  const parse = (v: unknown): SplitNode | null => {
    if (!v || typeof v !== 'object') return null;
    const node = v as Record<string, unknown>;
    if ('pane' in node) return fresh(node.pane) ? { id: slotId(node.id), pane: node.pane } : null;
    if ((node.dir !== 'row' && node.dir !== 'column') || !Array.isArray(node.children)) return null;
    const children = node.children.map(parse).filter((c): c is SplitNode => c !== null);
    if (children.length < 2) return children[0] ?? null;
    return { id: slotId(node.id), dir: node.dir, children };
  };
  const withIds = (root: SplitNode): SplitNode => {
    const spare = freshIds(root, slotIds(root).length);
    const fill = (node: SplitNode): SplitNode => {
      const id = node.id || spare.shift()!;
      return isLeaf(node) ? { ...node, id } : { ...node, id, children: node.children.map(fill) };
    };
    return fill(root);
  };

  const tabs: WorkspaceTab[] = [];
  let activeTabId: string | null = null;
  if (Array.isArray(data.tabs)) {
    for (const entry of data.tabs as Record<string, unknown>[]) {
      if (typeof entry?.id !== 'string' || tabs.some((t) => t.id === entry.id)) continue;
      slots = new Set();
      let root = parse(entry.root);
      if (root) root = withIds(root);
      else {
        const panes = sessionIds(entry.panes);
        if (panes.length === 0) continue;
        root = flatRoot(panes, isLayout(entry.layout) ? entry.layout : 'columns');
      }
      const panes = leaves(root);
      tabs.push(
        makeTab(
          entry.id,
          root,
          panes.includes(entry.activeSessionId as string)
            ? (entry.activeSessionId as string)
            : panes[0]
        )
      );
    }
    if (typeof data.activeTabId === 'string') activeTabId = data.activeTabId;
  } else if (Array.isArray(data.openIds)) {
    sessionIds(data.openIds).forEach((id, i) => tabs.push(soloTab(`t${i + 1}`, id)));
    activeTabId = tabs.find((t) => t.panes[0] === data.activeId)?.id ?? null;
  }
  if (!tabs.some((t) => t.id === activeTabId)) activeTabId = tabs[tabs.length - 1]?.id ?? null;
  return { tabs, activeTabId };
}
