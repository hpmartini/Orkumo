import { useEffect, useState } from 'react';
import { getWorkflowProvider } from '../services/boardApi';
import type { WorkflowProviderInfo } from '../types';
import { useModulesGeneration } from './useModules';

// Once per module generation: the provider only changes with a restart or a module reload
let cached: Promise<WorkflowProviderInfo | null> | null = null;
let cachedGen = 0;

/** Test hook: forget the cached provider */
export const resetWorkflowProvider = () => {
  cached = null;
};

/** The workflow provider (docs/WORKFLOW_PROVIDER.md); null while loading, without provider or on error */
export function useWorkflowProvider(): WorkflowProviderInfo | null {
  const [provider, setProvider] = useState<WorkflowProviderInfo | null>(null);
  const gen = useModulesGeneration();
  useEffect(() => {
    let alive = true;
    if (cachedGen !== gen) {
      cached = null;
      cachedGen = gen;
    }
    cached ??= getWorkflowProvider().catch(() => null);
    void cached.then((p) => alive && setProvider(p));
    return () => {
      alive = false;
    };
  }, [gen]);
  return provider;
}
