import React from 'react';
import type { LoadedModule } from '../hooks/useModules';
import { ModuleMount, useModuleHost } from './ModuleMount';

/** Renders nothing unless a loaded module ships UI without a mode (modes get their own pane). */
export const ModuleSlot: React.FC<{ modules: LoadedModule[] }> = ({ modules }) => {
  const host = useModuleHost(true);
  const withUi = modules.filter((m) => m.ui && !m.mode);
  if (withUi.length === 0) return null;
  return (
    <>
      {withUi.map((m) => (
        <ModuleMount key={m.id} id={m.id} host={host} />
      ))}
    </>
  );
};
