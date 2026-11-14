import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Bot,
  Check,
  Download,
  ExternalLink,
  Folder,
  FolderOpen,
  History,
  LogIn,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  SlidersHorizontal,
  SquarePen,
} from 'lucide-react';
import {
  fetchChatConversation,
  fetchChatHistory,
  importChatExport,
  updateChatMeta,
  type ChatHistoryConversation,
  type ChatHistoryItem,
  type ChatHistoryList,
  type ChatImportReport,
  type ChatMetaPatch,
  type ChatProvider,
  type ChatSource,
} from '../../services/chatHistoryApi';
import { uploadAgentFile } from '../../services/agentsApi';
import type { ChatSyncResult, ChatSyncStatus } from '../../electron/electron';
import {
  PROVIDER_HARNESS,
  PROVIDER_LABEL,
  PROVIDER_LOGIN,
  PROVIDER_SITE,
  RECENCY,
  continuePrompt,
  conversationMarkdown,
  conversationUrl,
  dayBound,
  isWebProvider,
  markdownFileName,
  promptLimit,
  recencyOf,
  relativeTime,
} from '../../utils/chatHistory';
import { harnessLabel } from '../../utils/agentSessions';
import { openInSystemBrowser, openLink } from '../../utils/links';
import { Filter, ICON_BTN, SELECT_CLS } from '../AgentsView/PullRequestsPage';
import { RailOutletContext } from '../AgentsView/railOutlet';
import { ChatMarkdown } from '../AgentsView/Chat/ChatMarkdown';

const PAGE = 200;
// Low rate on purpose (the providers' terms, the user's account): once on opening, then this often
const SYNC_EVERY_MS = 5 * 60_000;
const PROVIDERS: ChatProvider[] = ['claude', 'chatgpt'];
/** The list's sources: the synced providers plus the chats started in Orkumo (#19 AK-4) */
const SOURCES: ChatSource[] = [...PROVIDERS, 'orkumo'];
const PROVIDER_CLS: Record<ChatSource, string> = {
  claude: 'bg-orange-500/15 text-orange-300',
  chatgpt: 'bg-emerald-500/15 text-emerald-300',
  orkumo: 'bg-blue-500/15 text-blue-300',
};
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor';
const CHIP = 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] border';

const day = (time: number | null) =>
  time ? new Date(time).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';

const ProviderBadge: React.FC<{ provider: ChatSource }> = ({ provider }) => (
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

const reportLine = (file: ChatImportReport['files'][number]) => {
  const skipped = Object.entries(file.skipped)
    .map(([reason, count]) => `${count} ${reason}`)
    .join(', ');
  const source = file.provider ? PROVIDER_LABEL[file.provider] : (file.error ?? 'Unknown format');
  return `${file.file} (${source}): ${file.imported} of ${file.found} imported${skipped ? `, skipped: ${skipped}` : ''}`;
};

/** Below md the rail column is hidden (AgentsView): the list then stays in the page */
function useWide() {
  const query = '(min-width: 768px)';
  const [wide, setWide] = useState(() => window.matchMedia?.(query).matches ?? true);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const update = () => setWide(list.matches);
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, []);
  return wide;
}

/**
 * The desktop app's sync (electron/chatSync.js) while Chats is open: a run on opening, then every
 * few minutes, and right after a login in the built-in browser. `onData` reloads the list
 * whenever a run stored something. Absent in web mode: the export import is the way in there.
 */
