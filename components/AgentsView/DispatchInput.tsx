import React, { useEffect, useLayoutEffect, useMemo, useState, useCallback } from 'react';
import { Send, FolderOpen, PenSquare } from 'lucide-react';
import type { AgentSubagent, AgentRepo, AgentSlashCommand } from '../../types';
import { computeSuggestions, Suggestion } from '../../utils/agentInput';

interface DispatchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (options: { attach: boolean }) => void;
  onEscape: () => void;
  onOpenEditor: () => void;
  onPickDirectory: () => void;
  targetCwd: string | null;
  hint: string | null;
  hintTone?: 'info' | 'error' | 'success';
  disabled?: boolean;
  subagents: AgentSubagent[];
  repos: AgentRepo[];
  commands: AgentSlashCommand[];
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

const MIN_HEIGHT = 96;
const MAX_HEIGHT = 288;

/**
 * The task composer body, rendered inside TaskComposerModal.
 *
 * Enter dispatches, Shift+Enter / Ctrl+J insert a newline, Ctrl+Enter dispatches and attaches,
 * Tab applies the highlighted suggestion, Ctrl+G opens the larger editor.
 */
export const DispatchInput: React.FC<DispatchInputProps> = ({
  value,
  onChange,
  onSubmit,
  onEscape,
  onOpenEditor,
  onPickDirectory,
  targetCwd,
  hint,
  hintTone = 'info',
  disabled,
  subagents,
  repos,
  commands,
  inputRef,
}) => {
  const [caret, setCaret] = useState(0);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const suggestionState = useMemo(
    () => computeSuggestions(value, caret, { subagents, repos, commands }),
    [value, caret, subagents, repos, commands]
  );
  const suggestions = suggestionState.suggestions;
  const showSuggestions = suggestionsOpen && suggestions.length > 0;

  // Grow with the content; the scrollbar only exists once the maximum height is reached
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, el.scrollHeight));
    el.style.height = `${height}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [value, inputRef]);

  // Open the popover automatically when typing @ or /
  useEffect(() => {
    const before = value.slice(0, caret);
    if (/(?:^|\s)@[A-Za-z0-9_./-]*$/.test(before) || /^\/\S*$/.test(before)) {
      setSuggestionsOpen(true);
    } else if (value.trim()) {
      setSuggestionsOpen(false);
    }
    setHighlighted(0);
  }, [value, caret]);

  const applySuggestion = useCallback(
    (suggestion: Suggestion) => {
      const next =
        value.slice(0, suggestionState.replaceStart) +
        suggestion.insert +
        value.slice(suggestionState.replaceEnd);
      onChange(next);
      setSuggestionsOpen(false);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          const pos = suggestionState.replaceStart + suggestion.insert.length;
          el.focus();
          el.setSelectionRange(pos, pos);
          setCaret(pos);
        }
      });
    },
    [value, suggestionState, onChange, inputRef]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      // Tab only completes while there is something to complete; otherwise it moves focus on
      if (showSuggestions) {
        e.preventDefault();
        applySuggestion(suggestions[highlighted]);
      } else if (suggestions.length > 0) {
        e.preventDefault();
        setSuggestionsOpen(true);
      }
      return;
    }
    if (showSuggestions && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setHighlighted((h) =>
        e.key === 'ArrowDown'
          ? (h + 1) % suggestions.length
          : (h - 1 + suggestions.length) % suggestions.length
      );
      return;
    }
    if (e.key === 'Enter') {
      if (e.shiftKey) return; // newline
      e.preventDefault();
      if (showSuggestions && suggestions[highlighted]?.type !== 'command') {
        applySuggestion(suggestions[highlighted]);
        return;
      }
      onSubmit({ attach: e.ctrlKey || e.metaKey });
      return;
    }
    if (e.key === 'j' && e.ctrlKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      onChange(`${value.slice(0, start)}\n${value.slice(end)}`);
      requestAnimationFrame(() => {
        el.setSelectionRange(start + 1, start + 1);
        setCaret(start + 1);
      });
      return;
    }
    if (e.key === 'g' && e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      onOpenEditor();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (showSuggestions) setSuggestionsOpen(false);
      else onEscape();
    }
  };

  const listId = 'task-composer-suggestions';

  return (
    <div className="relative">
      {showSuggestions && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Suggestions"
          className="absolute top-full left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-30"
        >
          {suggestions.map((s, index) => (
            <li
              key={`${s.type}-${s.label}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === highlighted}
              onMouseDown={(e) => {
                e.preventDefault();
                applySuggestion(s);
              }}
              className={`px-3 py-1.5 text-sm flex items-center gap-3 cursor-pointer ${
                index === highlighted ? 'bg-blue-500/30 text-white' : 'text-gray-100'
              }`}
            >
              <span className="font-mono text-blue-300">{s.label}</span>
              <span className="text-xs text-gray-300 truncate">{s.description}</span>
              <span className="ml-auto text-[10px] text-gray-300">{s.type}</span>
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={inputRef}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
        }}
        onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
        onKeyDown={handleKeyDown}
        onBlur={() => setSuggestionsOpen(false)}
        placeholder="Describe the task for a new session"
        aria-label="Task description"
        aria-autocomplete="list"
        aria-controls={showSuggestions ? listId : undefined}
        aria-activedescendant={showSuggestions ? `${listId}-${highlighted}` : undefined}
        style={{ minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT, overflowY: 'hidden' }}
        className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-50 placeholder-gray-400 resize-none outline-none font-mono leading-6 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/40"
        spellCheck={false}
      />
      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          onClick={onPickDirectory}
          className="flex items-center gap-1.5 min-w-0 px-2 py-1.5 rounded-md text-xs text-gray-200 hover:bg-gray-700 focus-visible:outline-2 focus-visible:outline-blue-400"
          title="Directory the new session starts in (mention @repo to override)"
        >
          <FolderOpen size={13} aria-hidden />
          <span className="truncate max-w-[280px] font-mono">
            {targetCwd || 'Pick a directory'}
          </span>
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onOpenEditor}
          className="p-1.5 rounded-md text-gray-200 hover:bg-gray-700 focus-visible:outline-2 focus-visible:outline-blue-400"
          title="Edit in a larger editor (Ctrl+G)"
          aria-label="Edit in a larger editor"
        >
          <PenSquare size={15} />
        </button>
        <button
          type="button"
          onClick={() => onSubmit({ attach: true })}
          disabled={disabled}
          className="px-3 py-1.5 rounded-md text-sm text-gray-100 bg-gray-700 hover:bg-gray-600 focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50"
          title="Dispatch and open the session (Ctrl+Enter)"
        >
          Dispatch and attach
        </button>
        <button
          type="button"
          onClick={() => onSubmit({ attach: false })}
          disabled={disabled}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50"
          title="Dispatch (Enter)"
        >
          <Send size={13} aria-hidden /> Dispatch
        </button>
      </div>
      <div className="mt-2 min-h-[1.25rem] text-xs" role="status" aria-live="polite">
        {hint ? (
          <span
            className={
              hintTone === 'error'
                ? 'text-red-300'
                : hintTone === 'success'
                  ? 'text-emerald-300'
                  : 'text-gray-200'
            }
          >
            {hint}
          </span>
        ) : (
          <span className="text-gray-300">
            @agent · @repo · /command · ! shell command · Shift+Enter for a new line
          </span>
        )}
      </div>
    </div>
  );
};
