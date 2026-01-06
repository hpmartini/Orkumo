import React, { useState } from 'react';
import {
  Play,
  Square,
  RefreshCw,
  Zap,
  Globe,
  Box,
  FolderOpen,
  Package,
  Settings2,
  Check,
  X,
  Pencil,
  Star,
  Archive,
  Terminal,
} from 'lucide-react';
import { AppConfig, AppStatus } from '../types';
import { StatusBadge } from './StatusBadge';
import { PerformanceCharts } from './PerformanceCharts';
import { XTerminal } from './XTerminal';
import { IDESelector } from './IDESelector';
import { CodingView } from './CodingView';

interface AppDetailProps {
  app: AppConfig | null;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onAnalyze: (id: string) => void;
  onOpenInBrowser: (id: string) => void;
  onInstallDeps?: (id: string) => void;
  onSetPort?: (id: string, port: number) => void;
  onRename?: (id: string, newName: string) => void;
  onToggleFavorite?: (id: string) => void;
  onToggleArchive?: (id: string) => void;
  onOpenInFinder?: (id: string) => void;
  onOpenInTerminal?: (id: string) => void;
  preferredIDE?: string | null;
}

type ViewMode = 'details' | 'coding';

export const AppDetail: React.FC<AppDetailProps> = ({
  app,
  onStart,
  onStop,
  onRestart,
  onAnalyze,
  onOpenInBrowser,
  onInstallDeps,
  onSetPort,
  onRename,
  onToggleFavorite,
  onToggleArchive,
  onOpenInFinder,
  onOpenInTerminal,
  preferredIDE,
}) => {
  const [activeView, setActiveView] = useState<ViewMode>('details');
  const [showPortEditor, setShowPortEditor] = useState(false);
  const [portValue, setPortValue] = useState('');
  const [showNameEditor, setShowNameEditor] = useState(false);
  const [nameValue, setNameValue] = useState('');

  if (!app) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 h-[60vh]">
        <Box size={48} className="mb-4 opacity-20" />
        <p>Select an application to view details</p>
      </div>
    );
  }

  const isLoading =
    app.status === AppStatus.STARTING ||
    app.status === AppStatus.ANALYZING ||
    app.status === AppStatus.RESTARTING;

  const canStart =
    app.status === AppStatus.STOPPED ||
    app.status === AppStatus.ERROR ||
    app.status === AppStatus.CANCELLED;

  const canStop = app.status === AppStatus.RUNNING;

  const canAnalyze =
    app.status !== AppStatus.RUNNING &&
    app.status !== AppStatus.ANALYZING &&
    app.status !== AppStatus.STARTING;

  const canInstall = app.status === AppStatus.STOPPED || app.status === AppStatus.ERROR;

  const handlePortSubmit = () => {
    const port = parseInt(portValue, 10);
    if (port && port > 0 && port < 65536 && onSetPort) {
      onSetPort(app.id, port);
      setShowPortEditor(false);
      setPortValue('');
    }
  };

  const handleNameSubmit = () => {
    const trimmedName = nameValue.trim();
    if (trimmedName && trimmedName !== app.name && onRename) {
      onRename(app.id, trimmedName);
      setShowNameEditor(false);
      setNameValue('');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* View Switcher Tabs */}
      <div className="flex border-b border-gray-700 bg-gray-850">
        <button
          onClick={() => setActiveView('details')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeView === 'details'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Details
        </button>
        <button
          onClick={() => setActiveView('coding')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeView === 'coding'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Coding
        </button>
      </div>

      {/* View Content */}
      <div className="flex-1 overflow-hidden">
        {activeView === 'details' ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 p-6">
            {/* Header */}
            <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div className="space-y-3">
                  {/* App Name & Status */}
                  <div className="flex items-center gap-3">
                    {showNameEditor ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={nameValue}
                          onChange={(e) => setNameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleNameSubmit();
                            if (e.key === 'Escape') setShowNameEditor(false);
                          }}
                          placeholder={app.name}
                          className="text-2xl font-bold bg-gray-900 border border-gray-600 rounded-lg px-3 py-1 text-white focus:outline-none focus:border-blue-500 w-64"
                          autoFocus
                        />
                        <button
                          onClick={handleNameSubmit}
                          className="p-2 text-emerald-400 hover:bg-gray-700 rounded-lg transition-colors"
                          title="Save"
                        >
                          <Check size={20} />
                        </button>
                        <button
                          onClick={() => {
                            setShowNameEditor(false);
                            setNameValue('');
                          }}
                          className="p-2 text-gray-400 hover:bg-gray-700 rounded-lg transition-colors"
                          title="Cancel"
                        >
                          <X size={20} />
                        </button>
                      </div>
                    ) : (
                      <h1 className="text-2xl font-bold text-white flex items-center gap-3 group">
                        {app.name}
                        {onRename && (
                          <button
                            onClick={() => {
                              setNameValue(app.name);
                              setShowNameEditor(true);
                            }}
                            className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-700 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                            title="Rename application"
                          >
                            <Pencil size={16} />
                          </button>
                        )}
                      </h1>
                    )}
                    <StatusBadge status={app.status} />
                    {onToggleFavorite && (
                      <button
                        onClick={() => onToggleFavorite(app.id)}
                        className={`p-1.5 rounded-lg transition-all ${
                          app.isFavorite
                            ? 'text-yellow-400 hover:bg-yellow-500/20'
                            : 'text-gray-500 hover:text-yellow-400 hover:bg-gray-700'
                        }`}
                        title={app.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                      >
                        <Star size={20} fill={app.isFavorite ? 'currentColor' : 'none'} />
                      </button>
                    )}
                  </div>

                  {/* Directory Path */}
                  <div className="flex items-center gap-2 text-gray-400 text-sm">
                    <FolderOpen size={16} className="text-blue-400 shrink-0" />
                    <span className="font-mono bg-gray-900/50 px-2 py-0.5 rounded truncate max-w-md" title={app.path}>
                      {app.path}
                    </span>
                  </div>

                  {/* Technology/Framework */}
                  {app.detectedFramework && (
                    <div className="flex items-center gap-2 text-gray-400 text-sm">
                      <Package size={16} className="text-purple-400 shrink-0" />
                      <span>{app.detectedFramework}</span>
                    </div>
                  )}

                  {/* Start Command */}
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 text-xs">Command:</span>
                    <code className="text-gray-300 text-sm font-mono bg-gray-900/50 px-2 py-0.5 rounded">
                      {app.startCommand || 'npm run dev'}
                    </code>
                  </div>

                  {/* Port & Addresses */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 text-xs">Port:</span>
                      {showPortEditor ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={portValue}
                            onChange={(e) => setPortValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handlePortSubmit();
                              if (e.key === 'Escape') setShowPortEditor(false);
                            }}
                            placeholder={String(app.port || 3000)}
                            className="w-20 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-sm font-mono focus:outline-none focus:border-blue-500"
                            min="1"
                            max="65535"
                            autoFocus
                          />
                          <button
                            onClick={handlePortSubmit}
                            className="p-1 text-emerald-400 hover:bg-gray-700 rounded"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={() => setShowPortEditor(false)}
                            className="p-1 text-gray-400 hover:bg-gray-700 rounded"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setPortValue(String(app.port || 3000));
                            setShowPortEditor(true);
                          }}
                          className="flex items-center gap-1 text-cyan-400 font-mono text-sm hover:text-cyan-300 transition-colors"
                          title="Click to change port"
                        >
                          {app.port || 3000}
                          <Settings2 size={12} className="opacity-50" />
                        </button>
                      )}
                    </div>
                    {app.addresses && app.addresses.length > 0 && (
                      <span className="text-gray-500 text-xs">
                        ({app.addresses.join(', ')})
                      </span>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 flex-wrap">
                  {canStop ? (
                    <button
                      onClick={() => onStop(app.id)}
                      className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 rounded-lg transition-all"
                    >
                      <Square size={18} fill="currentColor" /> Stop
                    </button>
                  ) : (
                    <button
                      onClick={() => onStart(app.id)}
                      disabled={!canStart || isLoading}
                      className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-500/20 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isLoading ? (
                        <RefreshCw className="animate-spin" size={18} />
                      ) : (
                        <Play size={18} fill="currentColor" />
                      )}
                      {app.status === AppStatus.STARTING ? 'Starting...' : 'Run'}
                    </button>
                  )}

                  <button
                    onClick={() => onRestart(app.id)}
                    disabled={app.status !== AppStatus.RUNNING}
                    className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Restart application"
                  >
                    <RefreshCw size={18} />
                  </button>

                  {onInstallDeps && (
                    <button
                      onClick={() => onInstallDeps(app.id)}
                      disabled={!canInstall}
                      className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Install dependencies (npm install)"
                    >
                      <Package size={18} />
                      <span className="hidden lg:inline">Install</span>
                    </button>
                  )}

                  <button
                    onClick={() => onAnalyze(app.id)}
                    disabled={!canAnalyze}
                    className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 rounded-lg transition-all disabled:opacity-50"
                    title="Use AI to detect config"
                  >
                    {app.status === AppStatus.ANALYZING ? (
                      <RefreshCw className="animate-spin" size={18} />
                    ) : (
                      <Zap size={18} />
                    )}
                    <span className="hidden lg:inline">AI Config</span>
                  </button>

                  <button
                    onClick={() => onOpenInBrowser(app.id)}
                    disabled={app.status !== AppStatus.RUNNING}
                    className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 rounded-lg transition-all disabled:opacity-50"
                    title="Open in browser"
                  >
                    <Globe size={18} />
                  </button>

                  {onOpenInFinder && (
                    <button
                      onClick={() => onOpenInFinder(app.id)}
                      className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 rounded-lg transition-all"
                      title="Open in Finder"
                    >
                      <FolderOpen size={18} />
                    </button>
                  )}

                  {onOpenInTerminal && (
                    <button
                      onClick={() => onOpenInTerminal(app.id)}
                      className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 rounded-lg transition-all"
                      title="Open in Terminal"
                    >
                      <Terminal size={18} />
                    </button>
                  )}

                  <IDESelector
                    appId={app.id}
                    preferredIDE={preferredIDE}
                  />

                  {onToggleArchive && (
                    <button
                      onClick={() => onToggleArchive(app.id)}
                      className={`flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 rounded-lg transition-all ${
                        app.isArchived ? 'text-orange-400' : ''
                      }`}
                      title={app.isArchived ? 'Unarchive' : 'Archive'}
                    >
                      <Archive size={18} />
                    </button>
                  )}
                </div>
              </div>

              {/* AI Analysis Result */}
              {app.aiAnalysis && (
                <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-start gap-3">
                  <Zap className="text-blue-400 shrink-0 mt-0.5" size={16} />
                  <p className="text-sm text-blue-200">{app.aiAnalysis}</p>
                </div>
              )}
            </div>

            {/* Performance Charts */}
            <PerformanceCharts
              cpuHistory={app.stats.cpu}
              memoryHistory={app.stats.memory}
            />

            {/* XTerminal with tabs */}
            <XTerminal
              logs={app.logs}
              isRunning={app.status === AppStatus.RUNNING}
              cwd={app.path}
            />
          </div>
        ) : (
          <CodingView app={app} />
        )}
      </div>
    </div>
  );
};
