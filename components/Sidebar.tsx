import React from 'react';
import { LayoutDashboard, Settings } from 'lucide-react';
import { AppConfig, AppStatus } from '../types';

interface SidebarProps {
  apps: AppConfig[];
  selectedAppId: string | null;
  activeTab: 'dashboard' | 'apps';
  onSelectDashboard: () => void;
  onSelectApp: (id: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  apps,
  selectedAppId,
  activeTab,
  onSelectDashboard,
  onSelectApp,
}) => {
  return (
    <aside className="w-64 bg-gray-950 border-r border-gray-800 hidden md:flex flex-col">
      <div className="p-6 border-b border-gray-800">
        <div className="flex items-center gap-2 text-blue-500 font-bold text-xl tracking-tight">
          <LayoutDashboard />
          DevOrbit
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
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

        <div className="pt-6 pb-2 px-4 text-xs font-semibold text-gray-600 uppercase tracking-wider">
          Detected Apps
        </div>

        {apps.map((app) => (
          <button
            key={app.id}
            onClick={() => onSelectApp(app.id)}
            className={`w-full text-left px-4 py-2.5 rounded-lg flex items-center justify-between group transition-all ${
              selectedAppId === app.id
                ? 'bg-gray-800 text-white'
                : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-2 h-2 rounded-full ${
                  app.status === AppStatus.RUNNING
                    ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                    : 'bg-gray-600'
                }`}
              ></div>
              <span className="truncate max-w-[120px]">{app.name}</span>
            </div>
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-800">
        <div className="bg-gray-900 rounded-lg p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-bold text-xs">
            A
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium">Admin User</div>
            <div className="text-xs text-gray-500">Local Environment</div>
          </div>
          <Settings
            size={16}
            className="text-gray-500 cursor-pointer hover:text-white"
          />
        </div>
      </div>
    </aside>
  );
};
