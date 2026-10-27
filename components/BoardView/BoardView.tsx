import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, RefreshCw, Search, X } from 'lucide-react';
import type { AgentSession, BoardItem, BoardSliceKind, BoardSwimlaneMode } from '../../types';
import {
  boardColumns,
  buildLanes,
  buildSlices,
  deriveAgentLinks,
  filterItems,
  isDoneOption,
  itemKey,
  linksByAgent,
  linksByIssue,
  matchesContextFilter,
  matchesQuery,
  resolveRepoSlice,
} from '../../utils/board';
import { useAgentSessions } from '../../hooks/useAgentSessions';
import { fetchRepoPath } from '../../services/boardApi';
import { fetchAgentContexts } from '../../services/agentsApi';
import { codeUrl, linkedAgentFolder } from '../../utils/codeTarget';
import { useBoard } from './useBoard';
import { BoardGrid } from './BoardGrid';
import { BoardItemPanel } from './BoardItemPanel';
import { IssueCreateModal, lastIssueRepo } from './IssueCreateModal';

interface BoardViewProps {
  /** Whether the view is visible (drives polling, URL state and keyboard handling) */
  active: boolean;
  /** Make this view the visible route */
  onOpenView?: () => void;
  /** Board filter of the active project context (slice keys) */
  contextFilter?: string[];
}

interface ViewPrefs {
  sliceKind: BoardSliceKind;
  selected: string | null;
  laneMode: BoardSwimlaneMode;
}

const VIEW_KEY = 'devOrbitBoardView';
const DEFAULT_VIEW: ViewPrefs = { sliceKind: 'repo', selected: null, laneMode: 'parent' };
const SLICE_KINDS: BoardSliceKind[] = ['repo', 'label', 'milestone', 'assignee'];
const LANE_MODES: { key: BoardSwimlaneMode; label: string }[] = [
  { key: 'parent', label: 'Parent issue' },
  { key: 'repo', label: 'Repository' },
  { key: 'none', label: 'Keine' },
];
const EMPTY_PREFS = { favorites: [] as string[], order: [] as string[], hidden: [] as string[] };

function loadView(): ViewPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
    if (
      SLICE_KINDS.includes(v?.sliceKind) &&
      LANE_MODES.some((m) => m.key === v?.laneMode) &&
      (v.selected === null || typeof v.selected === 'string')
    )
      return v;
  } catch {
    // unavailable or corrupt storage: use the default
  }
  return DEFAULT_VIEW;
}

/**
 * Kanban board over a GitHub Project (status columns, parent swimlanes),
 * linked to the Claude agents working on its issues.
 */
