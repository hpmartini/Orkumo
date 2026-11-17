import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  Bot,
  Download,
  ExternalLink,
  Folder,
  GripVertical,
  Maximize2,
  MessageSquarePlus,
  Pencil,
  Pin,
  PinOff,
  X,
} from 'lucide-react';
import {
  fetchChatConversation,
  updateChatMeta,
  type ChatHistoryConversation,
  type ChatHistoryItem,
  type ChatPart,
  type ChatMetaPatch,
  type ChatProvider,
  type ChatSource,
} from '../../services/chatHistoryApi';
import { uploadAgentFile } from '../../services/agentsApi';
import {
  PROVIDER_HARNESS,
  PROVIDER_LABEL,
  PROVIDER_SITE,
  continuePrompt,
  conversationMarkdown,
  conversationUrl,
  isWebProvider,
  markdownFileName,
  promptLimit,
} from '../../utils/chatHistory';
import { harnessLabel } from '../../utils/agentSessions';
import { openInSystemBrowser } from '../../utils/links';
import { ICON_BTN, SELECT_CLS } from '../AgentsView/PullRequestsPage';
import { ChatComposer } from '../AgentsView/Chat/ChatComposer';
import { ChatParts } from './ChatParts';

const PROVIDER_CLS: Record<ChatSource, string> = {
  claude: 'bg-orange-500/15 text-orange-300',
  chatgpt: 'bg-emerald-500/15 text-emerald-300',
  orkumo: 'bg-blue-500/15 text-blue-300',
};

/** Closer than this to the end counts as "at the bottom": new content then keeps it there */
const STICK_PX = 48;
/** How long a prompt waits for the provider's page to load and show its prompt field */
const SEND_TRIES = 30;
const SEND_RETRY_MS = 700;

const day = (time: number | null) =>
  time ? new Date(time).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';
