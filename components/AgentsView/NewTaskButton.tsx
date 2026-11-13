import React, { useState } from 'react';
import { Bot, ChevronDown, CircleDot, MessageSquare, Plus } from 'lucide-react';
import { usePopover } from './PullRequestsPanel';

export type NewKind = 'task' | 'agent' | 'chat' | 'issue';

const ENTRIES: { kind: NewKind; label: string; hint: string; icon: typeof Plus }[] = [
  { kind: 'task', label: 'New task', hint: 'N', icon: Plus },
  { kind: 'agent', label: 'New agent', hint: 'interactive, attached', icon: Bot },
  { kind: 'chat', label: 'New chat', hint: 'agent in the UI view', icon: MessageSquare },
  { kind: 'issue', label: 'New issue', hint: 'GitHub', icon: CircleDot },
];

const NewMenu: React.FC<{ onPick: (kind: NewKind) => void; onClose: () => void }> = ({
  onPick,
  onClose,
}) => {
  const ref = usePopover(onClose);
  // ↑/↓ move between the entries, as in a native menu
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? at + 1 : (at <= 0 ? items.length : at) - 1;
    items[next % items.length]?.focus();
  };
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="menu"
      aria-label="Create"
      onKeyDown={onKeyDown}
      className="absolute left-0 top-full mt-1 z-40 min-w-[240px] bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 outline-none"
    >
      {ENTRIES.map(({ kind, label, hint, icon: Icon }) => (
        <button
          key={kind}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            onPick(kind);
          }}
          className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700 hover:text-white focus-visible:bg-gray-700 focus-visible:outline-none"
        >
          <Icon size={13} aria-hidden className="shrink-0 text-gray-400" />
          <span className="flex-1 whitespace-nowrap">{label}</span>
          <span className="text-[11px] text-gray-500 whitespace-nowrap">{hint}</span>
        </button>
      ))}
    </div>
  );
};

/** [New task | ⌄]: the main part starts a task, the chevron offers agent, chat and issue */
export const NewTaskButton: React.FC<{ onNew: (kind: NewKind) => void }> = ({ onNew }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex shrink-0">
      <button
        type="button"
        onClick={() => onNew('task')}
        className="flex items-center gap-1 pl-2 pr-2.5 py-0.5 rounded-l text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
        title="New task (N or Alt+N)"
      >
        <Plus size={13} aria-hidden /> New task
      </button>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-popover-trigger
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More: new agent, chat or issue"
        title="New agent, chat or issue"
        className="flex items-center px-1 py-0.5 rounded-r border-l border-blue-800 text-white bg-blue-600 hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
      >
        <ChevronDown size={13} aria-hidden />
      </button>
      {open && <NewMenu onPick={onNew} onClose={() => setOpen(false)} />}
    </div>
  );
};
