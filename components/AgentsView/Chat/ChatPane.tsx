import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { ListTree, Maximize2, MessageSquare, Send, Square, SquareTerminal, X } from 'lucide-react';
import type { AgentSession } from '../../../types';
import {
  initialChatState,
  pendingPermissions,
  reduceChat,
  type ChatState,
  type ChatSubmitKey,
} from '../../../utils/chatEvents';
import { promptWithImages } from '../../../utils/composer';
import {
  answerChatPermission,
  fetchAgentLogs,
  interruptChat,
  sendChatMessage,
  subscribeToChat,
  uploadAgentImage,
} from '../../../services/agentsApi';
import { ImageAttachments, imageDropHandlers } from '../../ImageAttachments';
import { ChatMessageView } from './ChatMessages';
import { ChatComposer } from './ChatComposer';
import { ChatActivity } from './ChatActivity';
import { ChatStatusLine } from './ChatStatusLine';
import { splitAtBuiltin, splitImages } from '../../../utils/chatComposer';
import { extractNumberedChoices } from '../../../utils/agentInput';
import { renderTerminalScreen } from '../../../utils/terminalScreen';

/** Rendered screen tail of an agent that waits on a question or permission (not in its transcript) */
function useAgentPrompt(agentId: string | null): string | null {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    const load = () =>
      fetchAgentLogs(agentId, 60)
        .then((logs) => (logs.source === 'logs' ? renderTerminalScreen(logs.text) : ''))
        .then((screen) => {
          if (cancelled) return;
          // the TUI pads its screen with empty rows above the bottom rule
          const lines = screen.split('\n').filter((line) => line.trim());
          setText(lines.slice(-18).join('\n'));
        })
        .catch(() => {
          // keep the last text; the terminal still has the prompt
        });
    load();
    const timer = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      setText('');
    };
  }, [agentId]);
  return agentId ? text : null;
}

type Action = { type: 'reset' } | { type: 'event'; event: unknown };
const reducer = (state: ChatState, action: Action): ChatState =>
  action.type === 'reset' ? initialChatState : reduceChat(state, action.event);

const iconBtn =
  'p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-40 shrink-0';

