import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { parsePaletteInput, rankCommands, type PaletteCommand } from '../../utils/commandPalette';
import { useDialogA11y } from './useDialogA11y';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  getCommands: () => PaletteCommand[];
}

const HighlightedTitle: React.FC<{ title: string; indices: number[] }> = ({ title, indices }) => {
  if (indices.length === 0) return <>{title}</>;
  const hit = new Set(indices);
  return (
    <>
      {[...title].map((ch, i) =>
        hit.has(i) ? (
          <span key={i} className="text-blue-300 font-semibold underline underline-offset-2">
            {ch}
          </span>
        ) : (
          ch
        )
      )}
    </>
  );
};

/** Cmd/Ctrl+P: searchable list of every registered command, agent and project. */
export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose, getCommands }) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Snapshot per open: sources register by effect and rarely change while the palette is up
  const commands = useMemo(() => (open ? getCommands() : []), [open, getCommands]);
  const results = useMemo(() => {
    const ranked = rankCommands(commands, query);
    // Free text can always become a task: last row, so command matches keep priority
    const { mode, query: text } = parsePaletteInput(query);
    const task = commands.find((c) => c.runWithText);
    if (mode !== 'all' || !text || !task) return ranked;
    const row: PaletteCommand = {
      ...task,
      id: `${task.id}.text`,
      title: `New task: ${text}`,
      shortcut: undefined,
      run: () => task.runWithText?.(text),
    };
    return [...ranked, { command: row, indices: [] }];
  }, [commands, query]);
  const active = Math.min(activeIndex, Math.max(0, results.length - 1));

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    document.getElementById(`command-palette-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, results]);

  const trapTab = useDialogA11y(open, dialogRef, () => inputRef.current);

  if (!open) return null;

  const runAt = (index: number) => {
    const entry = results[index];
    if (!entry) return;
    onClose();
    // After close so focus is restored first and a command that opens a dialog can take it over
    setTimeout(entry.command.run, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    trapTab(e);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((active + step + results.length) % results.length);
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      runAt(active);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-gray-950/70 flex items-start justify-center px-4 pt-[12vh]"
      onMouseDown={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[640px] bg-gray-800 border border-gray-600 rounded-xl shadow-2xl flex flex-col max-h-[70vh]"
      >
        <div className="flex items-center gap-2 px-3 border-b border-gray-700">
          <Search size={15} className="text-gray-400 shrink-0" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="command-palette-list"
            aria-autocomplete="list"
            aria-activedescendant={results.length ? `command-palette-opt-${active}` : undefined}
            aria-label="Search commands"
            placeholder="Search commands  ·  > commands  ·  @ agents  ·  # projects"
            className="flex-1 bg-transparent py-3 text-sm text-gray-50 placeholder-gray-400 outline-none"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <ul
          id="command-palette-list"
          role="listbox"
          aria-label="Commands"
          className="overflow-y-auto py-1 min-h-0"
        >
          {results.map(({ command, indices }, i) => (
            <li
              key={command.id}
              id={`command-palette-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseMove={() => i !== active && setActiveIndex(i)}
              onClick={() => runAt(i)}
              className={`mx-1 px-3 py-2 rounded-md flex items-center gap-3 text-sm cursor-pointer ${
                i === active ? 'bg-blue-500/30 text-white' : 'text-gray-100'
              }`}
            >
              <span className="truncate">
                <HighlightedTitle title={command.title} indices={indices} />
              </span>
              <span className="ml-auto flex items-center gap-2 shrink-0">
                <span className={`text-xs ${i === active ? 'text-gray-50' : 'text-gray-300'}`}>
                  {command.group}
                </span>
                {command.shortcut && (
                  <kbd className="px-1.5 py-0.5 rounded bg-gray-700 text-[11px] font-mono text-gray-100">
                    {command.shortcut}
                  </kbd>
                )}
              </span>
            </li>
          ))}
        </ul>
        {results.length === 0 && <div className="px-4 py-6 text-sm text-gray-300">No matches</div>}
        <div className="px-3 py-2 border-t border-gray-700 text-[11px] text-gray-300 flex gap-4">
          <span>↑↓ navigate</span>
          <span>Enter run</span>
          <span>Esc close</span>
        </div>
        <div className="sr-only" role="status" aria-live="polite">
          {results.length === 0 ? 'No matches' : `${results.length} results`}
        </div>
      </div>
    </div>
  );
};
