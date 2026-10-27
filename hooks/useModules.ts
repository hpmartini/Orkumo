import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../utils/apiConfig';

export interface LoadedModule {
  id: string;
  name: string;
  ui: boolean;
}

/** Modules the server has loaded (docs/MODULES.md). Empty on any error, so a missing module leaves no trace. */
export function useModules(): LoadedModule[] {
  const [modules, setModules] = useState<LoadedModule[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/modules`)
      .then((res) => (res.ok ? res.json() : []))
      .then((list) => !cancelled && Array.isArray(list) && setModules(list))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return modules;
}