export const BoardView: React.FC<BoardViewProps> = ({ active, contextFilter }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const {
    data,
    settings,
    loading,
    error,
    refresh,
    moveItem,
    upsertItem,
    editIssue,
    updateSettings,
  } = useBoard(active);
  // Column whose "+ Issue" was clicked (status option id, '' = default)
  const [createIn, setCreateIn] = useState<string | null>(null);
  // The always-mounted rail already raises the agent notifications
  const { sessions } = useAgentSessions({ active, notify: false });
  const [view, setView] = useState<ViewPrefs>(loadView);
  const [query, setQuery] = useState('');

  const updateView = (patch: Partial<ViewPrefs>) => {
    const next = { ...view, ...patch };
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(next));
    } catch {
      // stays in memory only
    }
  };

  // Kept mounted on other routes: their query params are not ours
  const openKey = active ? searchParams.get('item') : null;
  const agentFilter = active ? searchParams.get('agent') : null;
  const setParam = useCallback(
    (name: 'item' | 'agent', value: string | null) =>
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(name, value);
        else next.delete(name);
        return next;
      }),
    [setSearchParams]
  );

  const items = useMemo(
    () => (data?.items ?? []).filter((i) => matchesContextFilter(i, contextFilter ?? [])),
    [data, contextFilter]
  );
  const options = useMemo(() => data?.statusField.options ?? [], [data]);
  const repos = useMemo(
    () => [...new Set(items.flatMap((i) => (i.repo ? [i.repo] : [])))].sort(),
    [items]
  );
  const prefs = settings ?? EMPTY_PREFS;
  const { sliceKind, selected, laneMode } = view;

  const links = useMemo(() => deriveAgentLinks(items, sessions), [items, sessions]);
  const agentsByIssue = useMemo(() => linksByIssue(links), [links]);
  const issuesByAgent = useMemo(() => linksByAgent(links), [links]);
  const sessionsById = useMemo(
    // Links carry the job id or the first 8 chars of the session UUID (mw-board)
    () =>
      new Map<string, AgentSession>(
        sessions.flatMap((s) => [
          ...(s.sessionId ? [[s.sessionId.slice(0, 8), s] as const] : []),
          [s.id, s] as const,
        ])
      ),
    [sessions]
  );

  const slices = useMemo(() => buildSlices(items, sliceKind, prefs), [items, sliceKind, prefs]);
  const scoped = useMemo(
    () => filterItems(items, { kind: sliceKind, selected, hidden: prefs.hidden }),
    [items, sliceKind, selected, prefs.hidden]
  );
  const visible = useMemo(() => {
    const byAgent = agentFilter
      ? filterItems(items, {
          kind: sliceKind,
          selected,
          hidden: prefs.hidden,
          agentIssueKeys: new Set(issuesByAgent.get(agentFilter) ?? []),
        })
      : scoped;
    return query.trim() ? byAgent.filter((i) => matchesQuery(i, query)) : byAgent;
  }, [agentFilter, scoped, issuesByAgent, items, sliceKind, selected, prefs.hidden, query]);

  const columns = useMemo(() => boardColumns(options, visible), [options, visible]);
  const lanes = useMemo(
    () => buildLanes(visible, laneMode, new Set(options.filter(isDoneOption).map((o) => o.id))),
    [visible, laneMode, options]
  );
  // Done window is measured from the GitHub fetch, so it moves with polling
  const now = data?.fetchedAt ?? 0;

  const openItem = openKey ? items.find((i) => itemKey(i) === openKey) : undefined;
  const missingWarned = useRef<string | null>(null);
  useEffect(() => {
    if (!openKey || !data || openItem || missingWarned.current === openKey) return;
    missingWarned.current = openKey;
    toast(`${openKey} ist nicht auf dem Board`);
  }, [openKey, data, openItem]);

  // ?repo=<slug or folder name> (View board on a project): select that repo's slice once per
  // navigation, so a repeated View board resets a slice the user changed by hand
  const repoParam = active ? searchParams.get('repo') : null;
  const repoApplied = useRef<string | null>(null);
  useEffect(() => {
    if (!repoParam) repoApplied.current = null;
    if (!repoParam || !data || repoApplied.current === location.key) return;
    repoApplied.current = location.key;
    const slice = resolveRepoSlice(repos, repoParam);
    if (slice) updateView({ sliceKind: 'repo', selected: slice });
    else toast(`${repoParam} hat keine Items auf dem Board`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updateView only wraps setView
  }, [repoParam, location.key, data, repos]);

  const closePanel = useCallback(() => setParam('item', null), [setParam]);

  const onAgent = (jobId: string) => setParam('agent', agentFilter === jobId ? null : jobId);
  const filterAgent = agentFilter ? (sessionsById.get(agentFilter)?.name ?? agentFilter) : null;

  return (
    <div className="relative flex flex-1 h-full min-h-0 bg-gray-900">
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center gap-3 px-4 h-12 border-b border-gray-700 bg-gray-900 shrink-0">
          <h1 className="text-[15px] font-semibold text-white flex items-center gap-2 min-w-0">
            <span className="truncate">{selected ?? 'Alle'}</span>
            <span className="text-xs font-normal text-gray-400 shrink-0">
              {visible.length} Items
            </span>
          </h1>
          {filterAgent && (
            <button
              onClick={() => setParam('agent', null)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-sel text-white text-xs hover:bg-gray-750 min-w-0"
              aria-label={`Filter Agent ${filterAgent} entfernen`}
            >
              <span className="truncate">Agent: {filterAgent}</span>
              <X size={12} className="shrink-0" />
            </button>
          )}
          <div className="flex-1" />
          <label className="flex items-center gap-1.5 text-xs text-gray-400">
            Slice
            <select
              value={sliceKind}
              onChange={(e) =>
                updateView({ sliceKind: e.target.value as BoardSliceKind, selected: null })
              }
              aria-label="Slice-Art"
              className="bg-gray-850 border border-gray-700 rounded px-2 py-1 text-gray-200 text-xs"
            >
              {SLICE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <select
              value={selected ?? ''}
              onChange={(e) => updateView({ selected: e.target.value || null })}
              aria-label="Slice"
              className="bg-gray-850 border border-gray-700 rounded px-2 py-1 text-gray-200 text-xs max-w-48"
            >
              <option value="">Alle</option>
              {[...slices.favorites, ...slices.others].map((e) => (
                <option key={e.key} value={e.value}>
                  {e.value} ({e.count})
                </option>
              ))}
            </select>
          </label>
          {prefs.hidden.length > 0 && (
            <button
              onClick={() => updateSettings({ hidden: [] })}
              className="text-xs text-gray-400 hover:text-white underline underline-offset-2"
              title="Die Auswahl blendet Slices aus; zurücksetzen"
            >
              {prefs.hidden.length} ausgeblendet · alle zeigen
            </button>
          )}
          {error && data && (
            <span className="flex items-center gap-1 text-xs text-red-300" title={error}>
              <AlertTriangle size={12} /> Aktualisierung fehlgeschlagen
            </span>
          )}
          <label className="flex items-center gap-1.5 text-xs text-gray-400">
            Swimlanes
            <select
              value={laneMode}
              onChange={(e) => updateView({ laneMode: e.target.value as BoardSwimlaneMode })}
              className="bg-gray-850 border border-gray-700 rounded px-2 py-1 text-gray-200 text-xs"
            >
              {LANE_MODES.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              placeholder="Filtern: Titel, #Nr, label:ui"
              aria-label="Board filtern"
              className="w-56 bg-gray-850 border border-gray-700 rounded pl-7 pr-2 py-1 text-xs text-gray-100 placeholder:text-gray-400 focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-60"
            title={
              data
                ? `Quelle: ${data.title} (${data.source.owner}/projects/${data.source.number}). Neu von GitHub laden`
                : 'Neu laden'
            }
          >
            <RefreshCw size={12} className={loading ? 'motion-safe:animate-spin' : ''} />
            {data
              ? `${data.title} · ${new Date(data.fetchedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
              : 'Laden'}
          </button>
        </header>

        <div className="flex-1 overflow-auto thin-scrollbar">
          {!data ? (
            <div className="px-4 py-16 text-center text-sm text-gray-400">
              {error ? (
                <>
                  <p className="text-red-300">Board konnte nicht geladen werden: {error}</p>
                  <button
                    onClick={refresh}
                    className="mt-3 text-cursor hover:underline underline-offset-2"
                  >
                    Erneut versuchen
                  </button>
                </>
              ) : (
                'Lade Board von GitHub …'
              )}
            </div>
          ) : (
            <BoardGrid
              columns={columns}
              options={options}
              lanes={lanes}
              laneMode={laneMode}
              now={now}
              selectedKey={openKey}
              hideRepo={(item: BoardItem) => sliceKind === 'repo' && selected === item.repo}
              agentsByIssue={agentsByIssue}
              sessionsById={sessionsById}
              onOpen={(item) => setParam('item', itemKey(item))}
              onAgent={onAgent}
              onMove={moveItem}
              onCreate={(optionId) => setCreateIn(optionId)}
              onReset={() => {
                updateView({ selected: null });
                setParam('agent', null);
              }}
            />
          )}
        </div>
      </main>

      {createIn !== null && (
        <IssueCreateModal
          repo={
            sliceKind === 'repo' && selected && repos.includes(selected)
              ? selected
              : lastIssueRepo(repos)
          }
          repos={repos}
          statusOptions={options}
          statusOptionId={createIn || undefined}
          onClose={() => setCreateIn(null)}
          onCreated={(item) => {
            upsertItem(item);
            setParam('item', itemKey(item));
          }}
        />
      )}

      {openItem && (
        <BoardItemPanel
          item={openItem}
          items={items}
          options={options}
          links={links.filter((l) => l.issueKey === openKey)}
          sessionsById={sessionsById}
          onClose={closePanel}
          onStatus={(optionId) => moveItem(openItem.itemId, optionId)}
          onSave={(patch, optimistic) => editIssue(openItem.itemId, patch, optimistic)}
          onOpenKey={(key) => setParam('item', key)}
          onAttach={(jobId) => navigate(`/agents?attach=${encodeURIComponent(jobId)}`)}
          onStartAgent={async (it) => {
            // No local checkout found (or lookup failed): composer keeps its own directory
            const cwd = it.repo ? await fetchRepoPath(it.repo).catch(() => null) : null;
            navigate('/agents', { state: { dispatch: `Bearbeite ${it.url} `, cwd } });
          }}
          onOpenCode={async (jobIds) => {
            const repo = openItem.repo;
            // An agent's cwd can be the main checkout while it works in a worktree
            const contexts = jobIds.length ? await fetchAgentContexts().catch(() => ({})) : {};
            const folder =
              linkedAgentFolder(jobIds, sessionsById, contexts) ??
              (repo ? await fetchRepoPath(repo).catch(() => null) : null);
            if (folder) navigate(codeUrl(folder));
            else toast.error(`Kein lokaler Checkout von ${repo ?? 'diesem Issue'} gefunden`);
          }}
          onAgentIssues={(jobId) =>
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              next.delete('item');
              next.set('agent', jobId);
              return next;
            })
          }
        />
      )}
    </div>
  );
};
