import React, { useEffect, useState } from 'react';
import { Wrench, Terminal, Package, GitBranch, Container, Info } from 'lucide-react';
import { fetchToolVersions, type ToolVersions as ToolVersionsData } from '../services/api';
import type { AppConfig } from '../types';

const TOOLS = [
  { key: 'node', label: 'Node', icon: Terminal, tone: 'text-green-400' },
  { key: 'npm', label: 'npm', icon: Package, tone: 'text-red-400' },
  { key: 'git', label: 'Git', icon: GitBranch, tone: 'text-orange-400' },
  { key: 'docker', label: 'Docker', icon: Container, tone: 'text-blue-400' },
] as const;

/**
 * Dashboard card (#184): global tool versions; with `apps` (context dashboard) also the
 * Node version each project pins, since nvm/fnm switch Node per project.
 */
export const ToolVersions: React.FC<{ apps?: AppConfig[] }> = ({ apps }) => {
  const [data, setData] = useState<ToolVersionsData | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetchToolVersions()
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const system = data?.system;
  return (
    <section className="bg-gray-800 rounded-xl border border-gray-700" aria-label="Tool versions">
      <div className="flex items-center gap-3 p-4 border-b border-gray-700">
        <Wrench className="text-blue-400" size={20} />
        <h3 className="font-semibold text-white">Tool versions</h3>
      </div>
      <div className="p-4 space-y-3">
        {error && <p className="text-sm text-red-400">Tool versions unavailable</p>}
        {!system && !error && <p className="text-sm text-gray-500">Loading…</p>}
        {system && (
          <div className="grid grid-cols-2 gap-2">
            {TOOLS.map(({ key, label, icon: Icon, tone }) => {
              const info = system[key];
              const stopped = key === 'docker' && info.installed && !system.docker.running;
              return (
                <div key={key} className="flex items-center gap-2 text-sm">
                  <Icon size={14} className={tone} />
                  <span className="text-gray-400">{label}:</span>
                  <span className={`font-mono ${stopped ? 'text-yellow-400' : 'text-white'}`}>
                    {info.installed
                      ? `v${info.version}${stopped ? ' (stopped)' : ''}`
                      : 'not installed'}
                  </span>
                </div>
              );
            })}
            {system.versionManager.manager !== 'system' && (
              <div className="col-span-2 flex items-center gap-2 text-xs text-gray-500">
                <Info size={12} /> Node via {system.versionManager.manager}
              </div>
            )}
          </div>
        )}
        {system && apps && (
          <div className="border-t border-gray-700 pt-3">
            <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-2">Node per project</h4>
            {apps.length === 0 ? (
              <p className="text-sm text-gray-500">No projects in this context</p>
            ) : (
              <ul className="space-y-1">
                {apps.map((app) => {
                  const pin = data.projects[app.id];
                  return (
                    <li key={app.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-gray-300" title={app.path}>
                        {app.name}
                      </span>
                      <span
                        className={`font-mono shrink-0 ${pin ? 'text-white' : 'text-gray-500'}`}
                        title={pin ? `from ${pin.source}` : 'not pinned: global Node'}
                      >
                        {pin ? pin.version : `global v${system.node.version ?? '?'}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
