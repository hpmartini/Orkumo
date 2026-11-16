import { useCallback, useMemo, useState } from 'react';
import type { AgentGrouping } from '../types';
import type { SessionGroup, GroupKey } from '../utils/agentSessions';

/** Key of the synthetic group holding favorite agents (always first, not reorderable) */
export const FAVORITES_GROUP_KEY = 'favorites';

export const STORAGE_KEY = 'devOrbitAgentRail.v1';

interface ModePrefs {
  collapsed: string[];
  /** Manual group order (group keys); groups not listed keep their default order after these */
  order: string[];
}

interface RailPrefs {
  modes: Record<string, ModePrefs>;
  favoriteGroups: string[];
  favoriteSessions: string[];
  /** Agent rows whose details are open */
  expandedSessions: string[];
  /** Directories of fixed projects (#253): their project groups stay without sessions */
  fixedProjects: string[];
  /** Manual agent order per group key (#299): session ids, used by the "Manual" sort */
  sessionOrder: Record<string, string[]>;
}

const EMPTY_MODE: ModePrefs = { collapsed: [], order: [] };
const EMPTY: RailPrefs = {
  modes: {},
  favoriteGroups: [],
  favoriteSessions: [],
  expandedSessions: [],
  fixedProjects: [],
  sessionOrder: {},
};

// ---------------------------------------------------------------------
// Pure reducers
// ---------------------------------------------------------------------

const toggleIn = (list: string[], key: string): string[] =>
  list.includes(key) ? list.filter((k) => k !== key) : [...list, key];

export const toggleCollapsed = toggleIn;
export const toggleFavoriteGroup = toggleIn;
export const toggleFavoriteSession = toggleIn;
export const toggleExpandedSession = toggleIn;
export const toggleFixedProject = toggleIn;

/** Drops ids not in `known`; returns the same array when nothing is dropped */
export const keepKnown = (list: string[], known: Set<string>): string[] =>
  list.every((id) => known.has(id)) ? list : list.filter((id) => known.has(id));

/**
 * Adjacent group in `keys` (display order) within the same favorite/other block, as favorites
 * always sort first; undefined at a block edge or for an unknown key.
 */
export function groupNeighbour(
  keys: string[],
  favoriteKeys: string[],
  key: string,
  dir: -1 | 1
): string | undefined {
  const index = keys.indexOf(key);
  const other = index < 0 ? undefined : keys[index + dir];
  return other && favoriteKeys.includes(other) === favoriteKeys.includes(key) ? other : undefined;
}

/** Collapses the given groups, keeping groups that are collapsed but currently not listed */
export const collapseAll = (collapsed: string[], keys: string[]): string[] => [
  ...new Set([...collapsed, ...keys]),
];

/** Expands the given groups, or every group when no keys are given */
export const expandAll = (collapsed: string[], keys?: string[]): string[] =>
  keys ? collapsed.filter((k) => !keys.includes(k)) : [];

/** Opens (`open`) or closes the details of the given agent rows */
export const setExpanded = (expanded: string[], ids: string[], open: boolean): string[] => {
  if (open) return [...new Set([...expanded, ...ids])];
  const close = new Set(ids);
  return expanded.filter((id) => !close.has(id));
};

/**
 * Orders groups: favorites first, then by the manual order. Groups missing from the order
 * (new ones) stay at the end of their block in their original order.
 */
export function applyGroupOrder<T extends { key: string }>(
  groups: T[],
  order: string[],
  favoriteKeys: string[] = []
): T[] {
  const rank = (g: T) => {
    const i = order.indexOf(g.key);
    return i < 0 ? Infinity : i;
  };
  const fav = (g: T) => (favoriteKeys.includes(g.key) ? 0 : 1);
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => fav(a.g) - fav(b.g) || rank(a.g) - rank(b.g) || a.i - b.i)
    .map(({ g }) => g);
}

/**
 * Moves `key` to the position of `targetKey` among the visible groups (drag-and-drop drop
 * target, or the neighbour for "Move up/down"). Returns the new manual order; keys that are
 * not visible keep their entry after the visible ones.
 */
export function moveGroup(
  order: string[],
  visibleKeys: string[],
  key: string,
  targetKey: string
): string[] {
  const current = applyGroupOrder(
    visibleKeys.map((k) => ({ key: k })),
    order
  ).map((g) => g.key);
  const from = current.indexOf(key);
  const to = current.indexOf(targetKey);
  if (from < 0 || to < 0 || from === to) return order;
  current.splice(to, 0, current.splice(from, 1)[0]);
  return [...current, ...order.filter((k) => !visibleKeys.includes(k))];
}

/**
 * Applies the manual agent order per group (#299). Sessions missing from a group's stored order
 * (new agents) come first in their incoming order; stored ids that are gone are ignored.
 */
