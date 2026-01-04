import React from 'react';
import { Star, Play, Square, RefreshCw, Globe, Archive } from 'lucide-react';
import { AppConfig, AppStatus } from '../types';
import { StatusBadge } from './StatusBadge';

interface FavoritesListProps {
  apps: AppConfig[];
  selectedAppId: string | null;
  onSelectApp: (id: string) => void;
  onStart?: (id: string) => void;
  onStop?: (id: string) => void;
  onRestart?: (id: string) => void;
  onOpenInBrowser?: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
  onToggleArchive?: (id: string) => void;
}

export const FavoritesList: React.FC<FavoritesListProps> = ({
  apps,
  selectedAppId,
  onSelectApp,
  onStart,
  onStop,
  onRestart,
  onOpenInBrowser,
  onToggleFavorite,
  onToggleArchive,
}) => {
  const favorites = apps.filter(app => app.isFavorite && !app.isArchived);

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

  return (
    <div className="bg-gradient-to-br from-yellow-900/20 to-gray-800 rounded-xl border border-yellow-700/30 overflow-hidden">
      <div className="p-4 border-b border-yellow-700/30 flex justify-between items-center bg-yellow-900/10">
        <h2 className="text-lg font-semibold text-yellow-400 flex items-center gap-2">
          <Star size={18} fill="currentColor" /> Favorites
        </h2>
        <span className="text-xs text-yellow-600 bg-yellow-900/30 px-2 py-1 rounded-full">
          {favorites.length} {favorites.length === 1 ? 'app' : 'apps'}
        </span>
      </div>
      <div className="divide-y divide-yellow-700/20">
        {favorites.map((app) => (
          <div
            key={app.id}
            onClick={() => onSelectApp(app.id)}
            className={`p-4 flex items-center justify-between hover:bg-yellow-900/10 transition-colors cursor-pointer group ${
              selectedAppId === app.id ? 'bg-yellow-900/20' : ''
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
