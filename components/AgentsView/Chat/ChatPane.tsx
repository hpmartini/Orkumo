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
  reduceChat,
  type ChatState,
  type ChatSubmitKey,
} from '../../../utils/chatEvents';
import { promptWithImages } from '../../../utils/composer';
import { openTranscriptView, subscribeToChat, uploadAgentImage } from '../../../services/agentsApi';
import { ImageAttachments, imageDropHandlers } from '../../ImageAttachments';
import { ChatMessageView } from './ChatMessages';
import { ChatComposer } from './ChatComposer';
import { ChatActivity } from './ChatActivity';
import { ChatStatusLine } from './ChatStatusLine';
import { splitImages } from '../../../utils/chatComposer';
import { extractNumberedChoices } from '../../../utils/agentInput';
import { harnessLabel, sessionHarness } from '../../../utils/agentSessions';
import { paneScreen, pressKeys, typeIntoPane, usePaneConnected } from '../AgentTerminal';

/** How often the screen of an agent that asks something is read for its question */
const PROMPT_POLL_MS = 1000;

/** Screen tail of pane `paneId` while its agent waits on a question or permission (not in its transcript) */
function usePanePrompt(paneId: string, prompting: boolean): string | null {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!prompting) return;
    const read = () => setText(paneScreen(paneId));
    read();
    const timer = setInterval(read, PROMPT_POLL_MS);
    return () => {
      clearInterval(timer);
      setText('');
    };
  }, [paneId, prompting]);
  return prompting ? text : null;
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
  /** Terminal pane whose agent this view shows; input is typed into its PTY */
  pane: AgentSession;
  /** Listed session behind the pane (state, prompts); the pane itself for a background job */
  agent?: AgentSession;
  /** Transcript the view reads; null until the server lists the pane's session */
  sessionId: string | null;
  active: boolean;
  focused: boolean;
  submitKey: ChatSubmitKey;
  /** Thinking and tool calls inline in the transcript (else only in the work panel) */
  showSteps: boolean;
  onToggleSteps: () => void;
  onFocus: () => void;
  /** Closes the pane, exactly like closing its terminal */
  onClose: () => void;
  onMaximize?: () => void;
  /** Back to the terminal view of the same process */
  onShowTerminal: () => void;
  headerProps?: React.HTMLAttributes<HTMLDivElement>;
  /** Linked PRs, issues and running servers (same items as a terminal pane's header) */
  meta?: React.ReactNode;
}

/**
 * UI view of an agent pane (#189): renders the agent's transcript and types into the pane's
 * terminal. The terminal process is the agent; this view never starts or stops a process.
 */