function useChatSync(onData: () => void) {
  const [api] = useState(() => window.electronAPI?.chatSync);
  const [statuses, setStatuses] = useState<Partial<ChatSyncResult>>({});
  const [running, setRunning] = useState(false);
  const stored = useRef<Record<string, number>>({});
  const awaitingLogin = useRef<ChatProvider | null>(null);

  const take = useCallback(
    (provider: ChatProvider, status: ChatSyncStatus) => {
      setStatuses((s) => ({ ...s, [provider]: status }));
      const total = status.added + status.updated;
      if (total !== (stored.current[provider] ?? 0)) onData();
      stored.current[provider] = status.status === 'syncing' ? total : 0;
    },
    [onData]
  );

  const run = useCallback(() => {
    if (!api) return;
    setRunning(true);
    api
      .run()
      .then((result) => PROVIDERS.forEach((p) => take(p, result[p])))
      .catch((e: Error) =>
        PROVIDERS.forEach((p) =>
          take(p, { status: 'error', added: 0, updated: 0, reason: e.message })
        )
      )
      .finally(() => setRunning(false));
  }, [api, take]);

  useEffect(() => {
    if (!api) return;
    const off = api.onProgress(({ provider, ...status }) => take(provider, status));
    run();
    const timer = setInterval(run, SYNC_EVERY_MS);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [api, run, take]);

  // A login started here ends on the provider's start page: sync then instead of waiting minutes
  useEffect(
    () =>
      window.electronAPI?.browserView?.onNavigate(({ url }) => {
        const provider = awaitingLogin.current;
        if (!provider) return;
        try {
          const { hostname, pathname } = new URL(url);
          if (hostname !== PROVIDER_SITE[provider] || /^\/(login|auth)\b/.test(pathname)) return;
        } catch {
          return;
        }
        awaitingLogin.current = null;
        run();
      }),
    [run]
  );

  const login = useCallback((provider: ChatProvider) => {
    awaitingLogin.current = provider;
    openLink(PROVIDER_LOGIN[provider], undefined, 'builtin');
  }, []);

  return { available: !!api, statuses, running, run, login };
}

const SyncChip: React.FC<{
  provider: ChatProvider;
  status: ChatSyncStatus | undefined;
  onLogin: (provider: ChatProvider) => void;
}> = ({ provider, status, onLogin }) => {
  const label = PROVIDER_LABEL[provider];
  // providers run one after the other: the second waits for the first
  if (!status)
    return (
      <span className={`${CHIP} border-gray-800 text-gray-400`}>{label} · Waiting to sync</span>
    );
  if (status.status === 'syncing')
    return (
      <span className={`${CHIP} border-gray-700 text-gray-300`} role="status">
        <RefreshCw size={11} className="animate-spin" aria-hidden />
        {label} · Syncing{status.pending ? ` (${status.pending} left)` : '…'}
      </span>
    );
  if (status.status === 'ok')
    return (
      <span
        className={`${CHIP} border-gray-800 text-gray-300`}
        title={status.syncedAt ? `Synced ${new Date(status.syncedAt).toLocaleTimeString()}` : ''}
      >
        <Check size={11} className="text-emerald-400" aria-hidden />
        {label} · Up to date
      </span>
    );
  if (status.status === 'needs-login')
    return (
      <button
        type="button"
        onClick={() => onLogin(provider)}
        className={`${CHIP} border-blue-500/60 text-blue-300 hover:text-white hover:bg-blue-500/20 ${FOCUS}`}
        title={`Opens ${PROVIDER_SITE[provider]} in the built-in browser; the chats follow after the login`}
      >
        <LogIn size={11} aria-hidden /> Log in to {label}
      </button>
    );
  return (
    <span
      className={`${CHIP} ${status.status === 'error' ? 'border-red-900/60 text-red-300' : 'border-gray-800 text-gray-400'}`}
    >
      <AlertTriangle size={11} aria-hidden />
      {label} · {status.status === 'error' ? 'Sync failed' : 'Not synced here'}
    </span>
  );
};

/**
 * Chats mode (#280): claude.ai and ChatGPT conversations in the left rail, newest first and by
 * day; synced in the desktop app through the built-in browser's login, else from an imported data
 * export. Search, filters and topics are answered by the server; the selected conversation reads
 * in the main area and can be carried into a new Orkumo chat.
 */
export const ChatHistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [provider, setProvider] = useState<ChatSource | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [archived, setArchived] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [grouped, setGrouped] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [data, setData] = useState<ChatHistoryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ChatHistoryConversation | null>(null);
  // reader header form: rename or file into a folder (#19 AK-5)
  const [editing, setEditing] = useState<'title' | 'folder' | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importPath, setImportPath] = useState('');
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ChatImportReport | null>(null);
  const [reloads, setReloads] = useState(0);
  const latest = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const outlet = useContext(RailOutletContext);
  const wide = useWide();
  const reload = useCallback(() => setReloads((n) => n + 1), []);
  const sync = useChatSync(reload);

  useEffect(() => {
    const run = ++latest.current;
    // typing waits a moment; everything else (and the first load) asks at once
    const timer = setTimeout(
      () =>
        fetchChatHistory({
          q,
          provider,
          project,
          topic,
          folder,
          archived,
          from: dayBound(from),
          to: dayBound(to, true),
          limit,
        })
          .then((result) => {
            if (run !== latest.current) return;
            setData(result);
            setError(null);
          })
          .catch((e: Error) => run === latest.current && setError(e.message)),
      q ? 200 : 0
    );
    return () => clearTimeout(timer);
  }, [q, provider, project, topic, folder, archived, from, to, limit, reloads]);

  const openConversation = useCallback((id: string) => {
    setEditing(null);
    fetchChatConversation(id)
      .then(setOpen)
      .catch((e: Error) => setError(e.message));
  }, []);

  /** Pin, rename, file, archive the open conversation; the list follows (#19 AK-5) */
  const mark = async (patch: ChatMetaPatch) => {
    if (!open) return;
    try {
      const item = await updateChatMeta(open.id, patch);
      setOpen((c) => (c && c.id === item.id ? { ...c, ...item } : c));
      setEditing(null);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** "New chat" (#19 AK-1): the chat composer in the chats folder, no project to pick */
  const newChat = () => navigate('/agents', { state: { dispatch: '', mode: 'chat', place: 'chats' } });

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

  const runImport = async (path: string) => {
    if (!path.trim() || importing) return;
    setImporting(true);
    setReport(null);
    try {
      setReport(await importChatExport(path));
      setError(null);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const chooseFolder = async () => {
    const result = await window.electronAPI?.showOpenDialog({
      title: 'Unpacked data export of claude.ai or ChatGPT',
      properties: ['openDirectory'],
    });
    const picked = result?.filePaths?.[0];
    if (!picked) return;
    setImportPath(picked);
    void runImport(picked);
  };

  const filter =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setLimit(PAGE);
    };

  const rows = () => [
    ...(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-chat-row]') ?? []),
  ];
  /** ↑/↓ (Home/End) walk the rows, Enter opens the focused one (it is a button) */
  const onListKey = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const all = rows();
    if (all.length === 0) return;
    e.preventDefault();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? all.length - 1
          : e.key === 'ArrowDown'
            ? Math.min(all.length - 1, at + 1)
            : Math.max(0, at - 1);
    all[next].focus();
  };

  const items = data?.items ?? [];
  const now = Date.now();
  const groups: { label: string; items: ChatHistoryItem[] }[] = grouped
    ? (data?.topics ?? [])
        .map((t) => ({ label: t.name, items: items.filter((i) => i.topic === t.id) }))
        .filter((g) => g.items.length > 0)
    : RECENCY.map((label) => ({
        label,
        items: items.filter((i) => recencyOf(i.updatedAt, now) === label),
      })).filter((g) => g.items.length > 0);
  const empty =
    data && !archived && data.counts.claude + data.counts.chatgpt + data.counts.orkumo === 0;
  const importShown = importOpen || !sync.available;
  const syncing = sync.running || PROVIDERS.some((p) => sync.statuses[p]?.status === 'syncing');
  const extraFilters =
    [project, topic, folder, from, to].filter(Boolean).length + (grouped ? 1 : 0) + (archived ? 1 : 0);
  const problems = PROVIDERS.flatMap((p) => {
    const s = sync.statuses[p];
    return s?.reason && (s.status === 'error' || s.status === 'unavailable')
      ? [`${PROVIDER_LABEL[p]}: ${s.reason}`]
      : [];
  });

  const rail = (
    <div className="flex flex-col min-h-0 h-full" data-chat-rail>
      <div className="px-3 pt-2 pb-2 border-b border-gray-800 shrink-0 space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <History size={14} className="text-gray-400" aria-hidden />
          <span className="font-medium">Chats</span>
          {data && (
            <span className="text-gray-400 tabular-nums text-xs truncate" data-testid="chat-counts">
              {data.total} matching · Claude {data.counts.claude} · ChatGPT {data.counts.chatgpt}
              {data.counts.orkumo ? ` · Orkumo ${data.counts.orkumo}` : ''}
            </span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={newChat}
            className={ICON_BTN}
            title="New chat without a project (Claude Code, Codex or Oh My Pi), in its own folder"
            aria-label="New chat"
          >
            <SquarePen size={12} aria-hidden /> New chat
          </button>
          {sync.available && (
            <button
              type="button"
              onClick={sync.run}
              disabled={syncing}
              className={`${ICON_BTN} disabled:opacity-50 disabled:hover:bg-transparent`}
              title="Fetch new and changed conversations now"
              aria-label="Sync now"
            >
              <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} aria-hidden />
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              onBlur={(e) => {
                if (!e.currentTarget.parentElement?.contains(e.relatedTarget)) setMenuOpen(false);
              }}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={ICON_BTN}
              title="More chat actions"
              aria-label="More chat actions"
            >
              <MoreHorizontal size={14} aria-hidden />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 z-30 min-w-48 py-1 rounded-md border border-gray-700 bg-gray-900 shadow-lg"
                onKeyDown={(e) => e.key === 'Escape' && setMenuOpen(false)}
                onBlur={(e) => {
                  if (!e.currentTarget.parentElement?.contains(e.relatedTarget)) setMenuOpen(false);
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setImportOpen((o) => !o);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-200 hover:bg-gray-800 ${FOCUS}`}
                >
                  <FolderOpen size={12} aria-hidden />
                  {importOpen ? 'Hide export import' : 'Import a data export…'}
                </button>
              </div>
            )}
          </div>
        </div>

        {sync.available && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Sync status">
            {PROVIDERS.map((p) => (
              <SyncChip key={p} provider={p} status={sync.statuses[p]} onLogin={sync.login} />
            ))}
          </div>
        )}
        {problems.map((line) => (
          <p key={line} className="text-xs text-red-300">
            {line}
          </p>
        ))}

        {importShown && (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              void runImport(importPath);
            }}
          >
            <input
              aria-label="Folder of the unpacked export"
              value={importPath}
              onChange={(e) => setImportPath(e.target.value)}
              placeholder="Folder of the unpacked export"
              className={`${SELECT_CLS} !max-w-none flex-1 min-w-0`}
            />
            {window.electronAPI?.showOpenDialog && (
              <button
                type="button"
                onClick={chooseFolder}
                className={ICON_BTN}
                title="Choose folder"
              >
                <FolderOpen size={12} aria-hidden /> Choose…
              </button>
            )}
            <button
              type="submit"
              disabled={importing || !importPath.trim()}
              className={`${ICON_BTN} disabled:opacity-50 disabled:hover:bg-transparent`}
            >
              {importing ? 'Importing…' : 'Import'}
            </button>
          </form>
        )}

        <div className="flex items-center gap-1.5 text-xs">
          <label className="flex items-center gap-1 flex-1 min-w-0">
            <Search size={12} className="text-gray-400 shrink-0" aria-hidden />
            <input
              type="search"
              aria-label="Search chats"
              value={q}
              onChange={(e) => filter(setQ)(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  rows()[0]?.focus();
                } else if (e.key === 'Enter') {
                  rows()[0]?.click();
                }
              }}
              placeholder="Search titles and messages"
              className={`${SELECT_CLS} !max-w-none w-full`}
            />
          </label>
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            className={`${ICON_BTN} ${extraFilters ? 'text-blue-300' : ''}`}
            title="Folder, archive, project, topic, period, grouping"
          >
            <SlidersHorizontal size={12} aria-hidden />
            Filters{extraFilters ? ` (${extraFilters})` : ''}
          </button>
        </div>
        <div role="group" aria-label="Provider" className="flex items-center gap-1 text-xs">
          {([null, ...SOURCES] as (ChatSource | null)[]).map((p) => (
            <button
              key={p ?? 'all'}
              type="button"
              aria-pressed={provider === p}
              onClick={() => filter(setProvider)(p)}
              className={`px-2 py-0.5 rounded border ${FOCUS} ${provider === p ? 'border-blue-500/60 bg-blue-500/15 text-blue-200' : 'border-gray-700 text-gray-300 hover:text-white hover:bg-gray-800'}`}
            >
              {p ? PROVIDER_LABEL[p] : 'All'}
            </button>
          ))}
        </div>
        {filtersOpen && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Filter
              label="Folder"
              value={folder}
              options={Object.fromEntries(
                (data?.folders ?? []).map((f) => [f.id, `${f.name} (${f.count})`])
              )}
              onChange={filter(setFolder)}
            />
            <label className="flex items-center gap-1 text-gray-300">
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => filter(setArchived)(e.target.checked)}
              />
              Archived only
            </label>
            <Filter
              label="Project"
              value={project}
              options={Object.fromEntries(
                (data?.projects ?? []).map((p) => [p.id, `${p.name} (${p.count})`])
              )}
              onChange={filter(setProject)}
            />
            <Filter
              label="Topic"
              value={topic}
              options={Object.fromEntries(
                (data?.topics ?? []).map((t) => [t.id, `${t.name} (${t.count})`])
              )}
              onChange={filter(setTopic)}
            />
            <input
              type="date"
              aria-label="Active from"
              value={from}
              onChange={(e) => filter(setFrom)(e.target.value)}
              className={SELECT_CLS}
            />
            <input
              type="date"
              aria-label="Active until"
              value={to}
              onChange={(e) => filter(setTo)(e.target.value)}
              className={SELECT_CLS}
            />
            <label className="flex items-center gap-1 text-gray-300">
              <input
                type="checkbox"
                checked={grouped}
                onChange={(e) => setGrouped(e.target.checked)}
              />
              Group by topic
            </label>
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-red-300">
            {error}
          </p>
        )}
        {report && (
          <ul aria-label="Import result" className="text-xs text-gray-400">
            {report.files.map((file, i) => (
              <li key={i}>{reportLine(file)}</li>
            ))}
          </ul>
        )}
      </div>

      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-auto thin-scrollbar"
        onKeyDown={onListKey}
        aria-label="Chat list"
      >
        {empty ? (
          sync.available ? (
            <div className="px-3 py-6 text-sm text-gray-400 space-y-2">
              {syncing ? (
                <p>Fetching your conversations…</p>
              ) : (
                <>
                  <p>No chats yet.</p>
                  <p>
                    Log in to claude.ai or chatgpt.com with the buttons above; your conversations
                    then appear here and stay on this machine.
                  </p>
                  <p>Or start one without a project: New chat.</p>
                </>
              )}
            </div>
          ) : (
            <div className="px-3 py-6 text-sm text-gray-400 space-y-2">
              <p>No chats imported yet.</p>
              <p>
                Request your data export (claude.ai: Settings → Privacy → Export data; ChatGPT:
                Settings → Data controls → Export data), unpack the ZIP from the mail and import its
                folder above. The files are read and searched on this machine only.
              </p>
              <p>Or start one without a project: New chat.</p>
            </div>
          )
        ) : data && items.length === 0 ? (
          <p className="px-3 py-6 text-sm text-gray-400">No chats match</p>
        ) : (
          groups.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <h3 className="sticky top-0 z-[1] px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-400 bg-gray-950/95 border-b border-gray-800 flex items-center gap-2">
                {group.label}
                <span className="text-gray-400 tabular-nums">{group.items.length}</span>
              </h3>
              <ul>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      data-chat-row
                      onClick={() => openConversation(item.id)}
                      aria-current={open?.id === item.id || undefined}
                      title={item.projectName ? `${item.title} · ${item.projectName}` : item.title}
                      className={`w-full text-left px-3 py-1.5 hover:bg-gray-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cursor ${open?.id === item.id ? 'bg-gray-800' : ''}`}
                    >
                      <span className="flex items-center gap-2">
                        <ProviderBadge provider={item.provider} />
                        {item.pinned && (
                          <Pin size={11} className="shrink-0 text-gray-400" aria-label="Pinned" />
                        )}
                        <span className="truncate flex-1 text-sm text-gray-100">{item.title}</span>
                        {item.folder && (
                          <span className="shrink-0 max-w-[6rem] truncate text-[10px] text-gray-400">
                            {item.folder}
                          </span>
                        )}
                        <time
                          dateTime={
                            item.updatedAt ? new Date(item.updatedAt).toISOString() : undefined
                          }
                          className="shrink-0 text-[11px] text-gray-400 tabular-nums"
                        >
                          {relativeTime(item.updatedAt, now)}
                        </time>
                      </span>
                      {q && item.snippet && (
                        <span className="mt-0.5 block truncate text-xs text-gray-400">
                          {item.snippet}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        {data && data.total > items.length && (
          <button onClick={() => setLimit((n) => n + PAGE)} className={`${ICON_BTN} m-2`}>
            Show more ({data.total - items.length} left)
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div aria-label="Chats" className="absolute inset-0 flex min-h-0 bg-gray-900" data-chat-history>
      {outlet && wide ? (
        createPortal(rail, outlet)
      ) : (
        <div className="w-[22rem] max-w-[45%] shrink-0 flex flex-col min-h-0 border-r border-gray-800 bg-gray-950/40">
          {rail}
        </div>
      )}

      <div className="flex-1 min-w-0 overflow-auto" aria-label="Conversation">
        {!open ? (
          <p className="px-4 py-6 text-sm text-gray-400">
            {items.length > 0 ? 'Pick a chat on the left to read it.' : ''}
          </p>
        ) : (
          <article className="max-w-3xl mx-auto px-4 py-3">
            <header className="flex flex-wrap items-start gap-2 pb-3 mb-1 border-b border-gray-800">
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
                  <h2 className="text-base font-medium text-gray-100">{open.title}</h2>
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
                      suggestions={(data?.folders ?? []).map((f) => f.name)}
                      maxLength={60}
                      onSave={(name) => void mark({ folder: name.trim() || null })}
                      onCancel={() => setEditing(null)}
                    />
                  </div>
                )}
              </div>
              <div role="group" className="flex flex-wrap items-center gap-1" aria-label="Chat actions">
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
              </div>
              {isWebProvider(open.provider) ? (
                <>
                  <button
                    type="button"
                    onClick={() => openInSystemBrowser(conversationUrl(open) ?? '')}
                    className={`${ICON_BTN} border border-gray-700`}
                    title="Opens the conversation in the system browser"
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
                </>
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
            </header>
            {open.messages.map((message, i) =>
              message.role === 'user' ? (
                <div key={i} className="flex justify-end my-3">
                  <div className="max-w-[85%] rounded-lg bg-blue-900/50 border border-blue-800/60 px-3 py-2 text-sm text-gray-100 whitespace-pre-wrap break-words">
                    {message.text}
                  </div>
                </div>
              ) : (
                <div key={i} className="my-3">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">
                    {open.harness ? harnessLabel(open.harness) : PROVIDER_LABEL[open.provider]}
                  </div>
                  <ChatMarkdown text={message.text} />
                </div>
              )
            )}
          </article>
        )}
      </div>
    </div>
  );
};
