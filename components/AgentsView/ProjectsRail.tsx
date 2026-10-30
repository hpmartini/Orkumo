import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Code2,
  Settings,
  Workflow,
} from 'lucide-react';
import type { AgentGrouping } from '../../types';
import type { AgentConfigLike } from './types';
import { codeUrl } from '../../utils/codeTarget';

/** App-level navigation and actions the merged rail needs from App.tsx */
export interface RailNavProps {
  onOpenDashboard: () => void;
  onOpenWorkflows?: () => void;
  onOpenSettings: () => void;
  onOpenProject: (appId: string) => void;
}

const GROUP_MODES: { key: AgentGrouping; label: string }[] = [
  { key: 'project', label: 'Project' },
  { key: 'state', label: 'Status' },
  { key: 'directory', label: 'Directory' },
  { key: 'none', label: 'None' },
];

const PROJECTS_COLLAPSED_KEY = 'devOrbitAgentProjectsCollapsed';

/** Group-mode switch plus rail-wide buttons (collapse, workflows, settings) */
export const RailNav: React.FC<{
  nav: RailNavProps;
  grouping: AgentGrouping;
  onGrouping: (grouping: AgentGrouping) => void;
  /** Header buttons; hidden when not given */
  onCollapseAll?: () => void;
  onExpandAll?: () => void;
  /** A quick filter forces every group open: the buttons would have no visible effect */
  collapseDisabled?: boolean;
}> = ({ nav, grouping, onGrouping, onCollapseAll, onExpandAll, collapseDisabled }) => (
  <div className="px-3 py-2 border-b border-gray-700 shrink-0">
    <div className="flex items-center gap-1">
      <div
        className="flex flex-1 rounded border border-gray-700 bg-gray-900 p-0.5 text-xs"
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
      {onCollapseAll && (
        <button
          onClick={onCollapseAll}
          disabled={collapseDisabled}
          className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor disabled:opacity-40 disabled:pointer-events-none"
          title={collapseDisabled ? 'Clear the filters to collapse groups' : 'Collapse all groups'}
          aria-label="Collapse all groups"
        >
          <ChevronsDownUp size={13} />
        </button>
      )}
      {onExpandAll && (
        <button
          onClick={onExpandAll}
          disabled={collapseDisabled}
          className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor disabled:opacity-40 disabled:pointer-events-none"
          title={collapseDisabled ? 'Clear the filters to expand groups' : 'Expand all groups'}
          aria-label="Expand all groups"
        >
          <ChevronsUpDown size={13} />
        </button>
      )}
      {nav.onOpenWorkflows && (
        <button
          onClick={nav.onOpenWorkflows}
          className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
          title="Workflows"
          aria-label="Workflows"
        >
          <Workflow size={13} />
        </button>
      )}
      <button
        onClick={nav.onOpenSettings}
        className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
        title="Settings"
        aria-label="Settings"
      >
        <Settings size={13} />
      </button>
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
  const navigate = useNavigate();
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
        <span className="font-normal text-gray-400">{list.length}</span>
      </button>
      {open && (
        <div>
          {list.map((app) => (
            <div key={app.id} className="group flex items-center gap-2 px-3 py-1 hover:bg-gray-800">
              <button
                onClick={() => nav.onOpenProject(app.id)}
                className="flex-1 min-w-0 truncate text-left text-sm text-gray-300 hover:text-white"
                title={`Open ${app.name}\n${app.path}`}
              >
                {app.name}
              </button>
              <span className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                <button
                  onClick={() => navigate(codeUrl(app.path))}
                  className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
                  title={`View code of ${app.name}`}
                  aria-label={`View code of ${app.name}`}
                >
                  <Code2 size={11} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