// A focus or active-pane change re-labels the top bar (keys, model) and can reflow the panes
// between mousedown and mouseup, swallowing the click; header buttons act without either
const keepFocus = (e: React.MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

interface ChatPaneProps {
  session: AgentSession;
  /** Live view: the agent this chat shows (its state comes from the agent list) */
  agent?: AgentSession;
  active: boolean;
  focused: boolean;
  submitKey: ChatSubmitKey;
  /** Thinking and tool calls inline in the transcript (else only in the work panel) */
  showSteps: boolean;
  onToggleSteps: () => void;
  onFocus: () => void;
  /** Closing the pane ends the chat process */
  onClose: () => void;
  onMaximize?: () => void;
  /** Ends the chat and continues the same CLI session in a terminal tab */
  onOpenInTerminal: (sessionId: string) => void;
  headerProps?: React.HTMLAttributes<HTMLDivElement>;
}

/** Chat UI for a `claude -p` stream-json session (#189) */
export const ChatPane: React.FC<ChatPaneProps> = ({
  session,
  agent,
  active,
  focused,
  submitKey,
  showSteps,
  onToggleSteps,
  onFocus,
  onClose,
  onMaximize,
  onOpenInTerminal,
  headerProps,
}) => {
  const [state, dispatch] = useReducer(reducer, initialChatState);
  const [gone, setGone] = useState(false);
  const [text, setText] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastScrollTop = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(
    () =>
      subscribeToChat(session.id, {
        onOpen: () => {
          setGone(false);
          stickToBottom.current = true;
          dispatch({ type: 'reset' });
        },
        onEvent: (event) => dispatch({ type: 'event', event }),
        onGone: () => setGone(true),
      }),
    [session.id]
  );

  // Follow the stream unless the user scrolled up to read. Message heights settle late
  // (content-visibility, markdown, images), so every size change re-pins to the bottom.
  const pinBottom = useCallback(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
      lastScrollTop.current = el.scrollTop;
    }
  }, []);
  useLayoutEffect(pinBottom, [state.messages, showSteps, pinBottom]);
  useEffect(() => {
    const content = contentRef.current;
    const list = listRef.current;
    if (!content || !list) return;
    const observer = new ResizeObserver(pinBottom);
    observer.observe(content);
    // The list shrinks too when the status line or work panel below it appears late
    observer.observe(list);
    return () => observer.disconnect();
  }, [pinBottom]);
  // Back on a hidden tab: jump to the newest messages
  useEffect(() => {
    if (active) {
      stickToBottom.current = true;
      pinBottom();
    }
  }, [active, pinBottom]);

  const history = useMemo(
    () =>
      state.messages
        .filter((m): m is Extract<typeof m, { kind: 'user' }> => m.kind === 'user')
        .map((m) => splitImages(m.text).text)
        .filter(Boolean),
    [state.messages]
  );
  const turns = useMemo(
    () => state.messages.filter((m) => m.kind === 'result').length,
    [state.messages]
  );

  const onAnswer = useCallback(
    (requestId: string, decision: 'allow' | 'deny' | 'always') => {
      answerChatPermission(session.id, requestId, decision).catch((e: Error) =>
        setError(e.message)
      );
    },
    [session.id]
  );

  const ended = state.ended || gone;
  const live = Boolean(session.viewOf);
  // A live view has no process events of its own: busy and prompts come from the agent's state
  const prompting =
    live &&
    (agent?.displayState === 'waiting' ||
      (agent?.displayState === 'needs-input' && agent?.status === 'waiting'));
  const busy = live ? agent?.displayState === 'working' : state.busy;
  const waiting = pendingPermissions(state).length > 0 || prompting;
  const prompt = useAgentPrompt(prompting ? session.viewOf! : null);

  const choices = prompt ? extractNumberedChoices(prompt) : [];
  const answerPrompt = async (answer: string) => {
    setSending(true);
    setError(null);
    try {
      await sendChatMessage(session.id, answer);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sending failed');
    } finally {
      setSending(false);
    }
  };

  const submit = async () => {
    if (sending || ended || (!text.trim() && images.length === 0)) return;
    setSending(true);
    setError(null);
    try {
      const paths = await Promise.all(images.map(uploadAgentImage));
      const builtins = new Set(state.commands.filter((c) => c.builtin).map((c) => c.name));
      const [first, ...rest] = splitAtBuiltin(text, builtins);
      await sendChatMessage(session.id, promptWithImages(first, paths));
      for (const turn of rest) await sendChatMessage(session.id, turn);
      setText('');
      setImages([]);
      stickToBottom.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sending failed');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const stopTurn = () => interruptChat(session.id).catch((e: Error) => setError(e.message));

  const status = ended
    ? 'ended'
    : waiting
      ? 'needs permission'
      : busy
        ? 'working…'
        : live
          ? 'live view'
          : 'ready';
  const resumeId = state.sessionId ?? session.sessionId;

  return (
    <div
      className={`flex flex-col h-full min-h-0 bg-gray-950 border rounded-lg overflow-hidden ${
        focused
          ? 'border-blue-300 ring-2 ring-blue-300/70'
          : active
            ? 'border-blue-400/40'
            : 'border-gray-800'
      }`}
      onMouseDown={onFocus}
      data-agent-pane={session.id}
      {...imageDropHandlers((files) => setImages((prev) => [...prev, ...files]))}
    >
      <div
        {...headerProps}
        className={`flex flex-nowrap items-center gap-x-1.5 h-8 px-2 border-b text-xs shrink-0 bg-gray-900 border-gray-800 ${
          headerProps?.draggable ? 'cursor-grab active:cursor-grabbing' : ''
        } ${headerProps?.className ?? ''}`}
      >
        <MessageSquare size={13} aria-hidden className="text-blue-300 shrink-0" />
        <span className="font-medium text-gray-200 truncate min-w-0">{session.name}</span>
        <span className="text-gray-500 font-mono truncate min-w-0 hidden lg:inline">
          {session.cwd}
        </span>
        {state.model && (
          <span className="text-gray-500 truncate min-w-0 hidden sm:inline">{state.model}</span>
        )}
        <span
          className={`shrink-0 ${waiting ? 'text-amber-300' : busy ? 'text-blue-300' : 'text-gray-500'}`}
        >
          {status}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onToggleSteps}
          onMouseDown={keepFocus}
          className={`${iconBtn} ${showSteps ? 'text-blue-300' : ''}`}
          title={
            showSteps ? 'Hide thinking and tool calls' : 'Show thinking and tool calls in the chat'
          }
          aria-label="Show thinking and tool calls"
          aria-pressed={showSteps}
        >
          <ListTree size={13} />
        </button>
        {busy && !ended && (
          <button
            type="button"
            onClick={stopTurn}
            onMouseDown={keepFocus}
            className={iconBtn}
            title="Stop this turn (Esc)"
            aria-label="Stop this turn"
          >
            <Square size={13} />
          </button>
        )}
        <button
          type="button"
          disabled={!resumeId}
          onClick={() => resumeId && onOpenInTerminal(resumeId)}
          onMouseDown={keepFocus}
          className={iconBtn}
          title={
            live
              ? "Open the agent's terminal (the live view closes, the agent keeps running)"
              : 'Open in terminal: ends the chat and resumes the session with claude --resume'
          }
          aria-label="Open in terminal"
        >
          <SquareTerminal size={14} />
        </button>
        {onMaximize && (
          <button
            type="button"
            onClick={onMaximize}
            onMouseDown={keepFocus}
            className={iconBtn}
            title="Own tab"
            aria-label="Move chat to its own tab"
          >
            <Maximize2 size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          onMouseDown={keepFocus}
          className={iconBtn}
          title={live ? 'Close the live view (the agent keeps running)' : 'End chat and close'}
          aria-label="End chat and close"
        >
          <X size={14} />
        </button>
      </div>

      <div
        ref={listRef}
        role="log"
        aria-label={`Chat ${session.name}`}
        className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-2"
        onScroll={(e) => {
          const el = e.currentTarget;
          const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          // Only a scroll up by the user lets go; layout shifts never do
          if (nearBottom) stickToBottom.current = true;
          else if (el.scrollTop < lastScrollTop.current - 2) stickToBottom.current = false;
          lastScrollTop.current = el.scrollTop;
        }}
      >
        <div ref={contentRef}>
          {state.messages.length === 0 && !ended && (
            <div className="h-full flex items-center justify-center text-sm text-gray-500">
              Ask Claude anything. Markdown works; paste or drop images.
            </div>
          )}
          {state.messages.map((m) => (
            // content-visibility keeps long chats (hundreds of messages) cheap to scroll
            <div
              key={m.key}
              className="[content-visibility:auto] [contain-intrinsic-size:auto_60px]"
            >
              <ChatMessageView message={m} showSteps={showSteps} onAnswer={onAnswer} />
            </div>
          ))}
        </div>
      </div>

      <div className="shrink-0 border-t border-gray-800 p-2">
        {prompt !== null && (
          <div
            role="status"
            className="mb-2 rounded-md border border-amber-400/40 bg-amber-500/10 p-2"
          >
            <div className="text-xs font-medium text-amber-200">
              The agent is asking: answer below (e.g. 1, 2) or in its terminal
            </div>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-gray-200 font-mono">
              {prompt || '…'}
            </pre>
            {choices.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {choices.map((c) => (
                  <button
                    key={c.number}
                    type="button"
                    disabled={sending}
                    onClick={() => answerPrompt(String(c.number))}
                    className="rounded border border-amber-400/40 bg-gray-900 px-2 py-1 text-xs text-gray-100 hover:bg-amber-500/20 focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50"
                  >
                    {c.number}. {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <ChatActivity
          chatId={session.id}
          messages={state.messages}
          sub={state.sub}
          busy={Boolean(busy) && !ended}
        />
        {error && (
          <div role="alert" className="mb-1 text-xs text-red-300">
            {error}
          </div>
        )}
        <div className="flex items-end gap-2">
          <ChatComposer
            chatId={session.id}
            value={text}
            onChange={setText}
            onSubmit={submit}
            onStop={stopTurn}
            busy={Boolean(busy)}
            disabled={ended}
            submitKey={submitKey}
            history={history}
            commands={state.commands}
            agents={state.agents}
            inputRef={inputRef}
          />
          <button
            type="button"
            onClick={submit}
            disabled={sending || ended}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50"
            aria-label="Send message"
          >
            <Send size={13} aria-hidden />
            <span className="hidden sm:inline">Send</span>
          </button>
        </div>
        <ImageAttachments images={images} onChange={setImages} disabled={sending || ended} />
        <ChatStatusLine chatId={session.id} turns={turns} visible={active && !ended} />
      </div>
    </div>
  );
};
