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
// Workspace model: tabs hold panes (session ids). A session lives in at most
// one tab; splitting moves a session into another tab's panes, never adds a tab.
// ---------------------------------------------------------------------------

export type PaneLayout = 'single' | 'columns' | 'rows' | 'grid';

export interface WorkspaceTab {
  id: string;
  panes: string[];
  layout: PaneLayout;
  activeSessionId: string;
}

export interface Workspace {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
}

export const EMPTY_WORKSPACE: Workspace = { tabs: [], activeTabId: null };

const tabIndexOf = (ws: Workspace, sessionId: string) =>
  ws.tabs.findIndex((t) => t.panes.includes(sessionId));

function nextTabId(tabs: WorkspaceTab[]): string {
  const used = new Set(tabs.map((t) => t.id));
  let n = tabs.length + 1;
  while (used.has(`t${n}`)) n++;
  return `t${n}`;
}

/** single iff one pane; never single for 2+ */
function fitLayout(layout: PaneLayout, count: number): PaneLayout {
  if (count <= 1) return 'single';
  return layout === 'single' ? 'columns' : layout;
}

/** Remove a session from its tab; an emptied tab vanishes and the active tab / pane are re-picked */
function removeSession(ws: Workspace, sessionId: string): Workspace {
  const index = tabIndexOf(ws, sessionId);
  if (index < 0) return ws;
  const tab = ws.tabs[index];
  const panes = tab.panes.filter((p) => p !== sessionId);
  if (panes.length === 0) {
    const tabs = ws.tabs.filter((t) => t.id !== tab.id);
    const activeTabId =
      ws.activeTabId === tab.id ? ((tabs[index] ?? tabs[index - 1])?.id ?? null) : ws.activeTabId;
    return { tabs, activeTabId };
  }
  const paneIndex = tab.panes.indexOf(sessionId);
  const activeSessionId =
    tab.activeSessionId === sessionId
      ? (panes[paneIndex] ?? panes[paneIndex - 1])
      : tab.activeSessionId;
  return {
    ...ws,
    tabs: ws.tabs.map((t) =>
      t === tab ? { ...t, panes, activeSessionId, layout: fitLayout(t.layout, panes.length) } : t
    ),
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
  return {
    tabs: [...ws.tabs, { id, panes: [sessionId], layout: 'single', activeSessionId: sessionId }],
    activeTabId: id,
  };
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
 * Move `sessionId` next to `targetId` on the zone's side, inside the target's tab.
 * The session leaves its old tab. No-op for self / unknown target.
 */
export function splitInto(
  ws: Workspace,
  sessionId: string,
  targetId: string,
  zone: DropZone
): Workspace {
  if (sessionId === targetId || tabIndexOf(ws, targetId) < 0) return ws;
  const orientation = layoutForZone(zone);
  const without = removeSession(ws, sessionId);
  const targetTab = without.tabs[tabIndexOf(without, targetId)];
  const panes = targetTab.panes.filter((p) => p !== sessionId);
  panes.splice(panes.indexOf(targetId) + (positionForZone(zone) === 'after' ? 1 : 0), 0, sessionId);
  // 2 panes follow the drop direction; more keep it only when it matches, else grid
  const layout: PaneLayout =
    panes.length === 2 || targetTab.layout === orientation ? orientation : 'grid';
  return {
    tabs: without.tabs.map((t) =>
      t.id === targetTab.id ? { ...t, panes, layout, activeSessionId: sessionId } : t
    ),
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
  tabs.splice(index + 1, 0, {
    id,
    panes: [sessionId],
    layout: 'single',
    activeSessionId: sessionId,
  });
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

/** Manual layout override; ignored for tabs with fewer than two panes */
export function setTabLayout(ws: Workspace, tabId: string, layout: PaneLayout): Workspace {
  const tab = ws.tabs.find((t) => t.id === tabId);
  if (!tab || tab.panes.length < 2 || layout === 'single' || tab.layout === layout) return ws;
  return { ...ws, tabs: ws.tabs.map((t) => (t === tab ? { ...t, layout } : t)) };
}

/** Drop sessions that no longer exist (call only once the session list has loaded) */
export function pruneMissing(ws: Workspace, existing: ReadonlySet<string>): Workspace {
  return ws.tabs
    .flatMap((t) => t.panes)
    .filter((id) => !existing.has(id) && browserUrl(id) === null)
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
        ? { ...t, panes: t.panes.map((p) => (p === existing ? id : p)), activeSessionId: id }
        : t
    ),
    activeTabId: tab.id,
  };
}

/** Tab title: the name for one pane, "A + B" for two, "N agents" beyond */
export function tabTitle(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return names.length === 2 ? `${names[0]} + ${names[1]}` : `${names.length} agents`;
}

const isLayout = (v: unknown): v is PaneLayout =>
  v === 'single' || v === 'columns' || v === 'rows' || v === 'grid';

/**
 * Normalise anything read from storage: the current `{tabs, activeTabId}` shape, the
 * legacy `{openIds, activeId}` shape (one tab per id), or garbage (empty workspace).
 * A duplicate session keeps its first pane; malformed tabs are dropped.
 */
export function migrateWorkspace(raw: unknown): Workspace {
  if (!raw || typeof raw !== 'object') return EMPTY_WORKSPACE;
  const data = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const sessionIds = (v: unknown): string[] =>
    (Array.isArray(v) ? v : []).filter((x): x is string => {
      if (typeof x !== 'string' || !x || seen.has(x)) return false;
      seen.add(x);
      return true;
    });

  const tabs: WorkspaceTab[] = [];
  let activeTabId: string | null = null;
  if (Array.isArray(data.tabs)) {
    for (const entry of data.tabs as Record<string, unknown>[]) {
      const panes = sessionIds(entry?.panes);
      if (panes.length === 0 || typeof entry.id !== 'string' || tabs.some((t) => t.id === entry.id))
        continue;
      tabs.push({
        id: entry.id,
        panes,
        layout: fitLayout(isLayout(entry.layout) ? entry.layout : 'columns', panes.length),
        activeSessionId: panes.includes(entry.activeSessionId as string)
          ? (entry.activeSessionId as string)
          : panes[0],
      });
    }
    if (typeof data.activeTabId === 'string') activeTabId = data.activeTabId;
  } else if (Array.isArray(data.openIds)) {
    sessionIds(data.openIds).forEach((id, i) =>
      tabs.push({ id: `t${i + 1}`, panes: [id], layout: 'single', activeSessionId: id })
    );
    activeTabId = tabs.find((t) => t.panes[0] === data.activeId)?.id ?? null;
  }
  if (!tabs.some((t) => t.id === activeTabId)) activeTabId = tabs[tabs.length - 1]?.id ?? null;
  return { tabs, activeTabId };
}
