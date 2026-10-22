import React, { useState } from 'react';
import { ChevronDown, ChevronRight, LayoutDashboard, Play, Settings, Square } from 'lucide-react';
import type { AgentGrouping } from '../../types';
import type { AgentConfigLike } from './types';

/** App-level navigation and actions the merged rail needs from App.tsx */
export interface RailNavProps {
  onOpenDashboard: () => void;
  onOpenSettings: () => void;
  onOpenProject: (appId: string) => void;
  onStartApp: (appId: string) => void;
  onStopApp: (appId: string) => void;
}

const GROUP_MODES: { key: AgentGrouping; label: string }[] = [
  { key: 'project', label: 'Project' },
  { key: 'state', label: 'Status' },
  { key: 'directory', label: 'Directory' },
  { key: 'none', label: 'None' },
];

const PROJECTS_COLLAPSED_KEY = 'devOrbitAgentProjectsCollapsed';

export const isAppRunning = (app?: AgentConfigLike) => app?.status === 'RUNNING';

export const AppStatusDot: React.FC<{ status?: string }> = ({ status }) => (
  <span
    className={`w-2 h-2 rounded-full shrink-0 ${
      status === 'RUNNING'
        ? 'bg-emerald-400'
        : status === 'ERROR'
          ? 'bg-red-400'
          : status === 'STARTING' || status === 'RESTARTING'
            ? 'bg-yellow-400 motion-safe:animate-pulse'
            : 'bg-gray-500'
    }`}
    title={status ? status.toLowerCase() : 'stopped'}
  />
);

/** Start / stop toggle for an app, used by project headers and the Projects section */
export const AppPowerButton: React.FC<{
  app: AgentConfigLike;
  nav: RailNavProps;
}> = ({ app, nav }) => {
  const running = isAppRunning(app);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        (running ? nav.onStopApp : nav.onStartApp)(app.id);
      }}
      className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
      title={running ? `Stop ${app.name}` : `Start ${app.name}`}
      aria-label={running ? `Stop ${app.name}` : `Start ${app.name}`}
    >
      {running ? <Square size={11} /> : <Play size={11} />}
    </button>
  );
};

/** Slim top navigation plus the group-mode switch */
export const RailNav: React.FC<{
  nav: RailNavProps;
  grouping: AgentGrouping;
  onGrouping: (grouping: AgentGrouping) => void;
}> = ({ nav, grouping, onGrouping }) => (
  <div className="px-3 py-2 border-b border-gray-700 space-y-2 shrink-0">
    <div className="flex items-center gap-1 text-xs">
      <button
        onClick={nav.onOpenDashboard}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-gray-400 hover:text-white hover:bg-gray-800"
      >
        <LayoutDashboard size={13} /> Dashboard
      </button>
      <span
        className="flex items-center gap-1.5 px-2 py-1 rounded bg-gray-800 text-white"
        aria-current="page"
      >
        Agents
      </span>
      <div className="flex-1" />
      <button
        onClick={nav.onOpenSettings}
        className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800"
        title="Settings"
        aria-label="Settings"
      >
        <Settings size={13} />
      </button>
    </div>
    <div
      className="flex rounded border border-gray-700 bg-gray-900 p-0.5 text-xs"
      role="group"
      aria-label="Group agents by (Ctrl+S)"
      title="Group agents by (Ctrl+S)"
    >
      {GROUP_MODES.map((mode) => (
        <button
          key={mode.key}
          onClick={() => onGrouping(mode.key)}
          aria-pressed={grouping === mode.key}
          className={`flex-1 px-2 py-0.5 rounded ${
            grouping === mode.key ? 'bg-sel text-white' : 'text-gray-300 hover:text-white'
          }`}
        >
          {mode.label}
        </button>
      ))}
    </div>
  </div>
);

/** Collapsible list of DevOrbit apps for the status grouping (favorites first) */
export const ProjectsSection: React.FC<{
  apps: AgentConfigLike[];
  nav: RailNavProps;
  /** A filter is active: the list is for agents, so keep the project list out of the way */
  filtered?: boolean;
}> = ({ apps, nav, filtered }) => {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      // Collapsed by default: 13 expanded projects push the agents below the fold
      return localStorage.getItem(PROJECTS_COLLAPSED_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem(PROJECTS_COLLAPSED_KEY, String(!collapsed));
    } catch {
      // stays in memory only
    }
  };
  const list = apps
    .filter((app) => !app.isArchived)
    .sort(
      (a, b) => Number(!!b.isFavorite) - Number(!!a.isFavorite) || a.name.localeCompare(b.name)
    );
  if (list.length === 0) return null;
  const running = list.filter(isAppRunning).length;
  const open = !collapsed && !filtered;
  return (
    <div className="mx-2 mt-2 rounded-lg border border-gray-700 bg-gray-850 overflow-hidden">
      <button
        onClick={toggle}
        aria-expanded={open}
        className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-300 bg-gray-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cursor ${open ? 'border-b border-gray-700' : ''}`}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Projects
        <span className="font-normal text-gray-400">
          {running}/{list.length} running
        </span>
      </button>
      {open && (
        <div className="max-h-44 overflow-y-auto thin-scrollbar">
          {list.map((app) => (
            <div key={app.id} className="group flex items-center gap-2 px-3 py-1 hover:bg-gray-800">
              <AppStatusDot status={app.status} />
              <button
                onClick={() => nav.onOpenProject(app.id)}
                className="flex-1 min-w-0 truncate text-left text-sm text-gray-300 hover:text-white"
                title={`Open ${app.name}\n${app.path}`}
              >
                {app.name}
              </button>
              <span className="opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                <AppPowerButton app={app} nav={nav} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
