import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, Eye, EyeOff, RefreshCw, Search, Star } from 'lucide-react';
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
  sliceFromRepoParam,
  type SliceEntry,
} from '../../utils/board';
import { useAgentSessions } from '../../hooks/useAgentSessions';
import { fetchRepoPath } from '../../services/boardApi';
import { fetchAgentContexts } from '../../services/agentsApi';
import { codeUrl, linkedAgentFolder } from '../../utils/codeTarget';
import { undoToast, useBoard } from './useBoard';
import { BoardGrid } from './BoardGrid';
import { BoardItemPanel } from './BoardItemPanel';
import { IssueCreateModal, lastIssueRepo } from './IssueCreateModal';

interface BoardViewProps {
  /** Whether the view is visible (drives polling, URL state and keyboard handling) */
  active: boolean;
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
const SLICE_KIND_LABELS: Record<BoardSliceKind, string> = {
  repo: 'Repo',
  label: 'Label',
  milestone: 'Milestone',
  assignee: 'Assignee',
};
const SELECT_CLS = 'bg-gray-850 border border-gray-700 rounded px-2 py-1 text-gray-200 text-xs';
const ICON_BTN =
  'p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor';
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

const toggleIn = (list: string[], key: string) =>
  list.includes(key) ? list.filter((k) => k !== key) : [...list, key];

/**
 * Kanban board over a GitHub Project (status columns, parent swimlanes),
 * linked to the Claude agents working on its issues.
 */
export const BoardView: React.FC<BoardViewProps> = ({ active, contextFilter }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    data,
    settings,
    loading,
    error,
    refresh,
    updateSettings,
    moveItem,
    upsertItem,
    editIssue,
  } = useBoard(active);
  // Column whose "+ Issue" was clicked (status option id, '' = default)
  const [createIn, setCreateIn] = useState<string | null>(null);
  const { sessions } = useAgentSessions({ active });
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
  const repoParam = active ? searchParams.get('repo') : null;
  const setParam = useCallback(
    (name: 'item' | 'agent' | 'repo', value: string | null) =>
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
  const { laneMode } = view;
  const { sliceKind, selected } = sliceFromRepoParam(view, repoParam);
  // Choosing a slice in the toolbar replaces a ?repo= deep link
  const selectSlice = (patch: Partial<ViewPrefs>) => {
    updateView(patch);
    if (repoParam) setParam('repo', null);
  };

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
  const allCount = useMemo(
    () => filterItems(items, { kind: sliceKind, selected: null, hidden: prefs.hidden }).length,
    [items, sliceKind, prefs.hidden]
  );
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

  // Agents with an issue in the current slice (plus the filtered one)
  const railAgents = useMemo(() => {
    const inScope = new Set(scoped.map(itemKey));
    return [...issuesByAgent]
      .filter(([jobId, keys]) => jobId === agentFilter || keys.some((k) => inScope.has(k)))
      .map(([jobId, keys]) => ({ jobId, session: sessionsById.get(jobId), issueKeys: keys }))
      .sort(
        (a, b) =>
          Number(!!b.session) - Number(!!a.session) ||
          (b.session?.updatedAt ?? b.session?.startedAt ?? 0) -
            (a.session?.updatedAt ?? a.session?.startedAt ?? 0) ||
          a.jobId.localeCompare(b.jobId)
      );
  }, [scoped, issuesByAgent, agentFilter, sessionsById]);

  const openItem = openKey ? items.find((i) => itemKey(i) === openKey) : undefined;
  const missingWarned = useRef<string | null>(null);
  useEffect(() => {
    if (!openKey || !data || openItem || missingWarned.current === openKey) return;
    missingWarned.current = openKey;
    toast(`${openKey} ist nicht auf dem Board`);
  }, [openKey, data, openItem]);

  const closePanel = useCallback(() => setParam('item', null), [setParam]);

  // --- Slice actions (persisted server-side) ---
  const selectedEntry = selected
    ? [...slices.favorites, ...slices.others, ...slices.hidden].find((e) => e.value === selected)
    : undefined;
  const onToggleFavorite = (entry: SliceEntry) =>
    updateSettings({ favorites: toggleIn(prefs.favorites, entry.key) });
  const onHide = (entry: SliceEntry) => {
    const before = { hidden: prefs.hidden, favorites: prefs.favorites };
    updateSettings({
      hidden: [...prefs.hidden, entry.key],
      favorites: prefs.favorites.filter((k) => k !== entry.key),
    });
    selectSlice({ sliceKind, selected: null });
    undoToast(`${entry.value} ausgeblendet`, () => updateSettings(before));
  };
  const onUnhide = (entry: SliceEntry) =>
    updateSettings({ hidden: prefs.hidden.filter((k) => k !== entry.key) });

  const onAgent = (jobId: string) => setParam('agent', agentFilter === jobId ? null : jobId);
  const filterAgent = agentFilter ? (sessionsById.get(agentFilter)?.name ?? agentFilter) : null;

  return (
    <div className="relative flex flex-1 h-full min-h-0 bg-gray-900">
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center gap-3 px-4 h-12 border-b border-gray-700 bg-gray-900 shrink-0">
          <select
            value={sliceKind}
            onChange={(e) =>
              selectSlice({ sliceKind: e.target.value as BoardSliceKind, selected: null })
            }
            aria-label="Slice nach"
            className={SELECT_CLS}
          >
            {SLICE_KINDS.map((k) => (
              <option key={k} value={k}>
                {SLICE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <select
            value={selected ?? ''}
            onChange={(e) => selectSlice({ sliceKind, selected: e.target.value || null })}
            aria-label={`${SLICE_KIND_LABELS[sliceKind]} wählen`}
            className={`${SELECT_CLS} max-w-56`}
          >
            <option value="">Alle ({allCount})</option>
            {selected && !selectedEntry && <option value={selected}>{selected}</option>}
            {(
              [
                ['Favoriten', slices.favorites],
                [SLICE_KIND_LABELS[sliceKind], slices.others],
                ['Ausgeblendet', slices.hidden],
              ] as const
            ).map(
              ([label, entries]) =>
                entries.length > 0 && (
                  <optgroup key={label} label={label}>
                    {entries.map((e) => (
                      <option key={e.key} value={e.value}>
                        {e.value} ({e.count})
                      </option>
                    ))}
                  </optgroup>
                )
            )}
          </select>
          {selectedEntry &&
            (selectedEntry.hidden ? (
              <button
                onClick={() => onUnhide(selectedEntry)}
                className={ICON_BTN}
                title="Wieder einblenden"
                aria-label={`${selectedEntry.value} einblenden`}
              >
                <Eye size={14} />
              </button>
            ) : (
              <>
                <button
                  onClick={() => onToggleFavorite(selectedEntry)}
                  className={`${ICON_BTN} ${selectedEntry.favorite ? 'text-yellow-300' : ''}`}
                  title={selectedEntry.favorite ? 'Favorit entfernen' : 'Als Favorit anpinnen'}
                  aria-label={`${selectedEntry.value} ${selectedEntry.favorite ? 'lösen' : 'anpinnen'}`}
                  aria-pressed={selectedEntry.favorite}
                >
                  <Star size={14} className={selectedEntry.favorite ? 'fill-yellow-300' : ''} />
                </button>
                <button
                  onClick={() => onHide(selectedEntry)}
                  className={ICON_BTN}
                  title="Ausblenden"
                  aria-label={`${selectedEntry.value} ausblenden`}
                >
                  <EyeOff size={14} />
                </button>
              </>
            ))}
          <select
            value={agentFilter ?? ''}
            onChange={(e) => setParam('agent', e.target.value || null)}
            aria-label="Nach Agent filtern"
            className={`${SELECT_CLS} max-w-48`}
          >
            <option value="">Alle Agents</option>
            {agentFilter && !railAgents.some((a) => a.jobId === agentFilter) && (
              <option value={agentFilter}>{filterAgent}</option>
            )}
            {railAgents.map((a) => (
              <option key={a.jobId} value={a.jobId}>
                {a.session?.name ?? a.jobId}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-400 shrink-0">{visible.length} Items</span>
          <div className="flex-1" />
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
              className={SELECT_CLS}
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
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev);
                  next.delete('agent');
                  next.delete('repo');
                  return next;
                });
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
