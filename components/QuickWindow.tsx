import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ExternalLink, MessageSquare } from 'lucide-react';
import {
  fetchAgentRepos,
  fetchAgentViewSettings,
  sendChatMessage,
  startChat,
  stopChat,
  subscribeToChat,
} from '../services/agentsApi';
import { initialChatState, reduceChat, type ChatState } from '../utils/chatEvents';
import { ChatMarkdown } from './AgentsView/Chat/ChatMarkdown';

type Action = { type: 'reset' } | { type: 'event'; event: unknown };
const reducer = (state: ChatState, action: Action): ChatState =>
  action.type === 'reset' ? initialChatState : reduceChat(state, action.event);

/** Starts a chat the way the composer does: default harness, Claude Code's dispatch defaults, ~ */
async function startQuickChat(): Promise<string> {
  const [settings, repos] = await Promise.all([
    fetchAgentViewSettings(),
    fetchAgentRepos().catch(() => null),
  ]);
  const { harness, model, permissionMode, skipPermissions } = settings.dispatch;
  const cwd = repos?.home || repos?.cwd;
  if (!cwd) throw new Error('No working directory');
  const chat = await startChat({
    harness,
    cwd,
    ...(harness === 'claude' && {
      model,
      permissionMode,
      skipPermissions: skipPermissions || undefined,
    }),
    name: 'Quick chat',
  });
  return chat.id;
}

/**
 * Quick window (#251): the whole content of the small always-on-top Electron window a
 * system-wide shortcut toggles. Enter starts a chat and shows the answer here (the window grows);
 * follow-ups continue it. "Open in Orkumo" (Cmd+Enter) hands the chat to the main window.
 * Hiding the window (Escape, shortcut) ends a chat that was not handed over.
 */
export const QuickWindow: React.FC = () => {
  const [text, setText] = useState('');
  const [chatId, setChatId] = useState<string | null>(null);
  const [state, dispatch] = useReducer(reducer, initialChatState);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<string | null>(null);

  /** Back to the small, empty prompt; `keepChat` when the main window took the chat over */
  const reset = useCallback((keepChat = false) => {
    const id = chatRef.current;
    if (id && !keepChat) void stopChat(id).catch(() => {});
    chatRef.current = null;
    setChatId(null);
    setText('');
    setSending(false);
    dispatch({ type: 'reset' });
    window.electronAPI?.quickExpand?.(false);
  }, []);

  // The window is hidden, not closed: on hide the chat ends, on show the field is focused
  useEffect(() => {
    const onFocus = () => {
      if (!chatRef.current) setText('');
      inputRef.current?.focus();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && chatRef.current) reset();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reset]);

  // Every (re)connect replays the whole history, so it starts from an empty state
  useEffect(
    () =>
      chatId
        ? subscribeToChat(chatId, {
            onOpen: () => dispatch({ type: 'reset' }),
            onEvent: (event) => dispatch({ type: 'event', event }),
            onGone: () => {},
          })
        : undefined,
    [chatId]
  );

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [state.messages]);

  const send = async (prompt: string) => {
    setSending(true);
    try {
      let id = chatRef.current;
      if (!id) {
        id = await startQuickChat();
        chatRef.current = id;
        setChatId(id);
        window.electronAPI?.quickExpand?.(true);
      }
      setText('');
      await sendChatMessage(id, prompt);
    } catch {
      // No chat here (server, harness): the main window's composer takes the prompt as before
      if (!chatRef.current) window.electronAPI?.quickSubmit(prompt);
      else setText(prompt);
    } finally {
      setSending(false);
    }
  };

  const openInOrkumo = () => {
    const id = chatRef.current;
    if (!id) {
      if (text.trim()) window.electronAPI?.quickSubmit(text);
      return;
    }
    reset(true);
    window.electronAPI?.quickOpenChat?.(id);
  };

  const waitsForPermission = state.messages.some(
    (m) => m.kind === 'permission' && m.decision === null
  );

  return (
    <div className="h-screen flex flex-col bg-gray-900 border border-gray-700">
      <form
        className="h-16 shrink-0 flex items-center gap-3 px-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && !sending) void send(text);
        }}
      >
        <MessageSquare size={18} className="text-blue-400 shrink-0" aria-hidden />
        <input
          ref={inputRef}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              reset();
              window.electronAPI?.quickHide();
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              openInOrkumo();
            }
          }}
          aria-label="Quick prompt"
          placeholder={
            chatId
              ? 'Folgefrage … (Cmd+Enter öffnet den Chat in Orkumo)'
              : 'Frag etwas … (Enter antwortet hier, Cmd+Enter in Orkumo, Esc schließt)'
          }
          className="flex-1 bg-transparent text-base text-gray-100 placeholder:text-gray-500 focus:outline-none"
        />
        {chatId && (
          <button
            type="button"
            onClick={openInOrkumo}
            className="shrink-0 flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800"
          >
            <ExternalLink size={12} aria-hidden /> In Orkumo öffnen
          </button>
        )}
      </form>
      {chatId && (
        <div
          ref={listRef}
          className="flex-1 min-h-0 overflow-auto border-t border-gray-800 px-4 py-3 space-y-3"
          aria-label="Answer"
          aria-live="polite"
        >
          {state.messages.map((m) => {
            if (m.kind === 'user')
              return (
                <p key={m.key} className="text-sm text-gray-400 whitespace-pre-wrap">
                  {m.text}
                </p>
              );
            if (m.kind === 'assistant')
              return m.blocks.map((b, i) =>
                b.type === 'text' ? <ChatMarkdown key={`${m.key}-${i}`} text={b.text} /> : null
              );
            if (m.kind === 'notice' || (m.kind === 'result' && !m.ok))
              return (
                <p key={m.key} className="text-xs text-red-300">
                  {m.kind === 'notice' ? m.text : `Turn failed (${m.subtype})`}
                </p>
              );
            return null;
          })}
          {(sending || state.busy) && !waitsForPermission && (
            <p className="text-xs text-gray-500">…</p>
          )}
          {waitsForPermission && (
            <p className="text-xs text-amber-300">
              Wartet auf eine Freigabe: „In Orkumo öffnen“, um sie zu beantworten.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
