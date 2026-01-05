import React, { useMemo, useState } from 'react';
import {
  LayoutDashboard,
  Settings,
  ChevronDown,
  ChevronRight,
  Star,
  Archive,
  Folder,
  Play,
  Square,
  RefreshCw,
  Globe,
} from 'lucide-react';
import { AppConfig, AppStatus } from '../types';

interface SidebarProps {
  apps: AppConfig[];
  selectedAppId: string | null;
  activeTab: 'dashboard' | 'apps';
  onSelectDashboard: () => void;
  onSelectApp: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
  onToggleArchive?: (id: string) => void;
  onStart?: (id: string) => void;
  onStop?: (id: string) => void;
  onRestart?: (id: string) => void;
  onOpenInBrowser?: (id: string) => void;
  onRefresh?: () => Promise<void>;
  onRefreshDirectory?: (directory: string) => Promise<void>;
}

interface GroupedApps {
  [directory: string]: AppConfig[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  apps,
  selectedAppId,
  activeTab,
  onSelectDashboard,
  onSelectApp,
  onToggleFavorite,
  onToggleArchive,
  onStart,
  onStop,
  onRestart,
  onOpenInBrowser,
  onRefresh,
  onRefreshDirectory,
}) => {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [showArchive, setShowArchive] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshingDir, setRefreshingDir] = useState<string | null>(null);

  const handleRefreshAll = async () => {
    if (!onRefresh || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRefreshDir = async (dir: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onRefreshDirectory || refreshingDir) return;
    setRefreshingDir(dir);
    try {
      await onRefreshDirectory(dir);
    } finally {
      setRefreshingDir(null);
    }
  };

  // Group apps by parent directory, separate favorites and archived, sort alphabetically
  const { favorites, grouped, sortedDirs, archived } = useMemo(() => {
    const favs: AppConfig[] = [];
    const arch: AppConfig[] = [];
    const groups: GroupedApps = {};

    apps.forEach((app) => {
      if (app.isArchived) {
        arch.push(app);
        return;
      }
      if (app.isFavorite) {
        favs.push(app);
      }
      // Group by parent directory
      const pathParts = app.path.split('/');
      const displayDir = pathParts.slice(-2, -1)[0] || 'Root';

      if (!groups[displayDir]) {
        groups[displayDir] = [];
      }
      groups[displayDir].push(app);
    });

    // Sort apps within each folder alphabetically
    Object.keys(groups).forEach((dir) => {
      groups[dir].sort((a, b) => a.name.localeCompare(b.name));
    });

    // Sort favorites alphabetically
    favs.sort((a, b) => a.name.localeCompare(b.name));

    // Sort archived alphabetically
    arch.sort((a, b) => a.name.localeCompare(b.name));

    // Sort folder names alphabetically
    const sortedDirNames = Object.keys(groups).sort((a, b) => a.localeCompare(b));

    return { favorites: favs, grouped: groups, sortedDirs: sortedDirNames, archived: arch };
  }, [apps]);

  const toggleDir = (dir: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) {
        next.delete(dir);
      } else {
        next.add(dir);
      }
      return next;
    });
  };

  const isLoading = (status: AppStatus) =>
    status === AppStatus.STARTING ||
    status === AppStatus.ANALYZING ||
    status === AppStatus.RESTARTING;

  const canStart = (status: AppStatus) =>
    status === AppStatus.STOPPED ||
    status === AppStatus.ERROR ||
    status === AppStatus.CANCELLED;

  const renderAppItem = (app: AppConfig, showFavoriteIcon = true) => (
    <div
      key={app.id}
      role="button"
      tabIndex={0}
      onClick={() => onSelectApp(app.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelectApp(app.id);
      }}
      className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between group transition-all cursor-pointer ${
        selectedAppId === app.id
          ? 'bg-gray-800 text-white'
          : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div
          className={`w-2 h-2 rounded-full shrink-0 ${
            app.status === AppStatus.RUNNING
              ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
              : app.status === AppStatus.ERROR
              ? 'bg-red-500'
              : app.status === AppStatus.STARTING || app.status === AppStatus.RESTARTING
              ? 'bg-yellow-500 animate-pulse'
              : 'bg-gray-600'
          }`}
        />
        <span className="truncate text-sm">{app.name}</span>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* Quick Actions */}
        {app.status === AppStatus.RUNNING ? (
          <>
            {onStop && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStop(app.id);
                }}
                className="p-1 rounded hover:bg-red-500/20 text-red-400"
                title="Stop"
              >
                <Square size={12} fill="currentColor" />
              </button>
            )}
            {onRestart && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRestart(app.id);
                }}
                className="p-1 rounded hover:bg-gray-700 text-gray-500"
                title="Restart"
              >
                <RefreshCw size={12} />
              </button>
            )}
            {onOpenInBrowser && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenInBrowser(app.id);
                }}
                className="p-1 rounded hover:bg-gray-700 text-blue-400"
                title="Open in browser"
              >
                <Globe size={12} />
              </button>
            )}
          </>
        ) : (
          onStart && canStart(app.status) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStart(app.id);
              }}
              disabled={isLoading(app.status)}
              className="p-1 rounded hover:bg-emerald-500/20 text-emerald-400 disabled:opacity-50"
              title="Start"
            >
              {isLoading(app.status) ? (
                <RefreshCw size={12} className="animate-spin" />
              ) : (
                <Play size={12} fill="currentColor" />
              )}
            </button>
          )
        )}
        {/* Favorite & Archive */}
        {showFavoriteIcon && onToggleFavorite && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(app.id);
            }}
            className={`p-1 rounded hover:bg-gray-700 ${
              app.isFavorite ? 'text-yellow-400' : 'text-gray-500'
            }`}
            title={app.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star size={12} fill={app.isFavorite ? 'currentColor' : 'none'} />
          </button>
        )}
        {onToggleArchive && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleArchive(app.id);
            }}
            className="p-1 rounded hover:bg-gray-700 text-gray-500"
            title={app.isArchived ? 'Unarchive' : 'Archive'}
          >
            <Archive size={12} />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <aside className="w-full bg-gray-950 border-r border-gray-800 flex flex-col h-full">
      <div className="p-6 border-b border-gray-800">
        <div className="flex items-center gap-2 text-blue-500 font-bold text-xl tracking-tight">
          <LayoutDashboard />
          DevOrbit
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        {/* Dashboard Button */}
        <button
          onClick={onSelectDashboard}
          className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 transition-all ${
            activeTab === 'dashboard'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50'
              : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
          }`}
        >
          <LayoutDashboard size={18} />
          Overview
        </button>

        {/* Favorites Section */}
        {favorites.length > 0 && (
          <>
            <div className="pt-4 pb-2 px-2 text-xs font-semibold text-yellow-500 uppercase tracking-wider flex items-center gap-2">
              <Star size={12} fill="currentColor" />
              Favorites
            </div>
            <div className="space-y-1">
              {favorites.map((app) => renderAppItem(app))}
            </div>
          </>
        )}

        {/* Grouped Apps by Directory */}
        <div className="pt-4 pb-2 px-2 text-xs font-semibold text-gray-600 uppercase tracking-wider flex items-center justify-between">
          <span>Projects</span>
          {onRefresh && (
            <button
              onClick={handleRefreshAll}
              disabled={isRefreshing}
              className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
              title="Refresh all projects"
            >
              <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
          )}
        </div>

        {sortedDirs.map((dir) => {
          const dirApps = grouped[dir];
          return (
            <div key={dir} className="space-y-1">
              <div className="group flex items-center">
                <button
                  onClick={() => toggleDir(dir)}
                  className="flex-1 text-left px-2 py-1.5 rounded-l flex items-center gap-2 text-gray-500 hover:text-gray-300 hover:bg-gray-900/50 transition-colors"
                >
                  {expandedDirs.has(dir) ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                  <Folder size={14} />
                  <span className="text-sm truncate">{dir}</span>
                  <span className="ml-auto text-xs text-gray-600">{dirApps.length}</span>
                </button>
                {onRefreshDirectory && (
                  <button
                    onClick={(e) => handleRefreshDir(dir, e)}
                    disabled={refreshingDir !== null}
                    className="p-1.5 rounded-r opacity-0 group-hover:opacity-100 hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-all disabled:opacity-50"
                    title={`Refresh ${dir}`}
                  >
                    <RefreshCw size={12} className={refreshingDir === dir ? 'animate-spin' : ''} />
                  </button>
                )}
              </div>
              {expandedDirs.has(dir) && (
                <div className="ml-4 space-y-1 border-l border-gray-800 pl-2">
                  {dirApps.map((app) => renderAppItem(app))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Archive Section */}
      {archived.length > 0 && (
        <div className="border-t border-gray-800">
          <button
            onClick={() => setShowArchive(!showArchive)}
            className="w-full px-4 py-3 flex items-center justify-between text-gray-500 hover:text-gray-400 hover:bg-gray-900/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Archive size={16} />
              <span className="text-sm">Archive</span>
              <span className="text-xs text-gray-600">({archived.length})</span>
            </div>
            {showArchive ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {showArchive && (
            <div className="px-4 pb-3 space-y-1">
              {archived.map((app) => renderAppItem(app, false))}
            </div>
          )}
        </div>
      )}

      {/* User Section */}
      <div className="p-4 border-t border-gray-800">
        <div className="bg-gray-900 rounded-lg p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-bold text-xs">
            A
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">Admin User</div>
            <div className="text-xs text-gray-500">Local Environment</div>
          </div>
          <Settings
            size={16}
            className="text-gray-500 cursor-pointer hover:text-white shrink-0"
          />
        </div>
      </div>
    </aside>
  );
};
