import { useEffect, useState } from 'react';
import { getWorkflowProvider } from '../services/boardApi';
import type { WorkflowProviderInfo } from '../types';

// Once per app load: the provider only changes with a server restart
let cached: Promise<WorkflowProviderInfo | null> | null = null;

/** Test hook: forget the cached provider */
export const resetWorkflowProvider = () => {
  cached = null;
};

/** The workflow provider (docs/WORKFLOW_PROVIDER.md); null while loading, without provider or on error */
export function useWorkflowProvider(): WorkflowProviderInfo | null {
  const [provider, setProvider] = useState<WorkflowProviderInfo | null>(null);
  useEffect(() => {
    let alive = true;
    cached ??= getWorkflowProvider().catch(() => null);
    void cached.then((p) => alive && setProvider(p));
    return () => {
      alive = false;
    };
  }, []);
  return provider;
}
