import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isSubmitKey, type ChatCommand, type ChatSubmitKey } from '../../../utils/chatEvents';
import {
  browseHistory,
  chatSuggestions,
  continueList,
  historyStep,
  homeKey,
  indentList,
  suggestionQuery,
  type ChatSuggestion,
  type Edit,
} from '../../../utils/chatComposer';
import { fetchChatFiles } from '../../../services/agentsApi';

const MAX_HEIGHT = 320;
const KIND_LABEL: Record<ChatSuggestion['kind'], string> = {
  command: 'command',
  agent: 'agent',
  file: 'file',
};

interface ChatComposerProps {
  chatId: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  disabled: boolean;
  submitKey: ChatSubmitKey;
  /** Sent user messages, oldest first (Arrow up walks them from the newest) */
  history: string[];
  commands: ChatCommand[];
  agents: { name: string; description: string }[];
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

/** Chat input: grows with its content, TUI-like keys, `/` and `@` picker with details */
export const ChatComposer: React.FC<ChatComposerProps> = ({
  chatId,
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  disabled,
  submitKey,
  history,
  commands,
  agents,
  inputRef,
}) => {
  const [caret, setCaret] = useState(0);
  const pendingCaret = useRef<number | null>(null);
  const historyIndex = useRef(-1);
  const draft = useRef('');
  const [files, setFiles] = useState<string[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const listRef = useRef<React.ElementRef<'ul'>>(null);

  // Height follows the wrapped content, so no line is ever clipped
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
    if (pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      setCaret(pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value, inputRef]);

  const query = suggestionQuery(value, caret);
  const queryKey = query ? `${query.trigger}${query.start}:${query.query}` : null;
  const fileQuery = query?.trigger === '@' ? query.query : null;

  useEffect(() => {
    if (fileQuery === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchChatFiles(chatId, fileQuery)
        .then((list) => !cancelled && setFiles(list))
        .catch(() => !cancelled && setFiles([]));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [chatId, fileQuery]);

  const suggestions = useMemo(
    () => (query ? chatSuggestions(query.trigger, query.query, { commands, agents, files }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queryKey covers query
    [queryKey, commands, agents, files]
  );
  const open = suggestions.length > 0 && dismissed !== queryKey;
  const current = open ? suggestions[Math.min(highlighted, suggestions.length - 1)] : null;

  useEffect(() => setHighlighted(0), [queryKey]);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${highlighted}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  const apply = (edit: Edit) => {
    pendingCaret.current = edit.caret;
    onChange(edit.value);
  };

  const pick = (s: ChatSuggestion) => {
    if (!query) return;
    const before = value.slice(0, query.start);
    const after = value.slice(caret).replace(/^\S*/, '');
    apply({
      value: before + s.insert + after.replace(/^ /, ''),
      caret: before.length + s.insert.length,
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const pos = el.selectionStart;
    const collapsed = pos === el.selectionEnd;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;

    if (open && current) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setHighlighted((h) => (h + step + suggestions.length) % suggestions.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey && plain) || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        pick(current);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(queryKey);
        return;
      }
    }
    if (e.key === 'Escape' && busy) {
      e.preventDefault();
      onStop();
      return;
    }
    if (isSubmitKey(e.nativeEvent, submitKey)) {
      e.preventDefault();
      historyIndex.current = -1;
      onSubmit();
      return;
    }
    const newline =
      e.key === 'Enter' &&
      !e.nativeEvent.isComposing &&
      (submitKey === 'enter' ? e.shiftKey : plain && !e.shiftKey);
    if (newline && collapsed) {
      const edit = continueList(value, pos);
      if (edit) {
        e.preventDefault();
        apply(edit);
      }
      return;
    }
    if (e.key === 'Tab' && plain && collapsed) {
      const edit = indentList(value, pos, e.shiftKey);
      if (edit) {
        e.preventDefault();
        apply(edit);
      }
      return;
    }
    if (e.key === 'Home' && plain && !e.shiftKey && collapsed) {
      const target = homeKey(value, pos);
      e.preventDefault();
      if (target !== null) {
        el.setSelectionRange(target, target);
        setCaret(target);
      }
      return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && plain && !e.shiftKey && collapsed) {
      const direction = e.key === 'ArrowUp' ? 'up' : 'down';
      if (!historyStep(value, pos, direction)) return;
      if (historyIndex.current === -1) draft.current = value;
      const step = browseHistory(history, historyIndex.current, draft.current, direction);
      if (!step) return;
      e.preventDefault();
      historyIndex.current = step.index;
      apply({ value: step.text, caret: direction === 'up' ? 0 : step.text.length });
    }
  };

  const listId = `chat-suggestions-${chatId}`;

  return (
    <div className="relative flex-1 min-w-0">
      {open && current && (
        <div className="absolute bottom-full left-0 right-0 mb-1 flex max-h-72 overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-xl z-30">
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={query?.trigger === '/' ? 'Commands' : 'Files and agents'}
            className="w-1/2 min-w-0 overflow-y-auto py-1"
          >
            {suggestions.map((s, i) => (
              <li
                key={`${s.kind}:${s.label}`}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={s === current}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                onMouseEnter={() => setHighlighted(i)}
                className={`flex items-center gap-2 px-2.5 py-1 text-sm cursor-pointer ${
                  s === current ? 'bg-blue-500/25 text-white' : 'text-gray-200'
                }`}
              >
                <span className="font-mono text-blue-300 truncate min-w-0">{s.label}</span>
                <span className="ml-auto shrink-0 text-[10px] text-gray-500">
                  {KIND_LABEL[s.kind]}
                </span>
              </li>
            ))}
          </ul>
          <div
            className="w-1/2 min-w-0 overflow-y-auto border-l border-gray-800 p-3 text-xs"
            aria-live="polite"
          >
            <div className="font-mono text-sm text-blue-200 break-all">{current.label}</div>
            {current.hint && (
              <div className="mt-1.5 text-gray-400">
                <span className="text-gray-500">Arguments: </span>
                <span className="font-mono text-gray-200">{current.hint}</span>
              </div>
            )}
            {current.kind !== 'file' && (
              <p className="mt-2 text-gray-300 whitespace-pre-wrap leading-relaxed">
                {current.description || 'No description'}
              </p>
            )}
            <p className="mt-3 text-[11px] text-gray-500">
              ↑↓ choose · Enter/Tab insert · Esc close
            </p>
          </div>
        </div>
      )}
      <textarea
        id={`chat-input-${chatId}`}
        ref={inputRef}
        value={value}
        disabled={disabled}
        rows={1}
        onChange={(e) => {
          historyIndex.current = -1;
          setDismissed(null);
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        onBlur={() => setDismissed(queryKey)}
        placeholder={
          disabled
            ? 'Session ended'
            : submitKey === 'enter'
              ? 'Message · Enter sends · / commands · @ files'
              : 'Message · Cmd/Ctrl+Enter sends · / commands · @ files'
        }
        aria-label="Message"
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${highlighted}` : undefined}
        style={{ maxHeight: MAX_HEIGHT }}
        className="block w-full resize-none rounded-md bg-gray-900 border border-gray-700 px-2.5 py-2 text-sm leading-6 text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-blue-400 disabled:opacity-50"
      />
    </div>
  );
};
