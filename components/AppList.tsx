import React, { useMemo, useState } from 'react';
import { FolderOpen, FolderRoot, Box, RefreshCw, ChevronDown, ChevronRight, Star } from 'lucide-react';
import { AppConfig, AppStatus } from '../types';
import { StatusBadge } from './StatusBadge';
import { KebabMenu, createAppMenuItems } from './KebabMenu';

interface AppListProps {
  apps: AppConfig[];
  selectedAppId: string | null;
  onSelectApp: (id: string) => void;
  onRefresh?: () => Promise<void>;
  onStart?: (id: string) => void;
  onStop?: (id: string) => void;
  onRestart?: (id: string) => void;
  onOpenInBrowser?: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
  onToggleArchive?: (id: string) => void;
  onOpenInFinder?: (id: string) => void;
  onOpenInTerminal?: (id: string) => void;
  onRename?: (id: string) => void;
  mainDirectory?: string;
}

interface GroupedApps {
  [folder: string]: AppConfig[];
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
  onRename,
  mainDirectory = 'projects',
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  // Group apps by parent folder and sort alphabetically with main folder first
  const groupedApps = useMemo(() => {
    const groups: GroupedApps = {};

    apps.forEach((app) => {
      // Extract parent folder from path
      const pathParts = app.path.split('/');
      const folderName = pathParts[pathParts.length - 2] || 'Root';

      if (!groups[folderName]) {
        groups[folderName] = [];
      }
      groups[folderName].push(app);
    });

    // Sort apps within each folder alphabetically
    Object.keys(groups).forEach((folder) => {
      groups[folder].sort((a, b) => a.name.localeCompare(b.name));
    });

    // Sort folder names: main directory first, then alphabetically
    const sortedFolders = Object.keys(groups).sort((a, b) => {
      if (a.toLowerCase() === mainDirectory.toLowerCase()) return -1;
      if (b.toLowerCase() === mainDirectory.toLowerCase()) return 1;
      return a.localeCompare(b);
    });

    return { groups, sortedFolders };
  }, [apps, mainDirectory]);

  const handleRefresh = async () => {
    if (!onRefresh || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const toggleFolder = (folder: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) {
        next.delete(folder);
      } else {
        next.add(folder);
      }
      return next;
    });
  };

  const isLoading = (status: AppStatus) =>
    status === AppStatus.STARTING ||
    status === AppStatus.ANALYZING ||
    status === AppStatus.RESTARTING;

  const canStart = (status: AppStatus) =>
    status === AppStatus.STOPPED || status === AppStatus.ERROR || status === AppStatus.CANCELLED;

  const handleStatusClick = (app: AppConfig) => {
    if (app.status === AppStatus.RUNNING && onStop) {
      onStop(app.id);
    } else if (canStart(app.status) && onStart) {
      onStart(app.id);
    }
  };

  const renderAppItem = (app: AppConfig) => (
    <div
      key={app.id}
      onClick={() => onSelectApp(app.id)}
      className={`p-4 flex items-center justify-between hover:bg-gray-700/30 transition-colors cursor-pointer group ${
        selectedAppId === app.id ? 'bg-gray-700/40 border-l-2 border-blue-500' : ''
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
        <StatusBadge
          status={app.status}
          onClick={(onStart || onStop) ? () => handleStatusClick(app) : undefined}
          isLoading={isLoading(app.status)}
        />
        {/* Favorite Button */}
        {onToggleFavorite && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(app.id);
            }}
            className={`p-1.5 rounded transition-colors opacity-0 group-hover:opacity-100 ${
              app.isFavorite
                ? 'text-yellow-400 hover:bg-yellow-500/20 !opacity-100'
                : 'text-gray-500 hover:bg-gray-700 hover:text-yellow-400'
            }`}
            title={app.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star size={14} fill={app.isFavorite ? 'currentColor' : 'none'} />
          </button>
        )}
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
              onRename,
            })}
            position="left"
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
      <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-850">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Box size={18} className="text-gray-400" /> Applications
          <span className="text-sm font-normal text-gray-500">({apps.length})</span>
        </h2>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="p-2 hover:bg-gray-700 rounded-lg transition-colors text-gray-400 hover:text-white disabled:opacity-50"
          title="Refresh all projects"
        >
          <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Grouped apps with folder dividers */}
      <div>
        {groupedApps.sortedFolders.map((folder) => {
          const folderApps = groupedApps.groups[folder];
          const isCollapsed = collapsedFolders.has(folder);
          const runningCount = folderApps.filter(a => a.status === AppStatus.RUNNING).length;
          const isMainDir = folder.toLowerCase() === mainDirectory.toLowerCase();

          return (
            <div key={folder}>
              {/* Folder divider header */}
              <button
                onClick={() => toggleFolder(folder)}
                className={`w-full px-4 py-3 flex items-center justify-between border-y transition-colors ${
                  isMainDir
                    ? 'bg-blue-900/20 border-blue-800/50 hover:bg-blue-900/30'
                    : 'bg-gray-750 border-gray-700/50 hover:bg-gray-700/50'
                }`}
              >
                <div className={`flex items-center gap-2 ${isMainDir ? 'text-blue-300' : 'text-gray-300'}`}>
                  {isCollapsed ? (
                    <ChevronRight size={16} className={isMainDir ? 'text-blue-400' : 'text-gray-500'} />
                  ) : (
                    <ChevronDown size={16} className={isMainDir ? 'text-blue-400' : 'text-gray-500'} />
                  )}
                  {isMainDir ? (
                    <FolderRoot size={16} className="text-blue-400" />
                  ) : (
                    <FolderOpen size={16} className="text-blue-400" />
                  )}
                  <span className="font-medium">{folder}</span>
                  <span className={`text-xs ${isMainDir ? 'text-blue-400' : 'text-gray-500'}`}>({folderApps.length})</span>
                </div>
                {runningCount > 0 && (
                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                    {runningCount} running
                  </span>
                )}
              </button>

              {/* Apps in this folder */}
              {!isCollapsed && (
                <div className="divide-y divide-gray-700/50">
                  {folderApps.map(renderAppItem)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {apps.length === 0 && (
        <div className="p-8 text-center text-gray-500">
          <Box size={48} className="mx-auto mb-4 opacity-50" />
          <p>No applications found</p>
          <p className="text-sm mt-2">Configure directories in settings to scan for projects</p>
        </div>
      )}
    </div>
  );
};
