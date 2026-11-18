import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  ChevronRight,
  History,
  ListTree,
  Maximize2,
  MessageSquare,
  MessagesSquare,
  RefreshCw,
  Send,
  Square,
  SquareTerminal,
  X,
} from 'lucide-react';
import type { AgentSession } from '../../../types';
import {
  groupAnswers,
  initialChatState,
  initialPrompts,
  pendingPrompts,
  prependHistory,
  agentMessage,
  reduceChat,
  type ChatState,
  type ChatSubmitKey,
} from '../../../utils/chatEvents';
import { attachableFiles, promptWithAttachments } from '../../../utils/composer';
import {
  fetchChatHistory,
  openTranscriptView,
  subscribeToChat,
  uploadAttachment,
} from '../../../services/agentsApi';
import { ImageAttachments, imageDropHandlers } from '../../ImageAttachments';
import { ChatIdContext, ChatItemView, UserMessage } from './ChatMessages';
import { ChatFileContext } from './ChatMarkdown';
import {
  ChatArtifactsButton,
  ChatArtifactsModal,
  artifactRefreshKey,
  useChatArtifacts,
} from './ChatArtifacts';
import { ChatComposer } from './ChatComposer';
import { ChatActivity } from './ChatActivity';
import { ChatStatusLine } from './ChatStatusLine';
import { QuestionCard } from './QuestionCard';
import { ModelEffortPicker } from '../ModelEffortPicker';
import { switchCommands } from '../../../utils/modelMatrix';
import { splitImages } from '../../../utils/chatComposer';
import { extractNumberedChoices, screenPrompt } from '../../../utils/agentInput';
import { dialogKeys, parseAgentDialog, type DialogAnswer } from '../../../utils/agentDialog';
import { harnessLabel, sessionHarness } from '../../../utils/agentSessions';
import {
  paneScreen,
  paneSuggestion,
  takePaneSuggestion,
  pressKeys,
  reattachPane,
  typeIntoPane,
  usePaneConnected,
} from '../AgentTerminal';

/** Sessions whose view shows only the user's prompts (answers hidden) */
const PROMPTS_ONLY_KEY = 'devOrbitChatPromptsOnly';

function readPromptsOnly(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(PROMPTS_ONLY_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Answers hidden or shown for session `sessionId`, remembered per session */
function usePromptsOnly(sessionId: string | null): [boolean, () => void] {
  const [list, setList] = useState(readPromptsOnly);
  const on = !!sessionId && list.includes(sessionId);
  const toggle = useCallback(() => {
    if (!sessionId) return;
    const current = readPromptsOnly(); // another pane may have changed it
    const next = current.includes(sessionId)
      ? current.filter((id) => id !== sessionId)
      : [...current, sessionId].slice(-200);
    setList(next);
    try {
      localStorage.setItem(PROMPTS_ONLY_KEY, JSON.stringify(next));
    } catch {
      // stays for this page only
    }
  }, [sessionId]);
  return [on, toggle];
}

/** How often the screen of an agent that asks something is read for its question */
const PROMPT_POLL_MS = 1000;
/** Screen lines read for a question: a two-question dialog with descriptions takes ~30 */
const PROMPT_LINES = 40;
/** A sent answer keeps its card locked this long when the screen does not move on (keys lost) */
const SENT_LOCK_MS = 5000;

type PaneSuggestion = ReturnType<typeof paneSuggestion>;

/** Claude Code's ghost-text suggestion in pane `paneId`'s input line, read while `active` */
function usePaneSuggestion(paneId: string, active: boolean): PaneSuggestion {
  const [suggestion, setSuggestion] = useState<PaneSuggestion>(null);
  useEffect(() => {
    if (!active) return;
    const read = () => {
      const next = paneSuggestion(paneId);
      setSuggestion((prev) =>
        prev?.text === next?.text && prev?.truncated === next?.truncated ? prev : next
      );
    };
    read();
    const timer = setInterval(read, PROMPT_POLL_MS);
    return () => {
      clearInterval(timer);
      setSuggestion(null);
    };
  }, [paneId, active]);
  return active ? suggestion : null;
}

/** Screen tail of pane `paneId` while its agent waits on a question or permission (not in its transcript) */
function usePanePrompt(paneId: string, prompting: boolean): string | null {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!prompting) return;
    const read = () => setText(paneScreen(paneId, PROMPT_LINES));
    read();
    const timer = setInterval(read, PROMPT_POLL_MS);
    return () => {
      clearInterval(timer);
      setText('');
    };
  }, [paneId, prompting]);
  return prompting ? text : null;
}