export function applySessionOrder(
  groups: SessionGroup[],
  orders: Record<string, string[]>
): SessionGroup[] {
  return groups.map((g) => {
    const stored = orders[g.key];
    if (!stored?.length) return g;
    const rank = new Map(stored.map((id, i) => [id, i]));
    const known = g.sessions.filter((s) => rank.has(s.id));
    const fresh = g.sessions.filter((s) => !rank.has(s.id));
    known.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    return { ...g, sessions: [...fresh, ...known] };
  });
}

/**
 * New stored order after moving `id` to the slot of `targetId` among the displayed `visibleIds`.
 * Entries of sessions folded away (`hiddenIds`) are kept after them; every other stored id is
 * gone and dropped. Returns `stored` itself when nothing moves.
 */
export function moveSession(
  stored: string[],
  visibleIds: string[],
  hiddenIds: string[],
  id: string,
  targetId: string
): string[] {
  const from = visibleIds.indexOf(id);
  const to = visibleIds.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return stored;
  const next = [...visibleIds];
  next.splice(to, 0, next.splice(from, 1)[0]);
  const hidden = new Set(hiddenIds);
  return [...next, ...stored.filter((x) => hidden.has(x))];
}

/** Key of the group (visible or folded away) that holds the session */
export const findGroupKeyOf = (groups: SessionGroup[], sessionId: string): string | null =>
  groups.find((g) => [...g.sessions, ...g.hidden].some((s) => s.id === sessionId))?.key ?? null;

/** True when the session sits behind a group's "… N more" row, i.e. has no rail row yet */
export const isFoldedAway = (groups: SessionGroup[], sessionId: string): boolean =>
  groups.some((g) => g.hidden.some((s) => s.id === sessionId));

/**
 * Pulls favorite sessions out of their groups into a leading Favorites group (a session never
 * shows up twice, so selection and row keys stay unique).
 */
export function withFavoriteSessions(
  groups: SessionGroup[],
  favoriteIds: string[]
): SessionGroup[] {
  if (favoriteIds.length === 0) return groups;
  const isFav = (s: { id: string }) => favoriteIds.includes(s.id);
  const favorites = groups.flatMap((g) => [...g.sessions, ...g.hidden].filter(isFav));
  if (favorites.length === 0) return groups;
  return [
    {
      key: FAVORITES_GROUP_KEY as GroupKey,
      title: 'Favorites',
      sessions: favorites,
      hidden: [],
    },
    ...groups.map((g) => ({
      ...g,
      sessions: g.sessions.filter((s) => !isFav(s)),
      hidden: g.hidden.filter((s) => !isFav(s)),
    })),
  ];
}

// ---------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function load(): RailPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return EMPTY;
    const modes: Record<string, ModePrefs> = {};
    for (const [mode, value] of Object.entries(raw.modes || {})) {
      const m = value as Partial<ModePrefs>;
      modes[mode] = { collapsed: strings(m?.collapsed), order: strings(m?.order) };
    }
    return {
      modes,
      favoriteGroups: strings(raw.favoriteGroups),
      favoriteSessions: strings(raw.favoriteSessions),
      expandedSessions: strings(raw.expandedSessions),
      fixedProjects: strings(raw.fixedProjects),
      sessionOrder: Object.fromEntries(
        Object.entries(
          raw.sessionOrder && typeof raw.sessionOrder === 'object' ? raw.sessionOrder : {}
        )
          .map(([key, ids]) => [key, strings(ids)] as const)
          .filter(([, ids]) => ids.length > 0)
      ),
    };
  } catch {
    return EMPTY;
  }
}

function save(prefs: RailPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // stays in memory only
  }
}

// ---------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------

/**
 * Per-grouping rail preferences (collapsed groups, manual group order) plus global favorite
 * groups and favorite sessions, persisted in localStorage.
 */
