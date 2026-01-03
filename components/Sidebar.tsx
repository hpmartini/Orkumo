import React, { useMemo, useState } from 'react';
import {
  LayoutDashboard,
  Settings,
  ChevronDown,
  ChevronRight,
  Star,
  Archive,
  Folder,
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
}) => {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [showArchive, setShowArchive] = useState(false);

  // Group apps by parent directory, separate favorites and archived
  const { favorites, grouped, archived } = useMemo(() => {
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

    return { favorites: favs, grouped: groups, archived: arch };
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

  const renderAppItem = (app: AppConfig, showFavoriteIcon = true) => (
    <button
      key={app.id}
      onClick={() => onSelectApp(app.id)}
      className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between group transition-all ${
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
              : 'bg-gray-600'
          }`}
        />
        <span className="truncate text-sm">{app.name}</span>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
            <Star size={14} fill={app.isFavorite ? 'currentColor' : 'none'} />
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
            <Archive size={14} />
          </button>
        )}
      </div>
    </button>
  );

  return (
    <aside className="w-64 bg-gray-950 border-r border-gray-800 flex flex-col h-full">
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
        <div className="pt-4 pb-2 px-2 text-xs font-semibold text-gray-600 uppercase tracking-wider">
          Projects
        </div>

        {Object.entries(grouped).map(([dir, dirApps]) => (
          <div key={dir} className="space-y-1">
            <button
              onClick={() => toggleDir(dir)}
              className="w-full text-left px-2 py-1.5 rounded flex items-center gap-2 text-gray-500 hover:text-gray-300 hover:bg-gray-900/50 transition-colors"
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
            {expandedDirs.has(dir) && (
              <div className="ml-4 space-y-1 border-l border-gray-800 pl-2">
                {dirApps.map((app) => renderAppItem(app))}
              </div>
            )}
          </div>
        ))}
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