export const ChatPane: React.FC<ChatPaneProps> = ({
  pane,
  agent,
  sessionId,
  active,
  focused,
  submitKey,
  showSteps,
  onToggleSteps,
  onFocus,
  onClose,
  onMaximize,
  onShowTerminal,
  headerProps,
  meta,
}) => {
  const [state, dispatch] = useReducer(reducer, initialChatState);
  const [chatId, setChatId] = useState<string | null>(null);
  // Bumped when the server forgot the view (restart, orphan timeout): opens it again
  const [generation, setGeneration] = useState(0);
  const [text, setText] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastScrollTop = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const connected = usePaneConnected(pane.id);
  const harness = sessionHarness(pane);
  const harnessName = harnessLabel(harness);

  // The server view outlives this component (split remounts, view switches): with nobody
  // watching it stops itself after the orphan timeout, so a remount never races a stop
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    openTranscriptView(pane.id, { harness, sessionId, cwd: pane.cwd, name: pane.name })
      .then((view) => !cancelled && setChatId(view.id))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      setChatId(null);
    };
    // the name only labels the view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id, pane.cwd, harness, sessionId, generation]);

  useEffect(() => {
    if (!chatId) return;
    return subscribeToChat(chatId, {
      onOpen: () => {
        stickToBottom.current = true;
        dispatch({ type: 'reset' });
      },
      onEvent: (event) => dispatch({ type: 'event', event }),
      onGone: () => setGeneration((g) => g + 1),
    });
  }, [chatId]);

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

  // Busy and questions come from the agent's state: a prompt is on its screen, not in its transcript.
  // A terminal session only reports `status` (busy / idle / waiting), a background job its state.
  const prompting =
    agent?.displayState === 'waiting' ||
    ((agent?.displayState === 'needs-input' || agent?.displayState === 'interactive') &&
      agent?.status === 'waiting');
  const busy =
    agent?.displayState === 'working' ||
    (agent?.displayState === 'interactive' && agent?.status === 'busy');
  const prompt = usePanePrompt(pane.id, prompting);
  const choices = prompt ? extractNumberedChoices(prompt) : [];
  const notConnected = 'The terminal is not connected: switch to the terminal view and reattach';

  const answerPrompt = (answer: string) => {
    setError(pressKeys(pane.id, answer) ? null : notConnected);
  };

  const submit = async () => {
    if (sending || !connected || (!text.trim() && images.length === 0)) return;
    setSending(true);
    setError(null);
    try {
      const paths = await Promise.all(images.map(uploadAgentImage));
      if (!typeIntoPane(pane.id, promptWithImages(text, paths))) {
        setError(notConnected);
        return;
      }
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

  // Esc, like the key in the TUI
  const stopTurn = () => {
    setError(pressKeys(pane.id, '\x1b') ? null : notConnected);
  };

  const status = !connected
    ? 'terminal disconnected'
    : prompting
      ? 'needs input'
      : busy
        ? 'working…'
        : 'ready';

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
      data-agent-pane={pane.id}
      data-chat-pane
      data-pane-active={active}
      {...imageDropHandlers((files) => setImages((prev) => [...prev, ...files]))}
    >
      <div
        {...headerProps}
        className={`flex flex-nowrap items-center gap-x-1.5 h-8 px-2 border-b text-xs shrink-0 bg-gray-900 border-gray-800 ${
          headerProps?.draggable ? 'cursor-grab active:cursor-grabbing' : ''
        } ${headerProps?.className ?? ''}`}
      >
        <MessageSquare size={13} aria-hidden className="text-blue-300 shrink-0" />
        <span className="font-medium text-gray-200 truncate min-w-0">{pane.name}</span>
        {harness !== 'claude' && (
          <span className="shrink-0 px-1 rounded border border-gray-700 text-[10px] text-gray-400">
            {harnessName}
          </span>
        )}
        <span className="text-gray-500 font-mono truncate min-w-0 hidden lg:inline">
          {pane.cwd}
        </span>
        {state.model && (
          <span className="text-gray-500 truncate min-w-0 hidden sm:inline">{state.model}</span>
        )}
        <span
          className={`shrink-0 ${prompting || !connected ? 'text-amber-300' : busy ? 'text-blue-300' : 'text-gray-500'}`}
        >
          {status}
        </span>
        {meta && (
          <div className="flex items-center gap-x-2 min-w-0 overflow-hidden text-[11px] text-gray-400">
            {meta}
          </div>
        )}
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
        {busy && connected && (
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
          onClick={onShowTerminal}
          onMouseDown={keepFocus}
          className={iconBtn}
          title="Terminal view (same process, it keeps running)"
          aria-label="Terminal view"
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
            aria-label="Move to its own tab"
          >
            <Maximize2 size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          onMouseDown={keepFocus}
          className={iconBtn}
          title="Close (the agent keeps running)"
          aria-label={`Close ${pane.name}`}
        >
          <X size={14} />
        </button>
      </div>

      <div
        ref={listRef}
        role="log"
        aria-label={`Chat ${pane.name}`}
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
          {state.messages.length === 0 && (
            <div className="h-full flex items-center justify-center text-sm text-gray-500">
              {sessionId
                ? `Ask ${harnessName} anything. Markdown works; paste or drop images.`
                : `Waiting for ${harnessName} to report its session; the terminal view works meanwhile.`}
            </div>
          )}
          {state.messages.map((m) => (
            // content-visibility keeps long chats (hundreds of messages) cheap to scroll
            <div
              key={m.key}
              className="[content-visibility:auto] [contain-intrinsic-size:auto_60px]"
            >
              <ChatMessageView message={m} showSteps={showSteps} />
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
              The agent is asking: pick an answer or type it below
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
                    disabled={!connected}
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
        {chatId && (
          <ChatActivity chatId={chatId} messages={state.messages} sub={state.sub} busy={busy} />
        )}
        {error && (
          <div role="alert" className="mb-1 text-xs text-red-300">
            {error}
          </div>
        )}
        <div className="flex items-end gap-2">
          <ChatComposer
            chatId={chatId}
            value={text}
            onChange={setText}
            onSubmit={submit}
            onStop={stopTurn}
            busy={busy}
            disabled={!connected}
            submitKey={submitKey}
            history={history}
            commands={state.commands}
            agents={state.agents}
            inputRef={inputRef}
          />
          <button
            type="button"
            onClick={submit}
            disabled={sending || !connected}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50"
            aria-label="Send message"
          >
            <Send size={13} aria-hidden />
            <span className="hidden sm:inline">Send</span>
          </button>
        </div>
        <ImageAttachments images={images} onChange={setImages} disabled={sending || !connected} />
        {chatId && <ChatStatusLine chatId={chatId} turns={turns} visible={active} />}
      </div>
    </div>
  );
};
