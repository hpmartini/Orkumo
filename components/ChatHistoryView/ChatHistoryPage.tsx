import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  FolderOpen,
  History,
  LogIn,
  MoreHorizontal,
  Pin,
  RefreshCw,
  Search,
  SlidersHorizontal,
  SquarePen,
} from 'lucide-react';
import {
  fetchChatHistory,
  importChatExport,
  type ChatHistoryItem,
  type ChatHistoryList,
  type ChatImportReport,
  type ChatProvider,
  type ChatSource,
} from '../../services/chatHistoryApi';
import type { ChatSyncResult, ChatSyncStatus } from '../../electron/electron';
import { PROVIDER_LABEL, PROVIDER_LOGIN, PROVIDER_SITE, dayBound } from '../../utils/chatHistory';
import { RECENCY, recencyOf, relativeTime } from '@hpmartini/agents-ui/utils/chatHistory';
import { openInSystemBrowser, openLink } from '@hpmartini/agents-ui/utils/links';
import {
  Filter,
  ICON_BTN,
  SELECT_CLS,
} from '@hpmartini/agents-ui/components/AgentsView/PullRequestsPage';
import { RailOutletContext } from '@hpmartini/agents-ui/components/AgentsView/railOutlet';
import { AgentWorkspace } from '@hpmartini/agents-ui/components/AgentsView/AgentWorkspace';
import { ChatReader, ProviderBadge } from './ChatReader';
import { historyChatId, useChatTabs } from './useChatTabs';

