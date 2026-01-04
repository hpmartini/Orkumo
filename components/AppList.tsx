import React from 'react';
import { FolderSearch, Box } from 'lucide-react';
import { AppConfig, AppStatus } from '../types';
import { StatusBadge } from './StatusBadge';
import { KebabMenu, createAppMenuItems } from './KebabMenu';

interface AppListProps {
  apps: AppConfig[];
  selectedAppId: string | null;
  onSelectApp: (id: string) => void;
  onRefresh?: () => void;
  onStart?: (id: string) => void;
  onStop?: (id: string) => void;
  onRestart?: (id: string) => void;
  onOpenInBrowser?: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
  onToggleArchive?: (id: string) => void;
  onOpenInFinder?: (id: string) => void;
  onOpenInTerminal?: (id: string) => void;
}

export const AppList: React.FC<AppListProps> = ({
  apps,
  selectedAppId,
  onSelectApp,
  onRefresh,
  onStart,
  onStop,
  onRestart,
  onOpenInBrowser,
  onToggleFavorite,
  onToggleArchive,
  onOpenInFinder,
  onOpenInTerminal,
}) => {
  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
      <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-850">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Box size={18} className="text-gray-400" /> Applications
        </h2>
        <button
          onClick={onRefresh}
          className="p-2 hover:bg-gray-700 rounded-lg transition-colors text-gray-400"
          title="Rescan directories"
        >
          <FolderSearch size={18} />
        </button>
      </div>
      <div className="divide-y divide-gray-700/50">
        {apps.map((app) => (
          <div
            key={app.id}
            onClick={() => onSelectApp(app.id)}
            className={`p-4 flex items-center justify-between hover:bg-gray-700/30 transition-colors cursor-pointer group ${
              selectedAppId === app.id ? 'bg-gray-700/40' : ''
            }`}
          >
            <div className="flex items-center gap-4">
              <div
                className={`w-2 h-10 rounded-full ${
                  app.status === AppStatus.RUNNING
                    ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                    : app.status === AppStatus.STARTING || app.status === AppStatus.RESTARTING
                    ? 'bg-yellow-500 animate-pulse'
                    : app.status === AppStatus.ERROR
                    ? 'bg-red-500'
                    : 'bg-gray-600'
                }`}
              ></div>
              <div>
                <h3 className="text-white font-medium flex items-center gap-2">
                  {app.name}
                  {app.status === AppStatus.RUNNING && app.port && (
                    <span className="text-xs text-gray-500 font-mono">:{app.port}</span>
                  )}
                </h3>
                <div className="text-xs text-gray-500 flex items-center gap-2 mt-1">
                  <span className="px-1.5 py-0.5 rounded bg-gray-700/50">{app.detectedFramework}</span>
                  <span className="truncate max-w-[200px]" title={app.path}>{app.path}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={app.status} />
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <KebabMenu
                  items={createAppMenuItems({
                    appId: app.id,
                    status: app.status,
                    isFavorite: app.isFavorite,
                    isArchived: app.isArchived,
                    hasPort: !!app.port,
                    onStart,
                    onStop,
                    onRestart,
                    onOpenInBrowser,
                    onToggleFavorite,
                    onToggleArchive,
                    onOpenInFinder,
                    onOpenInTerminal,
                  })}
                  position="left"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