export function useRailPreferences(groupBy: AgentGrouping, contextId?: string) {
  const [state, setState] = useState(() => ({ contextId, prefs: load() }));
  // A project context switch swaps the stored prefs (useProjectContexts): pick them up in the
  // same render. An effect would be too late: child effects (reveal active agent) run first and
  // would save the left context's prefs, favorites included, into the new context's storage.
  if (state.contextId !== contextId) setState({ contextId, prefs: load() });
  const { prefs } = state;
  const mode = prefs.modes[groupBy] || EMPTY_MODE;

  const update = useCallback((fn: (p: RailPrefs) => RailPrefs) => {
    setState((s) => {
      const next = fn(s.prefs);
      if (next === s.prefs) return s;
      save(next);
      return { ...s, prefs: next };
    });
  }, []);
  const updateMode = useCallback(
    (fn: (m: ModePrefs) => ModePrefs) =>
      update((p) => ({
        ...p,
        modes: { ...p.modes, [groupBy]: fn(p.modes[groupBy] || EMPTY_MODE) },
      })),
    [update, groupBy]
  );

  const collapsed = useMemo(() => new Set(mode.collapsed), [mode.collapsed]);
  const favoriteGroups = useMemo(() => new Set(prefs.favoriteGroups), [prefs.favoriteGroups]);
  const favoriteSessions = useMemo(() => new Set(prefs.favoriteSessions), [prefs.favoriteSessions]);
  const expandedSessions = useMemo(() => new Set(prefs.expandedSessions), [prefs.expandedSessions]);

  return {
    collapsed,
    favoriteGroups,
    favoriteSessions,
    expandedSessions,
    toggleCollapsed: useCallback(
      (key: string) => updateMode((m) => ({ ...m, collapsed: toggleCollapsed(m.collapsed, key) })),
      [updateMode]
    ),
    collapseAll: useCallback(
      (keys: string[]) => updateMode((m) => ({ ...m, collapsed: collapseAll(m.collapsed, keys) })),
      [updateMode]
    ),
    expandAll: useCallback(
      (keys?: string[]) => updateMode((m) => ({ ...m, collapsed: expandAll(m.collapsed, keys) })),
      [updateMode]
    ),
    /** Expands the group (favorites and original) that holds the session */
    revealSession: useCallback(
      (groups: SessionGroup[], sessionId: string) => {
        const keys = [
          findGroupKeyOf(groups, sessionId),
          prefs.favoriteSessions.includes(sessionId) ? FAVORITES_GROUP_KEY : null,
        ].filter((k): k is string => !!k);
        if (keys.length) updateMode((m) => ({ ...m, collapsed: expandAll(m.collapsed, keys) }));
      },
      [updateMode, prefs.favoriteSessions]
    ),
    moveGroup: useCallback(
      (key: string, targetKey: string, visibleKeys: string[]) =>
        updateMode((m) => {
          const order = moveGroup(m.order, visibleKeys, key, targetKey);
          return order === m.order ? m : { ...m, order };
        }),
      [updateMode]
    ),
    toggleFavoriteGroup: useCallback(
      (key: string) =>
        update((p) => ({ ...p, favoriteGroups: toggleFavoriteGroup(p.favoriteGroups, key) })),
      [update]
    ),
    toggleFavoriteSession: useCallback(
      (id: string) =>
        update((p) => ({ ...p, favoriteSessions: toggleFavoriteSession(p.favoriteSessions, id) })),
      [update]
    ),
    fixedProjects: prefs.fixedProjects,
    toggleFixedProject: useCallback(
      (dir: string) =>
        update((p) => ({ ...p, fixedProjects: toggleFixedProject(p.fixedProjects, dir) })),
      [update]
    ),
    toggleExpandedSession: useCallback(
      (id: string) =>
        update((p) => ({
          ...p,
          expandedSessions: toggleExpandedSession(p.expandedSessions, id),
        })),
      [update]
    ),
    setSessionsExpanded: useCallback(
      (ids: string[], open: boolean) =>
        update((p) => ({ ...p, expandedSessions: setExpanded(p.expandedSessions, ids, open) })),
      [update]
    ),
    /** Forgets open details of sessions that no longer exist; call only with a complete session list */
    pruneExpandedSessions: useCallback(
      (knownIds: string[]) =>
        update((p) => {
          const expandedSessions = keepKnown(p.expandedSessions, new Set(knownIds));
          return expandedSessions === p.expandedSessions ? p : { ...p, expandedSessions };
        }),
      [update]
    ),
    /** Manual agent order of a group (#299) */
    moveSession: useCallback(
      (
        groupKey: string,
        id: string,
        targetId: string,
        visibleIds: string[],
        hiddenIds: string[] = []
      ) =>
        update((p) => {
          const stored = p.sessionOrder[groupKey] ?? [];
          const next = moveSession(stored, visibleIds, hiddenIds, id, targetId);
          return next === stored
            ? p
            : { ...p, sessionOrder: { ...p.sessionOrder, [groupKey]: next } };
        }),
      [update]
    ),
    /**
     * Favorite sessions section + manual order + favorite groups first, for the current mode;
     * `manualAgents` additionally applies the manual agent order inside each group.
     */
    arrange: useCallback(
      (groups: SessionGroup[], manualAgents = false) => {
        const arranged = withFavoriteSessions(
          applyGroupOrder(groups, mode.order, prefs.favoriteGroups),
          prefs.favoriteSessions
        );
        return manualAgents ? applySessionOrder(arranged, prefs.sessionOrder) : arranged;
      },
      [mode.order, prefs.favoriteGroups, prefs.favoriteSessions, prefs.sessionOrder]
    ),
  };
}
