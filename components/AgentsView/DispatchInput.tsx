import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Send, FolderOpen, PenSquare } from 'lucide-react';
import type { AgentSubagent, AgentRepo, AgentSlashCommand } from '../../types';
import { computeSuggestions, Suggestion } from '../../utils/agentInput';

interface DispatchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (options: { attach: boolean }) => void;
  onNavigate: (direction: 'up' | 'down') => void;
  onEscape: () => void;
  onSpace?: () => boolean;
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

/**
 * The dispatch input at the bottom of the agent view.
 *
 * Enter dispatches, Shift+Enter / Ctrl+J insert a newline, Ctrl+Enter dispatches and attaches,
 * Tab browses subagents (empty input) or applies the highlighted suggestion.
 */
export const DispatchInput: React.FC<DispatchInputProps> = ({
  value,
  onChange,
  onSubmit,
  onNavigate,
  onEscape,
  onSpace,
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
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (showSuggestions) {
        applySuggestion(suggestions[highlighted]);
      } else if (suggestions.length > 0) {
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
      if (e.shiftKey) {
        // Shift+Enter inserts a newline - default behaviour
        return;
      }
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
      const next = `${value.slice(0, start)}\n${value.slice(end)}`;
      onChange(next);
      requestAnimationFrame(() => {
        el.setSelectionRange(start + 1, start + 1);
        setCaret(start + 1);
      });
      return;
    }
    if (e.key === 'Escape') {
      if (showSuggestions) {
        e.preventDefault();
        setSuggestionsOpen(false);
        return;
      }
      onEscape();
      return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey) {
      // Single-line input: arrows move the list selection
      if (!value.includes('\n')) {
        e.preventDefault();
        onNavigate(e.key === 'ArrowUp' ? 'up' : 'down');
      }
      return;
    }
    if (e.key === ' ' && !value && onSpace) {
      if (onSpace()) e.preventDefault();
      return;
    }
    if (e.key === '?' && !value) {
      // Let the global handler show the shortcuts overlay
      return;
    }
  };

  return (
    <div className="relative border-t border-gray-800 bg-gray-900 shrink-0">
      {showSuggestions && (
        <div className="absolute bottom-full left-0 right-0 mb-1 mx-2 max-h-64 overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-30">
          {suggestions.map((s, index) => (
            <button
              key={`${s.type}-${s.label}`}
              onMouseDown={(e) => {
                e.preventDefault();
                applySuggestion(s);
              }}
              className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-3 ${
                index === highlighted
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-300 hover:bg-gray-700/60'
              }`}
            >
              <span className="font-mono text-blue-300">{s.label}</span>
              <span className="text-xs text-gray-500 truncate">{s.description}</span>
              <span className="ml-auto text-[10px] uppercase text-gray-600">{s.type}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 px-3 py-2">
        <span className="text-blue-400 font-mono pb-2">❯</span>
        <textarea
          ref={inputRef}
          value={value}
          disabled={disabled}
          rows={Math.min(6, Math.max(1, value.split('\n').length))}
          onChange={(e) => {
            onChange(e.target.value);
            setCaret(e.target.selectionStart);
          }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
          onKeyDown={handleKeyDown}
          onBlur={() => setSuggestionsOpen(false)}
          placeholder="describe a task for a new session  ·  @agent @repo /command  ·  ! shell command"
          className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-600 resize-none outline-none font-mono leading-6 py-1"
          aria-label="Dispatch input"
          spellCheck={false}
        />
        <button
          onClick={onOpenEditor}
          className="p-1.5 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-800 shrink-0"
          title="Edit prompt in a larger editor (Ctrl+G)"
        >
          <PenSquare size={14} />
        </button>
        <button
          onClick={() => onSubmit({ attach: false })}
          disabled={disabled}
          className="p-1.5 rounded text-gray-300 hover:text-white hover:bg-blue-600/30 shrink-0 disabled:opacity-40"
          title="Dispatch (Enter) · Dispatch and attach (Ctrl+Enter)"
        >
          <Send size={14} />
        </button>
      </div>
      <div className="flex items-center gap-3 px-3 pb-2 text-[11px] text-gray-500">
        <button
          onClick={onPickDirectory}
          className="flex items-center gap-1 hover:text-gray-300 min-w-0"
          title="Directory new sessions start in (mention @repo to override)"
        >
          <FolderOpen size={11} />
          <span className="truncate max-w-[260px] font-mono">{targetCwd || 'no directory'}</span>
        </button>
        <span className="flex-1" />
        {hint ? (
          <span
            className={
              hintTone === 'error'
                ? 'text-red-400'
                : hintTone === 'success'
                  ? 'text-emerald-400'
                  : 'text-gray-400'
            }
          >
            {hint}
          </span>
        ) : (
          <span className="hidden sm:inline">
            enter to open · space to reply · ctrl+x to delete · ? for shortcuts
          </span>
        )}
      </div>
    </div>
  );
};
