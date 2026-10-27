/**
 * Project contexts (#97): named tabs in the title bar, each with its own favorites, board
 * slices and agent tabs. Pure functions over the settings object; settingsService persists.
 *
 * Swap model: the active context's values stay where they always lived (settings.favorites,
 * settings.favoritesSortMode, settings.board.{favorites,order,hidden}), so every existing
 * route keeps working. Inactive contexts park theirs in settings.contextState[id].
 * Agent tabs and rail prefs live in the client's localStorage while a context is active and
 * are parked here as `ui` on a switch.
 */

export const DEFAULT_CONTEXT_ID = 'all';

export const DEFAULT_CONTEXTS = [
  { id: DEFAULT_CONTEXT_ID, name: 'Alle', appIds: null, boardFilter: [] },
];

const BOARD_KEYS = ['favorites', 'order', 'hidden'];

function contextError(message, status) {
  return Object.assign(new Error(message), { status });
}

function findContext(settings, id) {
  const context = settings.contexts.find((c) => c.id === id);
  if (!context) throw contextError(`Unknown context: ${id}`, 404);
  return context;
}

/** Contexts plus the active id; falls back to the defaults for settings written before #97 */
export function listContexts(settings) {
  const contexts = settings.contexts?.length ? settings.contexts : DEFAULT_CONTEXTS;
  const activeContextId = contexts.some((c) => c.id === settings.activeContextId)
    ? settings.activeContextId
    : contexts[0].id;
  return { contexts, activeContextId };
}

/** Settings with contexts/activeContextId/contextState present (migration of old files) */
export function withContexts(settings) {
  return {
    ...settings,
    ...listContexts(settings),
    contextState: settings.contextState || {},
  };
}

export function createContext(settings, { name, appIds = [], boardFilter = [] }, id) {
  const next = withContexts(settings);
  const context = { id, name, appIds, boardFilter };
  return { settings: { ...next, contexts: [...next.contexts, context] }, context };
}

export function updateContext(settings, id, patch) {
  const next = withContexts(settings);
  const context = { ...findContext(next, id), ...patch, id };
  return {
    settings: { ...next, contexts: next.contexts.map((c) => (c.id === id ? context : c)) },
    context,
  };
}

/** New order of all context ids; unknown or missing ids are rejected */
export function reorderContexts(settings, ids) {
  const next = withContexts(settings);
  const known = new Set(next.contexts.map((c) => c.id));
  if (
    ids.length !== known.size ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => known.has(id))
  )
    throw contextError('Context order must list every context once', 400);
  return { ...next, contexts: ids.map((id) => findContext(next, id)) };
}

/** Deletes a context; the last one stays. Deleting the active one activates its neighbour. */
export function deleteContext(settings, id) {
  let next = withContexts(settings);
  findContext(next, id);
  if (next.contexts.length === 1) throw contextError('The last context cannot be deleted', 400);
  if (next.activeContextId === id) {
    const index = next.contexts.findIndex((c) => c.id === id);
    const neighbour = next.contexts[index + 1] ?? next.contexts[index - 1];
    next = activateContext(next, neighbour.id).settings;
  }
  const contextState = { ...next.contextState };
  delete contextState[id];
  return { ...next, contexts: next.contexts.filter((c) => c.id !== id), contextState };
}

/**
 * Parks the active context's values (plus the client's `ui`) and loads the target's.
 * A context never activated before starts empty. Returns the target's last parked `ui`.
 *
 * `from` is the context the client's `ui` belongs to. It differs from the active one when
 * another device switched meanwhile; then that `ui` is parked with `from` instead.
 * shortcut: two devices on the same context share one snapshot, the last switch wins.
 */
export function activateContext(settings, id, ui = null, from) {
  let next = withContexts(settings);
  findContext(next, id);
  if (from && from !== next.activeContextId) {
    next = parkUi(next, from, ui);
    ui = null;
  }
  const current = next.activeContextId;
  if (current === id) return { settings: next, ui: next.contextState[id]?.ui ?? null };

  const board = next.board || {};
  const parked = {
    favorites: next.favorites || [],
    favoritesSortMode: next.favoritesSortMode || 'manual',
    board: Object.fromEntries(BOARD_KEYS.map((k) => [k, board[k] || []])),
    ui: ui ?? next.contextState[current]?.ui ?? null,
  };
  const target = next.contextState[id] || {};
  const archived = new Set(next.archived || []);
  return {
    settings: {
      ...next,
      activeContextId: id,
      // Archiving only drops favorites of the active context; catch up on the parked ones
      favorites: (target.favorites || []).filter((appId) => !archived.has(appId)),
      favoritesSortMode: target.favoritesSortMode || 'manual',
      board: {
        ...board,
        ...Object.fromEntries(BOARD_KEYS.map((k) => [k, target.board?.[k] || []])),
      },
      // The active context keeps only its last ui snapshot, for devices that switch to it later
      contextState: { ...next.contextState, [current]: parked, [id]: { ui: target.ui ?? null } },
    },
    ui: target.ui ?? null,
  };
}

/** Stores a client's `ui` for a context, keeping its parked values */
function parkUi(settings, id, ui) {
  if (!settings.contexts.some((c) => c.id === id)) return settings; // deleted meanwhile
  return {
    ...settings,
    contextState: { ...settings.contextState, [id]: { ...settings.contextState[id], ui } },
  };
}
