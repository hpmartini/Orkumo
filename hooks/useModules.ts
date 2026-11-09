import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../utils/apiConfig';
import type { PaletteCommand } from '../utils/commandPalette';

/** Work mode a module brings (docs/MODULES.md, "Modes") */
export interface ModuleModeInfo {
  label: string;
  icon?: string;
  keywords?: string;
  scoped?: boolean;
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

/**
 * Modules the server has loaded (docs/MODULES.md). Empty on any error, so a missing module leaves no trace.
 * `ready` once the request settled: the shell waits for it before it treats a path as unknown.
 */
export function useModulesState(): { modules: LoadedModule[]; ready: boolean } {
  const [state, setState] = useState<{ modules: LoadedModule[]; ready: boolean }>({
    modules: [],
    ready: false,
  });

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
  }, []);

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
