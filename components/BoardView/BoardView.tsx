import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  matchesQuery,
  moveSliceKey,
  type SliceEntry,
} from '../../utils/board';
import { useAgentSessions } from '../../hooks/useAgentSessions';
import { undoToast, useBoard } from './useBoard';
import { BoardRail, type RailAgent } from './BoardRail';
import { BoardGrid } from './BoardGrid';
import { BoardItemPanel } from './BoardItemPanel';

interface BoardViewProps {
  /** Whether the view is visible (drives polling, URL state and keyboard handling) */
  active: boolean;
  /** Make this view the visible route */
  onOpenView?: () => void;
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

const toggleIn = (list: string[], key: string) =>
  list.includes(key) ? list.filter((k) => k !== key) : [...list, key];

/**
 * Kanban board over a GitHub Project (status columns, parent swimlanes),
 * linked to the Claude agents working on its issues.
 */
export const BoardView: React.FC<BoardViewProps> = ({ active }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, settings, loading, error, refresh, updateSettings, moveItem } = useBoard(active);
  const { sessions } = useAgentSessions({ active });
  const [view, setView] = useState<ViewPrefs>(loadView);
  const [doneOpen, setDoneOpen] = useState(false);
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

  const items = useMemo(() => data?.items ?? [], [data]);
  const options = useMemo(() => data?.statusField.options ?? [], [data]);
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
    () =>
      buildLanes(
        visible,
        laneMode,
        new Set(options.filter(isDoneOption).map((o) => o.id))
      ),
    [visible, laneMode, options]
  );
  // Done window is measured from the GitHub fetch, so it moves with polling
  const now = data?.fetchedAt ?? 0;

  // Agents with an issue in the current slice (plus the filtered one)
  const railAgents = useMemo<RailAgent[]>(() => {
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

  // --- Slice list actions (persisted server-side) ---
  const allKeys = [...slices.favorites, ...slices.others].map((e) => e.key);
  const onToggleFavorite = (entry: SliceEntry) =>
    updateSettings({ favorites: toggleIn(prefs.favorites, entry.key) });
  const onHide = (entry: SliceEntry) => {
    const before = { hidden: prefs.hidden, favorites: prefs.favorites };
    updateSettings({
      hidden: [...prefs.hidden, entry.key],
      favorites: prefs.favorites.filter((k) => k !== entry.key),
    });
    if (selected === entry.value) updateView({ selected: null });
    undoToast(`${entry.value} ausgeblendet`, () => updateSettings(before));
  };
  const onUnhide = (entry: SliceEntry) =>
    updateSettings({ hidden: prefs.hidden.filter((k) => k !== entry.key) });
  // Dropping on a favourite pins, dropping on a normal row unpins
  const onReorder = (key: string, before: SliceEntry) => {
    const isFav = prefs.favorites.includes(key);
    updateSettings({
      order: moveSliceKey(prefs.order, allKeys, key, before.key),
      ...(isFav !== before.favorite ? { favorites: toggleIn(prefs.favorites, key) } : {}),
    });
  };

  const onAgent = (jobId: string) => setParam('agent', agentFilter === jobId ? null : jobId);
  const filterAgent = agentFilter
    ? (sessionsById.get(agentFilter)?.name ?? agentFilter)
    : null;

  return (
    <div className="relative flex flex-1 h-full min-h-0 bg-gray-900">
      <BoardRail
        onOpenDashboard={() => navigate('/')}
        onOpenAgents={() => navigate('/agents')}
        sliceKind={sliceKind}
        onSliceKind={(kind) => updateView({ sliceKind: kind, selected: null })}
        slices={slices}
        allCount={allCount}
        selected={selected}
        onSelect={(value) => updateView({ selected: value })}
        onToggleFavorite={onToggleFavorite}
        onHide={onHide}
        onUnhide={onUnhide}
        onReorder={onReorder}
        agents={railAgents}
        agentFilter={agentFilter}
        onAgent={onAgent}
        onOpenIssue={(key) => setParam('item', key)}
      />

      <main className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center gap-3 px-4 h-12 border-b border-gray-700 bg-gray-900 shrink-0">
          <h1 className="text-[15px] font-semibold text-white flex items-center gap-2 min-w-0">
            <span className="truncate">{selected ?? 'Alle'}</span>
            <span className="text-xs font-normal text-gray-400 shrink-0">{visible.length} Items</span>
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
              doneOpen={doneOpen}
              onToggleDone={() => setDoneOpen(!doneOpen)}
              now={now}
              selectedKey={openKey}
              hideRepo={(item: BoardItem) => sliceKind === 'repo' && selected === item.repo}
              agentsByIssue={agentsByIssue}
              sessionsById={sessionsById}
              onOpen={(item) => setParam('item', itemKey(item))}
              onAgent={onAgent}
              onMove={moveItem}
              onReset={() => {
                updateView({ selected: null });
                setParam('agent', null);
              }}
            />
          )}
        </div>
      </main>

      {openItem && (
        <BoardItemPanel
          item={openItem}
          items={items}
          options={options}
          links={links.filter((l) => l.issueKey === openKey)}
          sessionsById={sessionsById}
          onClose={closePanel}
          onStatus={(optionId) => moveItem(openItem.itemId, optionId)}
          onOpenKey={(key) => setParam('item', key)}
          onAttach={(jobId) => navigate(`/agents?attach=${encodeURIComponent(jobId)}`)}
          onStartAgent={(it) =>
            navigate(`/agents?dispatch=${encodeURIComponent(`Bearbeite ${it.url} `)}`)
          }
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
