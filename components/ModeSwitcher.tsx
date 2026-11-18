import React, { useEffect, useState } from 'react';
import { MessagesSquare, Kanban, CircleDot, GitPullRequest, Code2, History } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ModeEntry } from '../hooks/useModules';
import { moduleIcon } from './moduleIcon';
import { reorderIndices, stepIndices } from '@hpmartini/agents-ui/utils/agentWorkspace';

/** Host modes; modes of loaded modules (e.g. Workflows, #165) sit between Agents and Board */
export const MODES = [
  { path: '/agents', label: 'Agents', icon: MessagesSquare },
  { path: '/board', label: 'Board', icon: Kanban },
  { path: '/issues', label: 'Issues', icon: CircleDot },
  { path: '/pulls', label: 'Pull Requests', icon: GitPullRequest },
  { path: '/code', label: 'Code', icon: Code2 },
  { path: '/chats', label: 'Chats', icon: History },
] as const;

/** Order of the activity bar the user dragged it into (mode paths) */
export const MODE_ORDER_KEY = 'orkumo.modeOrder';
const DRAG_MIME = 'application/x-orkumo-mode';

const loadOrder = (): string[] => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(MODE_ORDER_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
};

/**
 * Stored order first; a mode it does not name (a module loaded later, a new host mode) keeps its
 * default place, so a first render without the modules never drops their positions.
 */
export function orderModes<T extends { path: string }>(modes: T[], stored: string[]): T[] {
  const known = stored.flatMap((p) => modes.filter((m) => m.path === p));
  const out = [...known];
  modes.forEach((m, i) => {
    if (!known.includes(m)) out.splice(Math.min(i, out.length), 0, m);
  });
  return out;
}

/**
 * Work modes of the active context (#184) as a vertical activity bar column, like VS Code:
 * icons only, the label is the tooltip. The route is the state, one click switches; a click on the
 * active mode shows or hides the side panel. Drag or Alt+Arrow keys reorder the modes.
 */
export const ModeSwitcher: React.FC<{ modes?: ModeEntry[]; onToggleRail?: () => void }> = ({
  modes = [],
  onToggleRail,
}) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [order, setOrder] = useState(loadOrder);
  const [agents, ...host] = MODES;
  const all = orderModes(
    [
      agents,
      ...modes.map((m) => ({ path: `/${m.id}`, label: m.label, icon: moduleIcon(m.icon) })),
      ...host,
    ],
    order
  );
  const paths = all.map((m) => m.path);
  const move = (span: { from: number; to: number } | null) => {
    if (!span) return;
    const next = [...paths];
    next.splice(span.to, 0, ...next.splice(span.from, 1));
    setOrder(next);
    try {
      localStorage.setItem(MODE_ORDER_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable: the order holds until reload
    }
  };
  const go = (path: string, active: boolean) => {
    // #191 AC-1: Pull Requests is an overlay mode, a second click returns to the agents
    if (!active) navigate(path);
    else if (path === '/pulls') navigate('/agents');
    else onToggleRail?.();
  };
  // Ctrl+1 … Ctrl+9 switch modes in list order; capture phase so a focused terminal doesn't eat it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const n = /^Digit([1-9])$/.exec(e.code)?.[1];
      const mode = n && all[Number(n) - 1];
      if (!mode) return;
      e.preventDefault();
      e.stopPropagation();
      // a shortcut only switches; the panel toggles by click
      if (pathname !== mode.path) navigate(mode.path);
      else if (mode.path === '/pulls') navigate('/agents');
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
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_MIME, path);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              const from = e.dataTransfer.getData(DRAG_MIME);
              if (!from) return;
              e.preventDefault();
              const box = e.currentTarget.getBoundingClientRect();
              const after = e.clientY > box.top + box.height / 2;
              move(reorderIndices(paths, from, path, after ? 'after' : 'before'));
            }}
            onKeyDown={(e) => {
              if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
              e.preventDefault();
              move(stepIndices(paths, path, e.key === 'ArrowUp' ? -1 : 1));
            }}
            onClick={() => go(path, active)}
            aria-pressed={active}
            aria-label={label}
            aria-keyshortcuts={key}
            title={`${label}${key ? ` (Ctrl+${i + 1})` : ''}${active && path !== '/pulls' ? ' · click to show or hide the side panel' : ''} · drag or Alt+↑/↓ to reorder`}
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
