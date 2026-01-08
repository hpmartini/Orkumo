import React, { useState, useCallback, useMemo } from 'react';
import { Star, Play, Square, RefreshCw, Globe, Archive, GripVertical, ArrowUpAZ, ArrowDownZA, Hand } from 'lucide-react';
import { AppConfig, AppStatus } from '../types';
import { StatusBadge } from './StatusBadge';
import { FavoritesSortMode } from '../services/api';

interface FavoritesListProps {
  apps: AppConfig[];
  selectedAppId: string | null;
  favoritesOrder: string[];
  favoritesSortMode: FavoritesSortMode;
  onSelectApp: (id: string) => void;
  onStart?: (id: string) => void;
  onStop?: (id: string) => void;
  onRestart?: (id: string) => void;
  onOpenInBrowser?: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
  onToggleArchive?: (id: string) => void;
  onReorderFavorites?: (newOrder: string[]) => void;
  onSetSortMode?: (mode: FavoritesSortMode) => void;
}

export const FavoritesList: React.FC<FavoritesListProps> = ({
  apps,
  selectedAppId,
  favoritesOrder,
  favoritesSortMode,
  onSelectApp,
  onStart,
  onStop,
  onRestart,
  onOpenInBrowser,
  onToggleFavorite,
  onToggleArchive,
  onReorderFavorites,
  onSetSortMode,
}) => {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Get favorites from apps and sort them according to the current sort mode
  const favorites = useMemo(() => {
    const favoriteApps = apps.filter(app => app.isFavorite && !app.isArchived);

    if (favoritesSortMode === 'alpha-asc') {
      return [...favoriteApps].sort((a, b) => a.name.localeCompare(b.name));
    } else if (favoritesSortMode === 'alpha-desc') {
      return [...favoriteApps].sort((a, b) => b.name.localeCompare(a.name));
    }

    // Manual sort: use favoritesOrder to determine order
    const orderMap = new Map(favoritesOrder.map((id, index) => [id, index]));
    return [...favoriteApps].sort((a, b) => {
      const aIndex = orderMap.get(a.id) ?? Infinity;
      const bIndex = orderMap.get(b.id) ?? Infinity;
      return aIndex - bIndex;
    });
  }, [apps, favoritesOrder, favoritesSortMode]);

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, appId: string) => {
    if (favoritesSortMode !== 'manual') return;
    setDraggedId(appId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', appId);
    // Add dragging class after a short delay to prevent visual glitch
    requestAnimationFrame(() => {
      const element = e.currentTarget as HTMLElement;
      element.style.opacity = '0.5';
    });
  }, [favoritesSortMode]);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    setDraggedId(null);
    setDragOverId(null);
    (e.currentTarget as HTMLElement).style.opacity = '1';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, appId: string) => {
    if (favoritesSortMode !== 'manual') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedId && appId !== draggedId) {
      setDragOverId(appId);
    }
  }, [draggedId, favoritesSortMode]);

  const handleDragLeave = useCallback(() => {
    setDragOverId(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId || favoritesSortMode !== 'manual') return;

    const currentOrder = favorites.map(app => app.id);
    const draggedIndex = currentOrder.indexOf(draggedId);
    const targetIndex = currentOrder.indexOf(targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // Remove dragged item and insert at new position
    const newOrder = [...currentOrder];
    newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedId);

    onReorderFavorites?.(newOrder);
    setDraggedId(null);
    setDragOverId(null);
  }, [draggedId, favorites, favoritesSortMode, onReorderFavorites]);

  if (favorites.length === 0) {
    return null;
  }

  const isLoading = (status: AppStatus) =>
    status === AppStatus.STARTING ||
    status === AppStatus.ANALYZING ||
    status === AppStatus.RESTARTING;

  const canStart = (status: AppStatus) =>
    status === AppStatus.STOPPED ||
    status === AppStatus.ERROR ||
    status === AppStatus.CANCELLED;

  const sortModes: { mode: FavoritesSortMode; icon: React.ReactNode; label: string }[] = [
    { mode: 'manual', icon: <Hand size={14} />, label: 'Manual' },
    { mode: 'alpha-asc', icon: <ArrowUpAZ size={14} />, label: 'A-Z' },
    { mode: 'alpha-desc', icon: <ArrowDownZA size={14} />, label: 'Z-A' },
  ];

  return (
    <div className="bg-gradient-to-br from-yellow-900/20 to-gray-800 rounded-xl border border-yellow-700/30 overflow-hidden">
      <div className="p-4 border-b border-yellow-700/30 flex justify-between items-center bg-yellow-900/10">
        <h2 className="text-lg font-semibold text-yellow-400 flex items-center gap-2">
          <Star size={18} fill="currentColor" /> Favorites
        </h2>
        <div className="flex items-center gap-2">
          {/* Sort mode toggle */}
          <div className="flex items-center gap-1 bg-gray-800/50 rounded-lg p-0.5">
            {sortModes.map(({ mode, icon, label }) => (
              <button
                key={mode}
                onClick={() => onSetSortMode?.(mode)}
                className={`p-1.5 rounded-md flex items-center gap-1 text-xs transition-all ${
                  favoritesSortMode === mode
                    ? 'bg-yellow-600/30 text-yellow-400'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-700/50'
                }`}
                title={label}
              >
                {icon}
              </button>
            ))}
          </div>
          <span className="text-xs text-yellow-600 bg-yellow-900/30 px-2 py-1 rounded-full">
            {favorites.length} {favorites.length === 1 ? 'app' : 'apps'}
          </span>
        </div>
      </div>
      <div className="divide-y divide-yellow-700/20">
        {favorites.map((app) => (
          <div
            key={app.id}
            draggable={favoritesSortMode === 'manual'}
            onDragStart={(e) => handleDragStart(e, app.id)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, app.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, app.id)}
            onClick={() => onSelectApp(app.id)}
            className={`p-4 flex items-center justify-between hover:bg-yellow-900/10 transition-all cursor-pointer group ${
              selectedAppId === app.id ? 'bg-yellow-900/20' : ''
            } ${dragOverId === app.id ? 'bg-yellow-900/30 border-t-2 border-yellow-500' : ''} ${
              draggedId === app.id ? 'opacity-50' : ''
            }`}
          >
            <div className="flex items-center gap-4">
              {/* Drag handle - only show in manual mode */}
              {favoritesSortMode === 'manual' && (
                <div
                  className="cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-gray-300"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <GripVertical size={16} />
                </div>
              )}
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
            <div className="flex items-center gap-2">
              <StatusBadge status={app.status} />
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {/* Quick Actions */}
                {app.status === AppStatus.RUNNING ? (
                  <>
                    {onStop && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onStop(app.id);
                        }}
                        className="p-1.5 rounded hover:bg-red-500/20 text-red-400"
                        title="Stop"
                      >
                        <Square size={14} fill="currentColor" />
                      </button>
                    )}
                    {onRestart && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRestart(app.id);
                        }}
                        className="p-1.5 rounded hover:bg-gray-700 text-gray-400"
                        title="Restart"
                      >
                        <RefreshCw size={14} />
                      </button>
                    )}
                    {onOpenInBrowser && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenInBrowser(app.id);
                        }}
                        className="p-1.5 rounded hover:bg-blue-500/20 text-blue-400"
                        title="Open in browser"
                      >
                        <Globe size={14} />
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
                      className="p-1.5 rounded hover:bg-emerald-500/20 text-emerald-400 disabled:opacity-50"
                      title="Start"
                    >
                      {isLoading(app.status) ? (
                        <RefreshCw size={14} className="animate-spin" />
                      ) : (
                        <Play size={14} fill="currentColor" />
                      )}
                    </button>
                  )
                )}
                {onToggleFavorite && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(app.id);
                    }}
                    className="p-1.5 rounded hover:bg-yellow-500/20 text-yellow-400"
                    title="Remove from favorites"
                  >
                    <Star size={14} fill="currentColor" />
                  </button>
                )}
                {onToggleArchive && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleArchive(app.id);
                    }}
                    className="p-1.5 rounded hover:bg-gray-700 text-gray-500"
                    title="Archive"
                  >
                    <Archive size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
