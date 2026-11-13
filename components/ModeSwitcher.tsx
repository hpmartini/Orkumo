import React from 'react';
import { MessagesSquare, Kanban, CircleDot, GitPullRequest, Code2, History } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ModeEntry } from '../hooks/useModules';
import { moduleIcon } from './moduleIcon';

/** Host modes; modes of loaded modules (e.g. Workflows, #165) sit between Agents and Board */
export const MODES = [
  { path: '/agents', label: 'Agents', icon: MessagesSquare },
  { path: '/board', label: 'Board', icon: Kanban },
  { path: '/issues', label: 'Issues', icon: CircleDot },
  { path: '/pulls', label: 'Pull Requests', icon: GitPullRequest },
  { path: '/code', label: 'Code', icon: Code2 },
  { path: '/chats', label: 'Chats', icon: History },
] as const;

/**
 * Work modes of the active context (#184) as a vertical activity bar column, like VS Code:
 * icons only, the label is the tooltip. The route is the state, one click switches.
 */
export const ModeSwitcher: React.FC<{ modes?: ModeEntry[] }> = ({ modes = [] }) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [agents, ...host] = MODES;
  const all = [
    agents,
    ...modes.map((m) => ({ path: `/${m.id}`, label: m.label, icon: moduleIcon(m.icon) })),
    ...host,
  ];
  return (
    <div role="group" aria-label="Mode" className="flex flex-col items-stretch w-full">
      {all.map(({ path, label, icon: Icon }) => {
        const active = pathname === path;
        return (
          <button
            key={path}
            // #191 AC-1: Pull Requests is an overlay mode, a second click returns to the agents
            onClick={() => (active ? path === '/pulls' && navigate('/agents') : navigate(path))}
            aria-pressed={active}
            aria-label={label}
            title={label}
            className={`relative flex items-center justify-center h-11 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cursor ${
              active ? 'text-white' : 'text-gray-500 hover:text-gray-200'
            }`}
          >
            {active && (
              <span aria-hidden className="absolute left-0 inset-y-1.5 w-0.5 rounded-r bg-white" />
            )}
            <Icon size={20} strokeWidth={1.75} aria-hidden />
          </button>
        );
      })}
    </div>
  );
};
