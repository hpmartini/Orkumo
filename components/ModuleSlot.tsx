import React, { useEffect, useRef } from 'react';
import { API_BASE_URL } from '../utils/apiConfig';
import { useModules } from '../hooks/useModules';

/**
 * Hands each module's UI its own empty div: the module's ui.js exports
 * mount(el) -> cleanup?. Not a React component, since a bundled module brings
 * its own React copy (docs/MODULES.md).
 */
function ModuleMount({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let cleanup: void | (() => void);
    import(/* @vite-ignore */ `${API_BASE_URL}/modules/${id}/ui.js`)
      .then((mod) => {
        if (cancelled || !ref.current) return;
        cleanup = mod.mount(ref.current);
      })
      .catch((error) => console.error(`[Modules] UI of "${id}" failed to load:`, error));
    return () => {
      cancelled = true;
      if (typeof cleanup === 'function') cleanup();
    };
  }, [id]);

  return <div ref={ref} data-module={id} />;
}

/** Renders nothing unless a loaded module ships UI. */
export const ModuleSlot: React.FC = () => {
  const withUi = useModules().filter((m) => m.ui);
  if (withUi.length === 0) return null;
  return (
    <>
      {withUi.map((m) => (
        <ModuleMount key={m.id} id={m.id} />
      ))}
    </>
  );
};
