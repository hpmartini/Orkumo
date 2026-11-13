import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ExternalLink, MessageSquare } from 'lucide-react';
import {
  openTranscriptView,
  sendToPane,
  startQuickAgent,
  stopPane,
  subscribeToChat,
} from '../services/agentsApi';
import { initialChatState, reduceChat, type ChatState } from '../utils/chatEvents';
import { ChatMarkdown } from './AgentsView/Chat/ChatMarkdown';

type Action = { type: 'reset' } | { type: 'event'; event: unknown };
const reducer = (state: ChatState, action: Action): ChatState =>
  action.type === 'reset' ? initialChatState : reduceChat(state, action.event);

/**
 * Quick window (#251): the whole content of the small always-on-top Electron window a
 * system-wide shortcut toggles. Enter starts the default harness as an agent pane of its own
 * (`POST /api/agents/quick`) and shows its transcript here (the window grows); follow-ups are
 * typed into its terminal. "Open in Orkumo" (Cmd+Enter) opens that pane in the main window, the
 * same process. Hiding the window (Escape, shortcut, click-away while small) ends an agent that
 * was not handed over.
 */
export const QuickWindow: React.FC = () => {
  const [text, setText] = useState('');
  // Transcript view of the quick agent; the pane id names the agent itself
  const [chatId, setChatId] = useState<string | null>(null);
  const [state, dispatch] = useReducer(reducer, initialChatState);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<string | null>(null);
  // Bumped by every reset: a start still in flight then knows it is no longer wanted
  const generation = useRef(0);

  /** Back to the small, empty prompt; `keepAgent` when the main window took the agent over */
  const reset = useCallback((keepAgent = false) => {
    generation.current += 1;
    const paneId = paneRef.current;
    if (paneId && !keepAgent) void stopPane(paneId).catch(() => {});
    paneRef.current = null;
    setChatId(null);
    setText('');
    setSending(false);
    dispatch({ type: 'reset' });
    window.electronAPI?.quickExpand?.(false);
  }, []);

  const send = async (prompt: string) => {
    const gen = generation.current;
    setSending(true);
    try {
      const paneId = paneRef.current;
      if (paneId) {
        setText('');
        await sendToPane(paneId, prompt);
        return;
      }
      const agent = await startQuickAgent(prompt);
      // Hidden or handed over while starting: nobody would see this agent
      if (gen !== generation.current) {
        void stopPane(agent.paneId).catch(() => {});
        return;
      }
      paneRef.current = agent.paneId;
      setText('');
      const view = await openTranscriptView(agent.paneId, { ...agent, name: 'Quick chat' });
      if (gen !== generation.current) return;
      setChatId(view.id);
      window.electronAPI?.quickExpand?.(true);
    } catch {
      if (gen !== generation.current) return;
      // No agent here (server, harness): the main window's composer takes the prompt as before
      if (!paneRef.current) window.electronAPI?.quickSubmit(prompt);
      else setText(prompt);
    } finally {
      if (gen === generation.current) setSending(false);
    }
  };

  const openInOrkumo = (prompt: string) => {
    const paneId = paneRef.current;
    reset(Boolean(paneId));
    if (paneId) window.electronAPI?.quickOpenChat?.(paneId);
    else if (prompt.trim()) window.electronAPI?.quickSubmit(prompt);
  };

  // The window is hidden, not closed: on hide (Escape, shortcut, click-away) the chat ends,
  // on show the field is focused. Keys work wherever the focus is (also after a click in the answer).
  const keys = useRef({ text, openInOrkumo });
  keys.current = { text, openInOrkumo };
  useEffect(() => {
    const onFocus = () => {
      if (!paneRef.current) setText('');
      inputRef.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        reset();
        window.electronAPI?.quickHide();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        keys.current.openInOrkumo(keys.current.text);
      }
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('keydown', onKey);
    const offHidden = window.electronAPI?.onQuickHidden?.(() => reset());
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('keydown', onKey);
      offHidden?.();
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

  // The transcript has no busy flag: a prompt without an answer after it is still running
  const waiting = sending || state.messages.at(-1)?.kind === 'user';

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
            onClick={() => openInOrkumo(text)}
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
          {waiting && (
            <p className="text-xs text-gray-500">
              … (wartet es auf eine Freigabe: „In Orkumo öffnen“, um sie zu beantworten)
            </p>
          )}
        </div>
      )}
    </div>
  );
};