const PAGE = 200;
// Low rate on purpose (the providers' terms, the user's account): once on opening, then this often
const SYNC_EVERY_MS = 5 * 60_000;
/** After a prompt was sent on the provider's page: one sync when the answer is likely complete */
const ANSWER_SYNC_MS = 45_000;
const PROVIDERS: ChatProvider[] = ['claude', 'chatgpt'];
/** The list's sources: the synced providers plus the chats started in Orkumo (#19 AK-4) */
const SOURCES: ChatSource[] = [...PROVIDERS, 'orkumo'];
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor';
const CHIP = 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] border';

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
  const tabs = useChatTabs();
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
  // new data from the providers (sync, import): open chats refetch, a pin or rename does not
  const [arrivals, setArrivals] = useState(0);
  const arrived = useCallback(() => {
    reload();
    setArrivals((n) => n + 1);
  }, [reload]);
  const sync = useChatSync(arrived);

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

  /** "New chat" (#19 AK-1): the chat composer in the chats folder, no project to pick */
  const newChat = () =>
    navigate('/agents', { state: { dispatch: '', mode: 'chat', place: 'chats' } });

  // A prompt sent on the provider's page: fetch the answer once it had time to arrive
  const syncSoon = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(syncSoon.current), []);
  const afterSend = () => {
    clearTimeout(syncSoon.current);
    syncSoon.current = window.setTimeout(sync.run, ANSWER_SYNC_MS);
  };

  const runImport = async (path: string) => {
    if (!path.trim() || importing) return;
    setImporting(true);
    setReport(null);
    try {
      setReport(await importChatExport(path));
      setError(null);
      arrived();
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
  // pinned chats in a section of their own on top, the rest by topic or by recency
  const rest = items.filter((i) => !i.pinned);
  const groups: { label: string; items: ChatHistoryItem[] }[] = [
    { label: 'Pinned', items: items.filter((i) => i.pinned) },
    ...(grouped
      ? (data?.topics ?? []).map((t) => ({
          label: t.name,
          items: rest.filter((i) => i.topic === t.id),
        }))
      : RECENCY.map((label) => ({
          label,
          items: rest.filter((i) => recencyOf(i.updatedAt, now) === label),
        }))),
  ].filter((g) => g.items.length > 0);
  const empty =
    data && !archived && data.counts.claude + data.counts.chatgpt + data.counts.orkumo === 0;
  const importShown = importOpen || !sync.available;
  const syncing = sync.running || PROVIDERS.some((p) => sync.statuses[p]?.status === 'syncing');
  const allSynced = !syncing && PROVIDERS.every((p) => sync.statuses[p]?.status === 'ok');
  const extraFilters =
    [project, topic, folder, from, to].filter(Boolean).length +
    (grouped ? 1 : 0) +
    (archived ? 1 : 0);
  const problems = PROVIDERS.flatMap((p) => {
    const s = sync.statuses[p];
    return s?.reason && (s.status === 'error' || s.status === 'unavailable')
      ? [`${PROVIDER_LABEL[p]}: ${s.reason}`]
      : [];
  });

  const rail = (
    <div className="flex flex-col min-h-0 h-full" data-chat-rail>
      <div className="px-3 pt-2 pb-2 border-b border-gray-800 shrink-0 space-y-2">
        <div className="flex items-center gap-1 text-sm">
          <History size={14} className="text-gray-400" aria-hidden />
          <h2 className="font-medium text-gray-100 mr-auto">Chats</h2>
          {sync.available && (
            <button
              type="button"
              onClick={sync.run}
              disabled={syncing}
              className={`${ICON_BTN} disabled:opacity-50 disabled:hover:bg-transparent`}
              title={syncing ? 'Syncing…' : 'Fetch new and changed conversations now'}
              aria-label="Sync now"
            >
              <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} aria-hidden />
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
          <button
            type="button"
            onClick={newChat}
            className={`ml-1 inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 ${FOCUS}`}
            title="New chat without a project (Claude Code, Codex or Oh My Pi), in its own folder"
            aria-label="New chat"
          >
            <SquarePen size={12} aria-hidden /> New chat
          </button>
        </div>

        {sync.available && !allSynced && (
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
          <label className="relative flex items-center flex-1 min-w-0">
            <Search
              size={12}
              className="pointer-events-none absolute left-2 text-gray-400"
              aria-hidden
            />
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
              className={`${SELECT_CLS} !max-w-none w-full !pl-6`}
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
        <div
          role="group"
          aria-label="Provider"
          className="flex items-center gap-0.5 rounded-md bg-gray-900 p-0.5 text-xs"
          data-testid="chat-counts"
        >
          {([null, ...SOURCES] as (ChatSource | null)[]).map((p) => (
            <button
              key={p ?? 'all'}
              type="button"
              aria-pressed={provider === p}
              onClick={() => filter(setProvider)(p)}
              className={`flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 ${FOCUS} ${provider === p ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-gray-100'}`}
            >
              {p ? PROVIDER_LABEL[p] : 'All'}{' '}
              {data && (
                <span className="tabular-nums text-[10px] text-gray-400">
                  {p ? data.counts[p] : SOURCES.reduce((n, s) => n + data.counts[s], 0)}
                </span>
              )}
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
                {group.label === 'Pinned' && <Pin size={10} aria-hidden />}
                {group.label}
                <span className="text-gray-400 tabular-nums">{group.items.length}</span>
              </h3>
              <ul>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      data-chat-row
                      onClick={() => tabs.open(item.id, item.title)}
                      aria-current={tabs.current === item.id || undefined}
                      title={item.projectName ? `${item.title} · ${item.projectName}` : item.title}
                      className={`w-full text-left px-3 py-1.5 hover:bg-gray-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cursor ${tabs.current === item.id ? 'bg-gray-800' : ''}`}
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

      <div className="flex-1 min-w-0 min-h-0">
        <AgentWorkspace
          sessions={tabs.sessions}
          workspace={tabs.workspace}
          onActivateTab={tabs.activateTab}
          onFocusPane={tabs.focus}
          onClosePane={tabs.close}
          onCloseTab={tabs.closeTab}
          onMoveTab={tabs.moveTab}
          onSplit={tabs.split}
          onDetach={tabs.detach}
          onSetLayout={tabs.setLayout}
          onPeek={() => {}}
          focusZone="terminal"
          emptyState={
            <p className="px-4 py-6 text-sm text-gray-400">
              {items.length > 0
                ? 'Pick a chat on the left to read it. Each chat opens in its own tab; drag a tab onto another to see chats side by side.'
                : ''}
            </p>
          }
          paneNoun="chats"
          renderCustomPane={(session, pane) => {
            const id = historyChatId(session.id);
            return id === null ? null : (
              <ChatReader
                key={id}
                id={id}
                version={arrivals}
                folders={(data?.folders ?? []).map((f) => f.name)}
                {...pane}
                onChanged={(item) => {
                  reload();
                  tabs.retitle(item.id, item.title);
                }}
                onOpenSite={(url) =>
                  // the providers refuse to be framed: the web app hands them to the system browser
                  window.electronAPI?.browserView
                    ? tabs.openSite(session.id, url)
                    : openInSystemBrowser(url)
                }
                onSent={afterSend}
              />
            );
          }}
        />
      </div>
    </div>
  );
};