type Action =
  | { type: 'reset' }
  | { type: 'event'; event: unknown }
  | { type: 'older'; page: Awaited<ReturnType<typeof fetchChatHistory>> };
const reducer = (state: ChatState, action: Action): ChatState =>
  action.type === 'reset'
    ? initialChatState
    : action.type === 'older'
      ? prependHistory(state, action.page)
      : reduceChat(state, action.event);
/** Distance from the top (px) at which the next older page loads */
const LOAD_OLDER_PX = 400;

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
  // Older turns load page by page near the top; the view keeps its place while they go in front
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingRef = useRef(false);
  // The message at the top of the view and its offset: put back there once the page is in
  const restoreScroll = useRef<{ key: string; offset: number } | null>(null);
  const loadOlder = useCallback(() => {
    const older = state.older;
    const el = listRef.current;
    if (!chatId || !older?.more || loadingRef.current || !el) return;
    loadingRef.current = true;
    setLoadingOlder(true);
    fetchChatHistory(chatId, older.before)
      .then((page) => {
        const top = el.getBoundingClientRect().top;
        const first = [...el.querySelectorAll<HTMLElement>('[data-chat-key]')].find(
          (m) => m.getBoundingClientRect().bottom > top
        );
        if (first?.dataset.chatKey)
          restoreScroll.current = {
            key: first.dataset.chatKey,
            offset: first.getBoundingClientRect().top - top,
          };
        dispatch({ type: 'older', page });
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        loadingRef.current = false;
        setLoadingOlder(false);
      });
  }, [chatId, state.older]);
  useLayoutEffect(() => {
    const el = listRef.current;
    const saved = restoreScroll.current;
    if (!el || !saved) return;
    restoreScroll.current = null;
    const anchor = el.querySelector<HTMLElement>(
      `[data-chat-key="${globalThis.CSS.escape(saved.key)}"]`
    );
    if (!anchor) return;
    // by the element, not the height: estimated heights (content-visibility) settle later
    el.scrollTop +=
      anchor.getBoundingClientRect().top - el.getBoundingClientRect().top - saved.offset;
    lastScrollTop.current = el.scrollTop;
  }, [state.messages]);
  // A short tail that does not fill the view cannot be scrolled: load on until it does
  useEffect(() => {
    const el = listRef.current;
    if (el && el.scrollHeight <= el.clientHeight + LOAD_OLDER_PX) loadOlder();
  }, [state.older, loadOlder]);
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
        .filter((m) => !agentMessage(m.text))
        .map((m) => splitImages(m.text).text)
        .filter(Boolean),
    [state.messages]
  );
  const turns = useMemo(
    () => state.messages.filter((m) => m.kind === 'result').length,
    [state.messages]
  );
  // One card per answer; regrouped per event, cards memoize on their messages
  const items = useMemo(() => groupAnswers(state.messages), [state.messages]);
  const [promptsOnly, togglePromptsOnly] = usePromptsOnly(sessionId);
  // Latest recap (Claude's away summary) stays pinned above the input instead of in the log
  const recap = useMemo(() => {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const m = state.messages[i];
      if (m.kind === 'recap') return m;
    }
    return null;
  }, [state.messages]);
  const shown = useMemo(
    () =>
      promptsOnly
        ? items.filter((item) => item.kind === 'user' && !agentMessage(item.text))
        : items.filter((item) => item !== recap),
    [items, promptsOnly, recap]
  );
  const pending = useMemo(() => pendingPrompts(state), [state]);
  const starts = useMemo(() => initialPrompts(state.messages), [state.messages]);
  const [startsOpen, setStartsOpen] = useState(false);
  // Jump to a prompt; letting go of the bottom keeps late layout from pulling the list back down
  const jumpTo = (key: string) => {
    const target = listRef.current?.querySelector<HTMLElement>(`[data-chat-key="${key}"]`);
    if (!target) return;
    stickToBottom.current = false;
    target.scrollIntoView({ block: 'start' });
    // content-visibility renders the skipped messages above late: settle, then aim again
    requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
    target.animate?.(
      [{ backgroundColor: 'rgba(59,130,246,0.25)' }, { backgroundColor: 'transparent' }],
      { duration: 1200 }
    );
  };
  const artifactKey = useMemo(
    () => artifactRefreshKey(state.messages, turns),
    [state.messages, turns]
  );
  const artifacts = useChatArtifacts(chatId, artifactKey);
  const [artifactsOpen, setArtifactsOpen] = useState(false);

  // Busy and questions come from the agent's state: a prompt is on its screen, not in its transcript.
  // The server derives `displayState` for every kind; a prompt to answer here needs `status: waiting`.
  const prompting =
    agent?.displayState === 'waiting' ||
    (agent?.displayState === 'needs-input' && agent?.status === 'waiting');
  const busy = agent?.displayState === 'working';
  // Back to idle: an echoed prompt still unlogged was withdrawn in the TUI (a few s for the poll)
  useEffect(() => {
    if (busy) return;
    const t = window.setTimeout(
      () => dispatch({ type: 'event', event: { type: 'devorbit_sent_clear' } }),
      3000
    );
    return () => window.clearTimeout(t);
  }, [busy]);
  // The agent's state only says it may wait; the box needs a dialog on its screen
  const screen = usePanePrompt(pane.id, prompting);
  const suggestion = usePaneSuggestion(
    pane.id,
    harness === 'claude' && connected && !busy && !prompting
  );
  const prompt = screen ? screenPrompt(screen) : null;
  // A dialog the parser knows becomes a card; any other prompt stays the screen excerpt below
  const dialog = useMemo(() => (prompt ? parseAgentDialog(screen ?? '') : null), [prompt, screen]);
  const dialogId = dialog ? JSON.stringify(dialog) : null;
  const [sentFor, setSentFor] = useState<string | null>(null);
  useEffect(() => {
    if (!sentFor) return;
    const t = window.setTimeout(() => setSentFor(null), SENT_LOCK_MS);
    return () => window.clearTimeout(t);
  }, [sentFor]);
  const choices = prompt && !dialog ? extractNumberedChoices(prompt) : [];
  const notConnected = 'The terminal is not connected: use Reattach above, then send again';

  // Model × effort of the running session: typed as its own commands, one after the other (a
  // second paste before the first Enter would land in the same line)
  const switchModel = (model: string, effort: string) => {
    if (harness !== 'claude' && harness !== 'omp') return;
    const [first, ...rest] = switchCommands(harness, model, effort);
    if (!first) return;
    if (!typeIntoPane(pane.id, first)) return setError(notConnected);
    rest.forEach((cmd, i) => window.setTimeout(() => typeIntoPane(pane.id, cmd), 600 * (i + 1)));
  };

  const answerPrompt = (answer: string) => {
    setError(pressKeys(pane.id, answer) ? null : notConnected);
  };

  // Keys go to what is on the screen now: the card may be a poll old, and a click on "Yes"
  // must not approve a different command
  const answerDialog = (answer: DialogAnswer) => {
    const now = parseAgentDialog(paneScreen(pane.id, PROMPT_LINES));
    if (!now || JSON.stringify(now) !== dialogId)
      return setError('The question on the agent’s screen changed: check it and answer again');
    if (!pressKeys(pane.id, dialogKeys(now, answer))) return setError(notConnected);
    setError(null);
    setSentFor(dialogId);
  };

  const submit = async () => {
    if (sending || !connected || (!text.trim() && images.length === 0)) return;
    setSending(true);
    setError(null);
    try {
      const stored = await Promise.all(images.map(uploadAttachment));
      const prompt = promptWithAttachments(text, stored);
      if (!typeIntoPane(pane.id, prompt)) {
        setError(notConnected);
        return;
      }
      // Claude logs a typed prompt at once (or as queued); others only once the agent takes it.
      // Commands never show up as a user turn.
      if (harness !== 'claude' && !prompt.trimStart().startsWith('/'))
        dispatch({ type: 'event', event: { type: 'devorbit_sent', text: prompt } });
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

  const view = (
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
      {...imageDropHandlers((files) => setImages((prev) => [...prev, ...files]), attachableFiles)}
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
        {!connected && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              if (!reattachPane(pane.id)) setError('No terminal to reattach: reopen the agent');
            }}
            className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-amber-100 bg-amber-500/15 border border-amber-400/40 hover:bg-amber-500/25 focus-visible:outline-2 focus-visible:outline-blue-400"
            title="Reattach the terminal behind this view (the session keeps running)"
          >
            <RefreshCw size={11} aria-hidden />
            Reattach
          </button>
        )}
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
        <button
          type="button"
          onClick={togglePromptsOnly}
          onMouseDown={keepFocus}
          disabled={!sessionId}
          className={`${iconBtn} ${promptsOnly ? 'text-blue-300' : ''}`}
          title={promptsOnly ? 'Show the answers again' : 'Show only my prompts (hide the answers)'}
          aria-label="Show only my prompts"
          aria-pressed={promptsOnly}
        >
          <MessagesSquare size={13} />
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

      {starts.length > 0 && (
        <div className="shrink-0 border-b border-gray-800 bg-gray-900/60 text-xs">
          <button
            type="button"
            onClick={() => setStartsOpen((o) => !o)}
            className="flex w-full items-center gap-1 px-3 py-1 text-gray-400 hover:text-gray-200"
            aria-expanded={startsOpen}
            data-chat-starts
          >
            <ChevronRight
              size={12}
              aria-hidden
              className={`transition-transform ${startsOpen ? 'rotate-90' : ''}`}
            />
            {starts.length === 1 ? 'Start prompt' : `${starts.length} start prompts`}
            <span className="text-gray-600">(session start, after compaction or /clear)</span>
          </button>
          {startsOpen && (
            <ol className="max-h-40 overflow-y-auto pb-1">
              {starts.map((m, i) => (
                <li key={m.key}>
                  <button
                    type="button"
                    onClick={() => jumpTo(m.key)}
                    className="block w-full truncate px-3 py-0.5 pl-7 text-left text-gray-300 hover:bg-gray-800 hover:text-white"
                    title={m.text}
                  >
                    <span className="mr-1.5 text-gray-600">{i + 1}.</span>
                    {splitImages(m.text).text || m.text}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

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
          if (el.scrollTop < LOAD_OLDER_PX) loadOlder();
        }}
      >
        <div ref={contentRef}>
          {state.older?.more && (
            <div className="flex justify-center py-2" role="status">
              {loadingOlder ? (
                <span className="text-xs text-gray-500">Loading earlier messages…</span>
              ) : (
                <button
                  type="button"
                  onClick={loadOlder}
                  className="text-xs text-gray-400 hover:text-gray-200 underline-offset-2 hover:underline"
                >
                  Load earlier messages
                </button>
              )}
            </div>
          )}
          {state.messages.length === 0 && (
            <div className="h-full flex items-center justify-center text-sm text-gray-500">
              {sessionId
                ? `Ask ${harnessName} anything. Markdown works; paste or drop images.`
                : `Waiting for ${harnessName} to report its session; the terminal view works meanwhile.`}
            </div>
          )}
          <ChatFileContext.Provider value={pane.cwd}>
            {shown.map((item, i) => (
              // content-visibility keeps long chats (hundreds of messages) cheap to scroll
              <div
                key={item.key}
                data-chat-key={item.key}
                className="[content-visibility:auto] [contain-intrinsic-size:auto_60px]"
              >
                <ChatItemView
                  item={item}
                  showSteps={showSteps}
                  live={busy && item.kind === 'answer' && i === shown.length - 1}
                  harness={harnessName}
                  model={state.model}
                />
              </div>
            ))}
            {pending.map((p, i) => (
              <UserMessage key={`q${i}`} text={p} queued />
            ))}
            {busy && !promptsOnly && pending.length === 0 && items.at(-1)?.kind === 'user' && (
              <ChatItemView
                item={null}
                showSteps={showSteps}
                live
                harness={harnessName}
                model={state.model}
              />
            )}
          </ChatFileContext.Provider>
        </div>
      </div>

      <div className="shrink-0 border-t border-gray-800 p-2">
        {recap && (
          <section
            aria-label="Recap"
            data-chat-recap
            className="mb-2 flex gap-2 rounded-md border border-gray-700/70 bg-gray-900/70 px-3 py-2 text-sm text-gray-300"
          >
            <History size={14} aria-hidden className="mt-0.5 shrink-0 text-gray-500" />
            <p className="max-h-24 min-w-0 overflow-y-auto whitespace-pre-wrap">
              <span className="text-gray-500">Recap: </span>
              {recap.text}
            </p>
          </section>
        )}
        {dialog && (
          <QuestionCard
            dialog={dialog}
            sent={sentFor === dialogId}
            disabled={!connected}
            onAnswer={answerDialog}
          />
        )}
        {prompt !== null && !dialog && (
          <div
            role="status"
            className="mb-2 rounded-md border border-amber-400/40 bg-amber-500/10 p-2"
          >
            <div className="text-xs font-medium text-amber-200">
              The agent is asking: pick an answer or type it below
            </div>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-gray-200 font-mono">
              {prompt}
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
          <ChatActivity
            chatId={chatId}
            messages={state.messages}
            sub={state.sub}
            busy={busy}
            endedTasks={state.endedTasks}
          />
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
            suggestion={suggestion?.text}
            suggestionCut={suggestion?.truncated}
            takeSuggestion={() => takePaneSuggestion(pane.id)}
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
        <ImageAttachments
          images={images}
          onChange={setImages}
          disabled={sending || !connected}
          files
        />
        {chatId && (
          <div className="flex items-end gap-3">
            <div className="flex-1 min-w-0">
              <ChatStatusLine
                chatId={chatId}
                turns={turns}
                visible={active}
                picker={
                  (harness === 'claude' || harness === 'omp') && (
                    <ModelEffortPicker
                      harness={harness}
                      model=""
                      effort=""
                      keepLabel="current"
                      currentModel={state.model}
                      currentEffort={state.effort}
                      placement="up"
                      disabled={busy || !connected}
                      onPick={switchModel}
                      title={
                        busy
                          ? 'Switch model and effort once the agent is idle'
                          : `Switch model and effort of this session (${harness === 'omp' ? '/switch, /effort' : '/model, /effort'})`
                      }
                    />
                  )
                }
              />
            </div>
            <div className="mt-2">
              <ChatArtifactsButton artifacts={artifacts} onOpen={() => setArtifactsOpen(true)} />
            </div>
          </div>
        )}
        {chatId && artifactsOpen && (
          <ChatArtifactsModal
            chatId={chatId}
            cwd={pane.cwd}
            title={pane.name}
            artifacts={artifacts}
            onClose={() => setArtifactsOpen(false)}
          />
        )}
      </div>
    </div>
  );
  // tool results load their images from this chat
  return <ChatIdContext.Provider value={chatId}>{view}</ChatIdContext.Provider>;
};
