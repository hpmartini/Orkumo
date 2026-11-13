import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Code2,
  Layers,
  ListChevronsDownUp,
  ListChevronsUpDown,
} from 'lucide-react';
import type { AgentGrouping } from '../../types';
import type { AgentConfigLike } from './types';
import { codeUrl } from '../../utils/codeTarget';
import type { ModeEntry } from '../../hooks/useModules';

/** App-level navigation and actions the merged rail needs from App.tsx */
export interface RailNavProps {
  /** Global dashboard (all contexts) */
  onOpenDashboard: () => void;
  /** Dashboard of the active context (#184) */
  onOpenContextDashboard: () => void;
  /** Modes of loaded modules: one rail button each, and per-agent/repo entries for scoped ones */
  modes?: ModeEntry[];
  /** Ids of module UIs rendered after the New task button (slot `agents-rail`) */
  railSlots?: string[];
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

/** Pointer may cross the gap between trigger and menu without the menu closing */
const HOVER_CLOSE_MS = 150;

/** Grouping of the agent list: shows only the current grouping; hovering (or clicking) opens the others */
export const GroupingPicker: React.FC<{
  grouping: AgentGrouping;
  onGrouping: (grouping: AgentGrouping) => void;
}> = ({ grouping, onGrouping }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const current = GROUP_MODES.find((m) => m.key === grouping) ?? GROUP_MODES[0];

  const cancelClose = () => window.clearTimeout(closeTimer.current);
  useEffect(() => cancelClose, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      setOpen(false);
      if (rootRef.current?.contains(document.activeElement))
        rootRef.current.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };
  const item =
    'w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700 hover:text-white focus-visible:bg-gray-700 focus-visible:outline-none disabled:opacity-40 disabled:pointer-events-none';

  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={() => {
        cancelClose();
        closeTimer.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
      }}
    >
      <button
        type="button"
        // Hover already opened it for the mouse; Enter / Space (detail 0) toggles
        onClick={(e) => setOpen((v) => (e.detail === 0 ? !v : true))}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Group agents by: ${current.label} (Ctrl+S)`}
        title="Group agents by (Ctrl+S)"
        className={`flex items-center gap-1 px-1.5 py-1 rounded border text-gray-300 hover:bg-gray-800 ${
          open ? 'bg-gray-800 border-gray-700' : 'border-gray-800'
        }`}
      >
        <Layers size={12} aria-hidden />
        {current.label}
      </button>
      {open && (
        // pt-1 instead of mt-1: the pointer stays inside the hover area on its way to the menu
        <div className="absolute left-0 top-full pt-1 z-30">
          <div
            role="menu"
            aria-label="Group agents by"
            className="min-w-[180px] bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1"
          >
            {GROUP_MODES.map((mode) => (
              <button
                key={mode.key}
                type="button"
                role="menuitemradio"
                aria-checked={mode.key === grouping}
                onClick={() => run(() => onGrouping(mode.key))}
                className={item}
              >
                <span className="w-3">{mode.key === grouping && <Check size={12} />}</span>
                {mode.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const foldButton =
  'shrink-0 p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed';

/**
 * Filter row toggles: collapse / expand all groups (projects) and all agent cards. Each button
 * names the action it does next.
 */
export const FoldButtons: React.FC<{
  /** Every shown group is collapsed: the groups button expands */
  groupsCollapsed: boolean;
  onGroups: (collapse: boolean) => void;
  /** A quick filter forces every group open: folding would have no visible effect */
  groupsDisabled?: boolean;
  /** Some shown card has its details open: the cards button collapses */
  cardsExpanded: boolean;
  onCards: (expand: boolean) => void;
  cardsDisabled?: boolean;
}> = ({ groupsCollapsed, onGroups, groupsDisabled, cardsExpanded, onCards, cardsDisabled }) => {
  const groupsLabel = groupsCollapsed ? 'Expand all groups' : 'Collapse all groups';
  const cardsLabel = cardsExpanded ? 'Collapse all agent cards' : 'Expand all agent cards';
  return (
    <>
      <button
        type="button"
        onClick={() => onGroups(!groupsCollapsed)}
        disabled={groupsDisabled}
        title={groupsDisabled ? 'Clear the filters to fold groups' : groupsLabel}
        aria-label={groupsLabel}
        className={foldButton}
      >
        {groupsCollapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
      </button>
      <button
        type="button"
        onClick={() => onCards(!cardsExpanded)}
        disabled={cardsDisabled}
        title={cardsLabel}
        aria-label={cardsLabel}
        className={foldButton}
      >
        {cardsExpanded ? <ListChevronsDownUp size={13} /> : <ListChevronsUpDown size={13} />}
      </button>
    </>
  );
};

/** Collapsible list of Orkumo apps for the status grouping (favorites first) */
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
