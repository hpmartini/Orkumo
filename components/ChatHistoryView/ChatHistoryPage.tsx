import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, History, MessageSquarePlus, Search } from 'lucide-react';
import {
  fetchChatConversation,
  fetchChatHistory,
  importChatExport,
  type ChatHistoryConversation,
  type ChatHistoryItem,
  type ChatHistoryList,
  type ChatImportReport,
  type ChatProvider,
} from '../../services/chatHistoryApi';
import {
  PROVIDER_HARNESS,
  PROVIDER_LABEL,
  continuePrompt,
  dayBound,
} from '../../utils/chatHistory';
import { Filter, ICON_BTN, SELECT_CLS } from '../AgentsView/PullRequestsPage';

const PAGE = 200;
const PROVIDER_CLS: Record<ChatProvider, string> = {
  claude: 'bg-orange-500/15 text-orange-300',
  chatgpt: 'bg-emerald-500/15 text-emerald-300',
};

const day = (time: number | null) =>
  time ? new Date(time).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';

const ProviderBadge: React.FC<{ provider: ChatProvider }> = ({ provider }) => (
  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${PROVIDER_CLS[provider]}`}>
    {PROVIDER_LABEL[provider]}
  </span>
);

const reportLine = (file: ChatImportReport['files'][number]) => {
  const skipped = Object.entries(file.skipped)
    .map(([reason, count]) => `${count} ${reason}`)
    .join(', ');
  const source = file.provider ? PROVIDER_LABEL[file.provider] : (file.error ?? 'Unknown format');
  return `${file.file} (${source}): ${file.imported} of ${file.found} imported${skipped ? `, skipped: ${skipped}` : ''}`;
};

/**
 * Chats mode (#280): the conversations of imported claude.ai / ChatGPT data exports in one
 * list, by last activity. Search, filters and topics are answered by the server; a
 * conversation opens to the right and can be carried into a new Orkumo chat.
 */
export const ChatHistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [provider, setProvider] = useState<ChatProvider | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [grouped, setGrouped] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [data, setData] = useState<ChatHistoryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ChatHistoryConversation | null>(null);
  const [importPath, setImportPath] = useState('');
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ChatImportReport | null>(null);
  const [imports, setImports] = useState(0);
  const latest = useRef(0);

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
  }, [q, provider, project, topic, from, to, limit, imports]);

  const openConversation = useCallback((id: string) => {
    fetchChatConversation(id)
      .then(setOpen)
      .catch((e: Error) => setError(e.message));
  }, []);

  const runImport = async (path: string) => {
    if (!path.trim() || importing) return;
    setImporting(true);
    setReport(null);
    try {
      setReport(await importChatExport(path));
      setError(null);
      setImports((n) => n + 1);
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
  const items = data?.items ?? [];
  const groups: { label: string | null; items: ChatHistoryItem[] }[] = grouped
    ? (data?.topics ?? [])
        .map((t) => ({ label: t.name, items: items.filter((i) => i.topic === t.id) }))
        .filter((g) => g.items.length > 0)
    : [{ label: null, items }];
  const empty = data && data.counts.claude + data.counts.chatgpt === 0;

  return (
    <div
      aria-label="Chats"
      className="absolute inset-0 flex flex-col min-h-0 bg-gray-900"
      data-chat-history
    >
      <div className="px-3 py-2 border-b border-gray-800 shrink-0 space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <History size={14} className="text-gray-400" aria-hidden />
          <span className="font-medium">Chats</span>
          {data && (
            <span className="text-gray-500 tabular-nums text-xs" data-testid="chat-counts">
              {data.total} matching · Claude {data.counts.claude} · ChatGPT {data.counts.chatgpt}
            </span>
          )}
          <div className="flex-1" />
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
              className={`${SELECT_CLS} !max-w-none w-64`}
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
            <button type="submit" disabled={importing || !importPath.trim()} className={ICON_BTN}>
              {importing ? 'Importing…' : 'Import'}
            </button>
          </form>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1 flex-1 min-w-[12rem]">
            <Search size={12} className="text-gray-500" aria-hidden />
            <input
              type="search"
              aria-label="Search chats"
              value={q}
              onChange={(e) => filter(setQ)(e.target.value)}
              placeholder="Search titles and messages"
              className={`${SELECT_CLS} !max-w-none w-full`}
            />
          </label>
          <Filter
            label="Provider"
            value={provider}
            options={PROVIDER_LABEL}
            onChange={(v) => filter(setProvider)(v as ChatProvider | null)}
          />
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
        {error && (
          <p role="alert" className="text-xs text-red-400">
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

      <div className="flex-1 min-h-0 flex">
        <div className="w-[26rem] max-w-[45%] shrink-0 overflow-auto border-r border-gray-800">
          {empty ? (
            <div className="px-3 py-6 text-sm text-gray-400 space-y-2">
              <p>No chats imported yet.</p>
              <p>
                Request your data export (claude.ai: Settings → Privacy → Export data; ChatGPT:
                Settings → Data controls → Export data), unpack the ZIP from the mail and import its
                folder above. The files are read and searched on this machine only.
              </p>
            </div>
          ) : data && items.length === 0 ? (
            <p className="px-3 py-6 text-sm text-gray-500">No chats match</p>
          ) : (
            groups.map((group) => (
              <section key={group.label ?? 'all'} aria-label={group.label ?? 'Chats'}>
                {group.label && (
                  <h3 className="sticky top-0 z-[1] px-3 py-1 text-xs font-medium text-gray-400 bg-gray-900/95 border-b border-gray-800 flex items-center gap-2">
                    {group.label}
                    <span className="text-gray-600 tabular-nums">{group.items.length}</span>
                  </h3>
                )}
                <ul className="divide-y divide-gray-800/70">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <button
                        onClick={() => openConversation(item.id)}
                        aria-current={open?.id === item.id || undefined}
                        className={`w-full text-left px-3 py-2 hover:bg-gray-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor ${open?.id === item.id ? 'bg-gray-800' : ''}`}
                      >
                        <span className="flex items-center gap-2">
                          <ProviderBadge provider={item.provider} />
                          <span className="truncate flex-1 text-sm text-gray-100">
                            {item.title}
                          </span>
                          <span className="shrink-0 text-[10px] text-gray-500">
                            {day(item.updatedAt)}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-gray-500">
                          {item.snippet}
                        </span>
                        <span className="mt-0.5 flex gap-2 text-[10px] text-gray-600">
                          <span>{item.topic}</span>
                          {item.projectName && <span>· {item.projectName}</span>}
                          <span>· {item.messageCount} messages</span>
                        </span>
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

        <div className="flex-1 min-w-0 overflow-auto" aria-label="Conversation">
          {!open ? (
            <p className="px-4 py-6 text-sm text-gray-500">Pick a chat to read it.</p>
          ) : (
            <article className="px-4 py-3 space-y-3">
              <header className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-medium text-gray-100">{open.title}</h2>
                  <p className="text-xs text-gray-500 flex items-center gap-2 mt-1">
                    <ProviderBadge provider={open.provider} />
                    {day(open.createdAt)} – {day(open.updatedAt)}
                    {open.projectName && <span>· {open.projectName}</span>}
                  </p>
                </div>
                <button
                  onClick={() =>
                    navigate('/agents', {
                      state: {
                        dispatch: continuePrompt(open),
                        mode: 'chat',
                        harness: PROVIDER_HARNESS[open.provider],
                      },
                    })
                  }
                  className={`${ICON_BTN} border border-gray-700`}
                  title="Opens a new Orkumo chat with this conversation as its start, on the same subscription (Claude Code or Codex)"
                >
                  <MessageSquarePlus size={12} aria-hidden /> Continue in Orkumo
                </button>
              </header>
              {open.messages.map((message, i) => (
                <div
                  key={i}
                  className={`rounded px-3 py-2 text-sm whitespace-pre-wrap break-words ${message.role === 'user' ? 'bg-gray-800 text-gray-100' : 'text-gray-300'}`}
                >
                  <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
                    {message.role === 'user' ? 'You' : PROVIDER_LABEL[open.provider]}
                  </div>
                  {message.text}
                </div>
              ))}
            </article>
          )}
        </div>
      </div>
    </div>
  );
};
