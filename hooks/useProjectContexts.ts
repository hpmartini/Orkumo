import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import type { ProjectContext } from '../types';
import * as api from '../services/contextsApi';
import type { ContextList, ContextUi } from '../services/contextsApi';
import {
  STORAGE_KEY as WORKSPACE_KEY,
  LEGACY_STORAGE_KEY as WORKSPACE_LEGACY_KEY,
} from './useAgentWorkspace';
import { STORAGE_KEY as RAIL_KEY } from './useRailPreferences';

/** localStorage entries that belong to the active context: attached agent tabs, rail prefs */
const UI_KEYS = [WORKSPACE_KEY, WORKSPACE_LEGACY_KEY, RAIL_KEY];
/** Context the local UI_KEYS belong to; differs from the server's after another device switched */
const MARKER_KEY = 'devOrbitContextId';

const FALLBACK: ContextList = {
  contexts: [{ id: 'all', name: 'Alle', appIds: null, boardFilter: [] }],
  activeContextId: 'all',
};

function storage<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback; // storage unavailable
  }
}

export const readContextUi = (): ContextUi =>
  storage(() => Object.fromEntries(UI_KEYS.map((k) => [k, localStorage.getItem(k)])), {});

/** Replaces the local ui entries; a context without stored ui starts empty */
export function writeContextUi(ui: ContextUi | null, contextId: string) {
  storage(() => {
    for (const key of UI_KEYS) {
      const value = ui?.[key];
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    localStorage.setItem(MARKER_KEY, contextId);
  }, undefined);
}

const errorToast = (fallback: string) => (err: unknown) =>
  toast.error(err instanceof Error ? err.message : fallback);

/**
 * Project contexts (#97) with the active one. Switching parks the local ui entries on the
 * server and loads the target's, then calls `onSwitched` (reload apps/settings). Views that
 * read those entries must reload them on `activeContextId` (`key` or a reload effect).
 */
export function useProjectContexts(onSwitched: () => void) {
  const [list, setList] = useState<ContextList | null>(null);
  const listRef = useRef(list);
  listRef.current = list;
  const onSwitchedRef = useRef(onSwitched);
  onSwitchedRef.current = onSwitched;
  // One switch at a time: a later reply must not be overtaken by an earlier one
  const switching = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await api.fetchContexts();
        const marker = storage(() => localStorage.getItem(MARKER_KEY), null);
        if (marker && marker !== next.activeContextId) {
          const { ui } = await api.activateContext(next.activeContextId, readContextUi(), marker);
          writeContextUi(ui, next.activeContextId);
        } else {
          // First start after #97: the local entries become the default context's
          storage(() => localStorage.setItem(MARKER_KEY, next.activeContextId), undefined);
        }
        if (!cancelled) setList(next);
      } catch {
        if (!cancelled) setList(FALLBACK);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Loads `id`'s ui; `from` is the context the local entries belong to */
  const load = useCallback(async (id: string, from: string) => {
    if (switching.current) return;
    switching.current = true;
    try {
      const { activeContextId, ui } = await api.activateContext(id, readContextUi(), from);
      writeContextUi(ui, activeContextId);
      setList((l) => l && { ...l, activeContextId });
      onSwitchedRef.current();
    } finally {
      switching.current = false;
    }
  }, []);

  const switchTo = useCallback(
    (id: string) => {
      const from = listRef.current?.activeContextId;
      if (!from || from === id) return;
      load(id, from).catch(errorToast('Kontext nicht gewechselt'));
    },
    [load]
  );

  const create = useCallback(
    async (input: Omit<ProjectContext, 'id'>) => {
      try {
        const context = await api.createContext(input);
        setList((l) => l && { ...l, contexts: [...l.contexts, context] });
        const from = listRef.current?.activeContextId;
        if (from) await load(context.id, from);
      } catch (err) {
        errorToast('Kontext nicht angelegt')(err);
      }
    },
    [load]
  );

  const update = useCallback(async (id: string, patch: Partial<Omit<ProjectContext, 'id'>>) => {
    try {
      const context = await api.updateContext(id, patch);
      setList((l) => l && { ...l, contexts: l.contexts.map((c) => (c.id === id ? context : c)) });
    } catch (err) {
      errorToast('Kontext nicht gespeichert')(err);
    }
  }, []);

  const remove = useCallback(
    async (id: string) => {
      try {
        const next = await api.deleteContext(id);
        setList((l) => l && { ...l, contexts: next.contexts });
        // The server activated a neighbour; the local entries were the deleted context's
        if (listRef.current?.activeContextId === id) await load(next.activeContextId, id);
      } catch (err) {
        errorToast('Kontext nicht gelöscht')(err);
      }
    },
    [load]
  );

  const reorder = useCallback(async (ids: string[]) => {
    const previous = listRef.current;
    if (!previous) return;
    const byId = new Map(previous.contexts.map((c) => [c.id, c]));
    setList({ ...previous, contexts: ids.flatMap((id) => byId.get(id) ?? []) });
    try {
      await api.reorderContexts(ids);
    } catch (err) {
      setList(previous);
      errorToast('Reihenfolge nicht gespeichert')(err);
    }
  }, []);

  const active = list?.contexts.find((c) => c.id === list.activeContextId) ?? null;
  return {
    contexts: list?.contexts ?? [],
    active,
    ready: list !== null,
    switchTo,
    create,
    update,
    remove,
    reorder,
  };
}
