import React from 'react';
import type { LoadedModule } from '../hooks/useModules';
import { ModuleMount, useModuleHost } from './ModuleMount';

/** Renders nothing unless a loaded module ships UI without a mode or slot (those render in place). */
export const ModuleSlot: React.FC<{ modules: LoadedModule[] }> = ({ modules }) => {
  const host = useModuleHost(true);
  const withUi = modules.filter((m) => m.ui && !m.mode && !m.slot);
  if (withUi.length === 0) return null;
  return (
    <>
      {withUi.map((m) => (
        <ModuleMount key={m.id} id={m.id} host={host} />
      ))}
    </>
  );
};

/** Module UIs at the "Agents" label of the agents header (slot `agents-rail`, docs/MODULES.md) */
export const AgentsRailSlot: React.FC<{ ids?: string[] }> = ({ ids }) => {
  const host = useModuleHost(true);
  if (!ids?.length) return null;
  return (
    <>
      {ids.map((id) => (
        <ModuleMount key={id} id={id} host={host} className="flex items-center" />
      ))}
    </>
  );
};
