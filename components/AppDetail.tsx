import React from 'react';
import { Play, Square, RefreshCw, Zap, Globe, Box } from 'lucide-react';
import { AppConfig, AppStatus } from '../types';
import { StatusBadge } from './StatusBadge';
import { PerformanceCharts } from './PerformanceCharts';
import { Terminal } from './Terminal';

interface AppDetailProps {
  app: AppConfig | null;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onAnalyze: (id: string) => void;
  onOpenInBrowser: (id: string) => void;
}

export const AppDetail: React.FC<AppDetailProps> = ({
  app,
  onStart,
  onStop,
  onRestart,
  onAnalyze,
  onOpenInBrowser,
}) => {
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

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white mb-2 flex items-center gap-3">
              {app.name}
              <StatusBadge status={app.status} />
            </h1>
            <p className="text-gray-400 text-sm font-mono bg-gray-900/50 px-3 py-1 rounded inline-block">
              {app.startCommand || 'npm run dev'}
            </p>
            {app.port && (
              <p className="text-gray-500 text-xs mt-2">
                Port: {app.port}
                {app.addresses && app.addresses.length > 0 && (
                  <span className="ml-2">
                    ({app.addresses.join(', ')})
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="flex gap-3 flex-wrap">
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
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title="Restart application"
            >
              <RefreshCw size={18} />
              Restart
            </button>

            <button
              onClick={() => onAnalyze(app.id)}
              disabled={!canAnalyze}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 rounded-lg transition-all disabled:opacity-50"
              title="Use AI to detect config"
            >
              {app.status === AppStatus.ANALYZING ? (
                <RefreshCw className="animate-spin" size={18} />
              ) : (
                <Zap size={18} />
              )}
              AI Config
            </button>

            <button
              onClick={() => onOpenInBrowser(app.id)}
              disabled={app.status !== AppStatus.RUNNING}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 rounded-lg transition-all disabled:opacity-50"
            >
              <Globe size={18} />
              Open
            </button>
          </div>
        </div>

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

      {/* Terminal */}
      <Terminal
        logs={app.logs}
        isRunning={app.status === AppStatus.RUNNING}
      />
    </div>
  );
};
