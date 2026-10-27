import { useEffect, useMemo, useState } from 'react';
import {
  EMPTY_WORKSPACE,
  activateTab,
  closeSession,
  closeTab,
  detachSession,
  focusSession,
  migrateWorkspace,
  moveTab,
  openSession,
  pruneMissing,
  setTabLayout,
  splitInto,
  type Workspace,
} from '../utils/agentWorkspace';

export const STORAGE_KEY = 'devOrbitAgentWorkspace.v2';
/** Pre-tabs/panes shape `{openIds, activeId}`; read once as a migration source */
export const LEGACY_STORAGE_KEY = 'devOrbitAgentWorkspace';

function load(): Workspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw ? migrateWorkspace(JSON.parse(raw)) : EMPTY_WORKSPACE;
  } catch {
    return EMPTY_WORKSPACE;
  }
}

/**
 * Attached agent sessions as tabs of panes, persisted in localStorage.
 * All actions are stable callbacks over the pure reducers in utils/agentWorkspace.
 */
export function useAgentWorkspace(contextId?: string) {
  const [workspace, setWorkspace] = useState<Workspace>(load);
  // A project context switch swaps the stored workspace (useProjectContexts): pick it up
  useEffect(() => setWorkspace(load()), [contextId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    } catch {
      // storage unavailable: the workspace just does not survive a reload
    }
  }, [workspace]);

  const actions = useMemo(() => {
    const apply = (fn: (ws: Workspace) => Workspace) => setWorkspace(fn);
    return {
      attach: (id: string) => apply((ws) => openSession(ws, id)),
      focusPane: (id: string) => apply((ws) => focusSession(ws, id)),
      activateTab: (tabId: string) => apply((ws) => activateTab(ws, tabId)),
      closePane: (id: string) => apply((ws) => closeSession(ws, id)),
      closeTab: (tabId: string) => apply((ws) => closeTab(ws, tabId)),
      split: (id: string, targetId: string, zone: Parameters<typeof splitInto>[3]) =>
        apply((ws) => splitInto(ws, id, targetId, zone)),
      detach: (id: string) => apply((ws) => detachSession(ws, id)),
      moveTab: (tabId: string, targetId: string, position: 'before' | 'after') =>
        apply((ws) => moveTab(ws, tabId, targetId, position)),
      setLayout: (tabId: string, layout: Parameters<typeof setTabLayout>[2]) =>
        apply((ws) => setTabLayout(ws, tabId, layout)),
      /** Only call once the session list has loaded, so a reload keeps tabs while loading */
      prune: (existing: ReadonlySet<string>) => apply((ws) => pruneMissing(ws, existing)),
    };
  }, []);

  const openIds = useMemo(() => new Set(workspace.tabs.flatMap((t) => t.panes)), [workspace.tabs]);

  return { workspace, openIds, ...actions };
}
