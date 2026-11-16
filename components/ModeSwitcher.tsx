import React, { useEffect } from 'react';
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
  const go = (path: string, active: boolean) =>
    // #191 AC-1: Pull Requests is an overlay mode, a second click returns to the agents
    active ? path === '/pulls' && navigate('/agents') : navigate(path);
  // Ctrl+1 … Ctrl+9 switch modes in list order; capture phase so a focused terminal doesn't eat it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const n = /^Digit([1-9])$/.exec(e.code)?.[1];
      const mode = n && all[Number(n) - 1];
      if (!mode) return;
      e.preventDefault();
      e.stopPropagation();
      go(mode.path, pathname === mode.path);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  });
  return (
    <div role="group" aria-label="Mode" className="flex flex-col items-stretch w-full">
      {all.map(({ path, label, icon: Icon }, i) => {
        const active = pathname === path;
        const key = i < 9 ? `Control+${i + 1}` : undefined;
        return (
          <button
            key={path}
            onClick={() => go(path, active)}
            aria-pressed={active}
            aria-label={label}
            aria-keyshortcuts={key}
            title={key ? `${label} (Ctrl+${i + 1})` : label}
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
