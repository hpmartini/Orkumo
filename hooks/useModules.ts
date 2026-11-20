import { useEffect, useState, useSyncExternalStore } from 'react';
import toast from 'react-hot-toast';
import { API_BASE_URL } from '../utils/apiConfig';
import type { PaletteCommand } from '../utils/commandPalette';

/** Work mode a module brings (docs/MODULES.md, "Modes") */
export interface ModuleModeInfo {
  label: string;
  icon?: string;
  keywords?: string;
  scoped?: boolean;
  /** Orchestrator panes get `Show in <label>`, opening `/<id>?orchestrator=<role or agent id>` */
  orchestratorFilter?: boolean;
}

/** A mode as the shell passes it down: the module id is its route segment */
export type ModeEntry = ModuleModeInfo & { id: string };

export interface LoadedModule {
  id: string;
  name: string;
  ui: boolean;
  mode?: ModuleModeInfo;
  /** Host place the UI renders into instead of the shell slot (docs/MODULES.md, "Slots") */
  slot?: 'agents-rail';
}

/** Result of one module directory after a load (GET /api/modules/_status, POST /_reload) */
export interface ModuleStatus {
  entry: string;
  id?: string;
  name?: string;
  version: string | null;
  status: 'loaded' | 'error';
  error?: string;
}

// Bumped after every module reload: lists refetch, module UIs import their ui.js anew
let generation = 0;
// Ids loaded by the last reload; null before the first one
let reloadedIds: Set<string> | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const useModulesGeneration = () => useSyncExternalStore(subscribe, () => generation);

async function moduleAdmin(path: string, init?: RequestInit): Promise<ModuleStatus[]> {
  const res = await fetch(`${API_BASE_URL}/modules/${path}`, init);
  if (res.status === 403) throw new Error('Only possible on this machine');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const fetchModuleStatus = () => moduleAdmin('_status');

/** False for a module the last reload dropped: its UI is about to unmount, its ui.js is gone */
export const isModuleLoaded = (id: string) => reloadedIds?.has(id) ?? true;

/** Server unloads and loads every module again; then the shell refreshes lists and module UIs */
export async function reloadModules(): Promise<ModuleStatus[]> {
  const results = await moduleAdmin('_reload', { method: 'POST' });
  reloadedIds = new Set(results.flatMap((r) => (r.status === 'loaded' && r.id ? [r.id] : [])));
  generation += 1;
  listeners.forEach((listener) => listener());
  return results;
}

/** reloadModules with a toast summary, for the palette */
export function reloadModulesWithToast(): void {
  reloadModules()
    .then((results) => {
      const failed = results.filter((r) => r.status === 'error');
      const summary = `${results.length - failed.length} loaded`;
      if (failed.length)
        toast.error(
          `Modules reloaded: ${summary}, failed: ${failed.map((r) => r.entry).join(', ')}`
        );
      else toast.success(`Modules reloaded: ${summary}`);
    })
    .catch((error: Error) => toast.error(`Reloading modules failed: ${error.message}`));
}

/**
 * Modules the server has loaded (docs/MODULES.md). Empty on any error, so a missing module leaves no trace.
 * `ready` once the first request settled: the shell waits for it before it treats a path as unknown.
 * A reload refetches without dropping `ready`, so the shell stays mounted.
 */
export function useModulesState(): { modules: LoadedModule[]; ready: boolean } {
  const [state, setState] = useState<{ modules: LoadedModule[]; ready: boolean }>({
    modules: [],
    ready: false,
  });
  const gen = useModulesGeneration();

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/modules`)
      .then((res) => (res.ok ? res.json() : []))
      .catch(() => [])
      .then((list) => {
        if (!cancelled) setState({ modules: Array.isArray(list) ? list : [], ready: true });
      });
    return () => {
      cancelled = true;
    };
  }, [gen]);

  return state;
}

export function useModules(): LoadedModule[] {
  return useModulesState().modules;
}

/** Command palette entries of the modes: `Open <label>` in the Navigate group */
export const modeCommands = (
  modes: ModeEntry[],
  navigate: (to: string) => void
): PaletteCommand[] =>
  modes.map((m) => ({
    id: `app.mode.${m.id}`,
    title: `Open ${m.label}`,
    group: 'Navigate',
    scope: 'command',
    keywords: m.keywords,
    run: () => navigate(`/${m.id}`),
  }));
