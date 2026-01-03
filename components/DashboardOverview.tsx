import React from 'react';
import { LayoutDashboard, Activity, Cpu, Zap, Radio } from 'lucide-react';
import { AppConfig, AppStatus } from '../types';

interface DashboardOverviewProps {
  totalApps: number;
  runningCount: number;
  totalCpu: number;
  aiEnabled?: boolean;
  apps: AppConfig[];
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  totalApps,
  runningCount,
  totalCpu,
  aiEnabled = true,
  apps,
}) => {
  // Get all ports from running apps
  const activePorts = apps
    .filter((app) => app.status === AppStatus.RUNNING && app.port)
    .map((app) => ({ name: app.name, port: app.port! }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400">
            <LayoutDashboard size={20} />
          </div>
          <span className="text-xs font-medium text-gray-400">Total Projects</span>
        </div>
        <div className="text-3xl font-bold text-white">{totalApps}</div>
        <div className="text-xs text-gray-500 mt-1">Discovered in configured dirs</div>
      </div>

      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div className="p-2 bg-emerald-500/20 rounded-lg text-emerald-400">
            <Activity size={20} />
          </div>
          <span className="text-xs font-medium text-gray-400">Active Services</span>
        </div>
        <div className="text-3xl font-bold text-white">{runningCount}</div>
        <div className="text-xs text-gray-500 mt-1">Currently running</div>
      </div>

      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400">
            <Cpu size={20} />
          </div>
          <span className="text-xs font-medium text-gray-400">Total CPU Load</span>
        </div>
        <div className="text-3xl font-bold text-white">{totalCpu.toFixed(1)}%</div>
        <div className="text-xs text-gray-500 mt-1">Across all processes</div>
      </div>

      {/* Active Ports Card */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div className="p-2 bg-cyan-500/20 rounded-lg text-cyan-400">
            <Radio size={20} />
          </div>
          <span className="text-xs font-medium text-gray-400">Active Ports</span>
        </div>
        {activePorts.length > 0 ? (
          <div className="space-y-1.5 max-h-20 overflow-y-auto scrollbar-hide">
            {activePorts.map(({ name, port }) => (
              <div key={port} className="flex items-center justify-between text-sm">
                <span className="text-gray-400 truncate max-w-[80px]" title={name}>
                  {name}
                </span>
                <a
                  href={`http://localhost:${port}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  :{port}
                </a>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500">No active ports</div>
        )}
      </div>

      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg relative overflow-hidden">
        <div className="flex items-center justify-between mb-4 relative z-10">
          <div className="p-2 bg-amber-500/20 rounded-lg text-amber-400">
            <Zap size={20} />
          </div>
          <span className="text-xs font-medium text-gray-400">AI Analysis</span>
        </div>
        <div className="text-sm text-gray-300 relative z-10">
          {aiEnabled
            ? 'Ready to optimize configurations.'
            : 'Set GEMINI_API_KEY to enable.'}
        </div>
        <div className="absolute -bottom-4 -right-4 opacity-10">
          <Zap size={100} />
        </div>
      </div>
    </div>
  );
};