/** A tool round splits one answer into several messages: they show as one turn */
const turns = (messages: ChatHistoryConversation['messages']) => {
  const out: { key: number; user: boolean; parts: ChatPart[] }[] = [];
  messages.forEach((message, i) => {
    const user = message.role === 'user';
    const parts: ChatPart[] = message.parts ?? [{ type: 'text', text: message.text }];
    const last = out[out.length - 1];
    if (!user && last && !last.user) last.parts.push(...parts);
    else out.push({ key: i, user, parts: [...parts] }); // a copy: the turn grows, the message must not
  });
  return out;
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const ProviderBadge: React.FC<{ provider: ChatSource }> = ({ provider }) => (
  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${PROVIDER_CLS[provider]}`}>
    {PROVIDER_LABEL[provider]}
  </span>
);

/** Saves a conversation as Markdown through the browser's download (#19 AK-6) */
function downloadMarkdown(conversation: ChatHistoryConversation) {
  const url = URL.createObjectURL(
    new Blob([conversationMarkdown(conversation)], { type: 'text/markdown;charset=utf-8' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = markdownFileName(conversation);
  link.click();
  // the download has its own copy once started
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** One-line text form in the reader header (rename, folder); Enter saves, Escape cancels */
const InlineField: React.FC<{
  label: string;
  initial: string;
  placeholder?: string;
  suggestions?: string[];
  maxLength: number;
  onSave: (value: string) => void;
  onCancel: () => void;
}> = ({ label, initial, placeholder, suggestions = [], maxLength, onSave, onCancel }) => {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value);
      }}
    >
      <input
        autoFocus
        aria-label={label}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        list={suggestions.length ? 'chat-folder-suggestions' : undefined}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        className={`${SELECT_CLS} !max-w-none w-56`}
      />
      {suggestions.length > 0 && (
        <datalist id="chat-folder-suggestions">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      <button type="submit" className={`${ICON_BTN} border border-gray-700`}>
        Save
      </button>
      <button type="button" onClick={onCancel} className={ICON_BTN}>
        Cancel
      </button>
    </form>
  );
};

/** What happened to a prompt; `sent` / `typed` come from the provider's page (chatPrompt.js) */
const SEND_NOTE: Record<string, string> = {
  sent: 'Sent. The answer shows in the browser pane now and here after the next sync.',
  typed: 'Typed into the page; press send there.',
  'no-field':
    'No prompt field found (logged out?). The prompt is on the clipboard; paste it in the browser pane.',
  'no-page':
    'The chat page did not open (logged out?). The prompt is on the clipboard; paste it in the browser pane.',
  loading:
    'The chat page is still loading. The prompt is on the clipboard; paste it in the browser pane.',
  web: 'Sending needs the desktop app. The prompt is on the clipboard; paste it on the site.',
};

/**
 * "Continue writing" (Chats mode): the prompt goes into the provider's own page of this chat, in a
 * built-in browser pane next to the reader with the user's login, and is sent there. Their
 * subscription answers; Orkumo forges no request (electron/chatPrompt.js says why).
 */
const ChatSender: React.FC<{
  conversation: ChatHistoryConversation & { provider: ChatProvider };
  onOpenSite: (url: string) => void;
  onSent: () => void;
}> = ({ conversation, onOpenSite, onSent }) => {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const url = conversationUrl(conversation) ?? '';
  const site = PROVIDER_SITE[conversation.provider];

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const api = window.electronAPI?.chatSync;
    if (!api?.typePrompt) {
      void navigator.clipboard?.writeText(text);
      openInSystemBrowser(url);
      setNote(SEND_NOTE.web);
      return;
    }
    setBusy(true);
    setNote(null);
    const id = conversation.id.slice(conversation.provider.length + 1);
    let result = await api.typePrompt(conversation.provider, id, text).catch(() => 'no-field');
    if (result === 'no-page') {
      onOpenSite(url);
      setNote(`Opening the chat on ${site}…`);
    }
    // a page that just opened needs a moment until its prompt field exists
    for (let i = 0; result !== 'sent' && result !== 'typed' && i < SEND_TRIES; i++) {
      await wait(SEND_RETRY_MS);
      result = await api.typePrompt(conversation.provider, id, text).catch(() => 'no-field');
    }
    setBusy(false);
    if (result === 'sent') {
      setDraft('');
      onSent();
    } else if (result !== 'typed') void navigator.clipboard?.writeText(text);
    else setDraft('');
    setNote(SEND_NOTE[result] ?? null);
  };

  return (
    <div className="shrink-0 border-t border-gray-800 bg-gray-900 px-4 py-2" data-chat-sender>
      <div className="max-w-3xl mx-auto">
        <ChatComposer
          chatId={null}
          value={draft}
          onChange={setDraft}
          onSubmit={() => void send()}
          onStop={() => {}}
          busy={busy}
          disabled={false}
          submitKey="enter"
          history={conversation.messages.filter((m) => m.role === 'user').map((m) => m.text)}
          commands={[]}
          agents={[]}
          inputRef={inputRef}
        />
        <p className="mt-1 text-[11px] text-gray-400" aria-live="polite">
          {busy
            ? `Sending on ${site}…`
            : (note ??
              `Enter sends on ${site} in a browser pane next to this chat, with your login there.`)}
        </p>
      </div>
    </div>
  );
};

export interface ChatReaderProps {
  /** Conversation id (`claude:…`, `chatgpt:…`, `orkumo:…`) */
  id: string;
  /** Changes whenever the list reloaded (sync, import): the open chat refetches */
  version: number;
  folders: string[];
  active: boolean;
  onFocus: () => void;
  onClose: () => void;
  onMaximize?: () => void;
  /** Drag handle of the pane (tiling); only while the tab holds several panes */
  headerProps?: React.HTMLAttributes<HTMLDivElement>;
  /** Pin, rename, folder, archive changed the list */
  onChanged: (item: ChatHistoryItem) => void;
  /** Opens a provider page in a built-in browser pane next to this one */
  onOpenSite: (url: string) => void;
  onSent: () => void;
}

/**
 * One conversation as a pane: header stays on top, the newest message is in view on opening, and
 * claude.ai / ChatGPT chats get a composer that continues them on their site.
 */
export const ChatReader: React.FC<ChatReaderProps> = ({
  id,
  version,
  folders,
  active,
  onFocus,
  onClose,
  onMaximize,
  headerProps,
  onChanged,
  onOpenSite,
  onSent,
}) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState<ChatHistoryConversation | null>(null);
  const [error, setError] = useState<string | null>(null);
  // reader header form: rename or file into a folder (#19 AK-5)
  const [editing, setEditing] = useState<'title' | 'folder' | null>(null);
  const [continuing, setContinuing] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastTop = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetchChatConversation(id)
      .then((c) => !cancelled && (setOpen(c), setError(null)))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id, version]);

  // Opening a chat shows its end, like claude.ai and ChatGPT
  useLayoutEffect(() => {
    atBottom.current = true;
  }, [id]);
  const toBottom = () => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  };
  useLayoutEffect(toBottom, [open]);
  const loaded = !!open;
  // Images and opened artifacts grow the chat after the first paint, and a split resizes the
  // pane without a scroll event: stay at the end if there
  useEffect(() => {
    if (!content.current || !scroller.current) return;
    const observer = new ResizeObserver(toBottom);
    observer.observe(content.current);
    observer.observe(scroller.current);
    return () => observer.disconnect();
  }, [loaded]);

  /** Pin, rename, file, archive this conversation; the list follows (#19 AK-5) */
  const mark = async (patch: ChatMetaPatch) => {
    if (!open) return;
    try {
      const item = await updateChatMeta(open.id, patch);
      setOpen((c) => (c && c.id === item.id ? { ...c, ...item } : c));
      setEditing(null);
      onChanged(item);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /**
   * Carries a claude.ai / ChatGPT conversation into a new Orkumo chat on the CLI of the same
   * subscription, in the chats folder. The whole conversation goes along as a Markdown file; the
   * prompt repeats as much of its end as the harness's start prompt takes (#19 AK-7).
   */
  const continueChat = async (conversation: ChatHistoryConversation) => {
    if (!isWebProvider(conversation.provider) || continuing) return;
    const harness = PROVIDER_HARNESS[conversation.provider];
    setContinuing(true);
    let file: string | null = null;
    try {
      file = await uploadAgentFile(
        new File([conversationMarkdown(conversation)], markdownFileName(conversation), {
          type: 'text/markdown',
        })
      );
    } catch {
      // the prompt still carries the conversation's end
    } finally {
      setContinuing(false);
    }
    navigate('/agents', {
      state: {
        dispatch: continuePrompt(conversation, promptLimit(harness), file),
        mode: 'chat',
        harness,
        place: 'chats',
      },
    });
  };

  const assistant = open
    ? open.harness
      ? harnessLabel(open.harness)
      : PROVIDER_LABEL[open.provider]
    : '';

  return (
    <div
      className={`h-full flex flex-col min-h-0 bg-gray-900 border ${active ? 'border-blue-500/40' : 'border-transparent'}`}
      onMouseDownCapture={onFocus}
      aria-label="Conversation"
      data-testid={`reader-${id}`}
    >
      <div
        ref={scroller}
        className="flex-1 min-h-0 overflow-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          // Only scrolling up lets go of the end: the event of our own jump arrives after the
          // chat may have grown again, and would read as "not at the end" otherwise
          const up = el.scrollTop < lastTop.current;
          lastTop.current = el.scrollTop;
          atBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX ||
            (atBottom.current && !up);
        }}
      >
        {!open ? (
          <p className="px-4 py-6 text-sm text-gray-400" role={error ? 'alert' : undefined}>
            {error ?? 'Loading…'}
          </p>
        ) : (
          <div ref={content}>
            <header
              className="sticky top-0 z-10 border-b border-gray-800 bg-gray-900/95 backdrop-blur supports-[backdrop-filter]:bg-gray-900/80"
              data-chat-header
            >
              <div className="max-w-3xl mx-auto px-4 py-2 flex flex-wrap items-start gap-2">
                {headerProps && (
                  <div
                    {...headerProps}
                    className={`self-center cursor-grab text-gray-500 hover:text-gray-300 ${headerProps.className ?? ''}`}
                    title="Drag onto a pane edge to rearrange, or onto the tab strip for its own tab"
                  >
                    <GripVertical size={14} aria-hidden />
                  </div>
                )}
                <div className="flex-1 min-w-[12rem]">
                  {editing === 'title' ? (
                    <InlineField
                      label="Chat title"
                      initial={open.title}
                      maxLength={200}
                      onSave={(title) => void mark({ title: title.trim() || null })}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <h2 className="text-base font-medium text-gray-100 truncate">{open.title}</h2>
                  )}
                  <p className="text-xs text-gray-400 flex flex-wrap items-center gap-2 mt-1">
                    <ProviderBadge provider={open.provider} />
                    {[...new Set([day(open.createdAt), day(open.updatedAt)].filter(Boolean))].join(
                      ' – '
                    )}
                    {open.projectName && <span>· {open.projectName}</span>}
                    {open.harness && <span>· {harnessLabel(open.harness)}</span>}
                    <span>· {open.messages.length} messages</span>
                    {open.folder && (
                      <span className="inline-flex items-center gap-1">
                        · <Folder size={11} aria-hidden /> {open.folder}
                      </span>
                    )}
                    {open.archived && <span>· archived</span>}
                  </p>
                  {editing === 'folder' && (
                    <div className="mt-2">
                      <InlineField
                        label="Folder"
                        initial={open.folder ?? ''}
                        placeholder="Folder name, empty = none"
                        suggestions={folders}
                        maxLength={60}
                        onSave={(name) => void mark({ folder: name.trim() || null })}
                        onCancel={() => setEditing(null)}
                      />
                    </div>
                  )}
                </div>
                <div
                  role="group"
                  className="flex flex-wrap items-center gap-1"
                  aria-label="Chat actions"
                >
                  <button
                    type="button"
                    onClick={() => void mark({ pinned: !open.pinned })}
                    className={ICON_BTN}
                    aria-label={open.pinned ? 'Unpin' : 'Pin'}
                    title={open.pinned ? 'Unpin' : 'Pin to the top of the list'}
                  >
                    {open.pinned ? <PinOff size={12} aria-hidden /> : <Pin size={12} aria-hidden />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing('title')}
                    className={ICON_BTN}
                    aria-label="Rename"
                    title="Rename (here only; the provider keeps its title)"
                  >
                    <Pencil size={12} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing('folder')}
                    className={ICON_BTN}
                    aria-label="Move to folder"
                    title="Move to a folder"
                  >
                    <Folder size={12} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => void mark({ archived: !open.archived })}
                    className={ICON_BTN}
                    aria-label={open.archived ? 'Unarchive' : 'Archive'}
                    title={open.archived ? 'Back into the list' : 'Archive: hidden unless filtered'}
                  >
                    {open.archived ? (
                      <ArchiveRestore size={12} aria-hidden />
                    ) : (
                      <Archive size={12} aria-hidden />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadMarkdown(open)}
                    className={ICON_BTN}
                    aria-label="Export as Markdown"
                    title="Download as Markdown"
                  >
                    <Download size={12} aria-hidden />
                  </button>
                  {onMaximize && (
                    <button
                      type="button"
                      onClick={onMaximize}
                      className={ICON_BTN}
                      aria-label="Move chat to its own tab"
                      title="Own tab"
                    >
                      <Maximize2 size={12} aria-hidden />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    className={ICON_BTN}
                    aria-label="Close chat"
                    title="Close"
                  >
                    <X size={12} aria-hidden />
                  </button>
                </div>
                {isWebProvider(open.provider) ? (
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => onOpenSite(conversationUrl(open) ?? '')}
                      className={`${ICON_BTN} border border-gray-700`}
                      title="Opens the conversation in a built-in browser pane next to this one"
                    >
                      <ExternalLink size={12} aria-hidden /> Open on {PROVIDER_SITE[open.provider]}
                    </button>
                    <button
                      type="button"
                      onClick={() => void continueChat(open)}
                      disabled={continuing}
                      className={`${ICON_BTN} border border-gray-700 disabled:opacity-50`}
                      title="Opens a new Orkumo chat with this conversation as its start, on the same subscription (Claude Code or Codex); the whole conversation goes along as a file"
                    >
                      <MessageSquarePlus size={12} aria-hidden /> Continue in Orkumo
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      navigate('/agents', {
                        state: {
                          openChat: {
                            harness: open.harness,
                            sessionId: open.sessionId,
                            cwd: open.cwd,
                            title: open.title,
                          },
                        },
                      })
                    }
                    className={`${ICON_BTN} border border-gray-700`}
                    title="Opens this chat in Agents: its pane if it runs, else it resumes"
                  >
                    <Bot size={12} aria-hidden /> Open in Agents
                  </button>
                )}
              </div>
              {error && (
                <p role="alert" className="max-w-3xl mx-auto px-4 pb-2 text-xs text-red-300">
                  {error}
                </p>
              )}
            </header>
            <article className="max-w-3xl mx-auto px-4 py-3">
              {turns(open.messages).map((turn) =>
                turn.user ? (
                  <div key={turn.key} className="flex justify-end my-3">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-blue-900/50 border border-blue-800/60 px-3.5 py-2 text-sm text-gray-100 whitespace-pre-wrap break-words">
                      <ChatParts parts={turn.parts} provider={open.provider as ChatProvider} user />
                    </div>
                  </div>
                ) : (
                  // one answer, over all its tool rounds, in one card
                  <section
                    key={turn.key}
                    className="my-3 rounded-xl border border-gray-800 bg-gray-950/40 px-4 py-3 shadow-sm"
                    data-answer
                  >
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-gray-400">
                      <Bot size={13} aria-hidden />
                      {assistant}
                    </div>
                    <ChatParts
                      parts={turn.parts}
                      provider={open.provider as ChatProvider}
                      onOpenUrl={onOpenSite}
                    />
                  </section>
                )
              )}
            </article>
          </div>
        )}
      </div>
      {open && isWebProvider(open.provider) && (
        <ChatSender
          conversation={open as ChatHistoryConversation & { provider: ChatProvider }}
          onOpenSite={onOpenSite}
          onSent={onSent}
        />
      )}
    </div>
  );
};
