import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronsDownUp, ChevronsUpDown, Kanban, RefreshCw, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { AgentContext, AgentSession, WorkflowRunInfo } from '../../types';
import { useBoard } from '../BoardView/useBoard';
import { useAgentSessions } from '../../hooks/useAgentSessions';
import { fetchAgentContexts } from '../../services/agentsApi';
import {
  fetchRepoPath,
  fetchWorkflowDoc,
  fetchWorkflowRuns,
  sendWorkflowGo,
} from '../../services/boardApi';
import {
  PIPELINE_TYPES,
  MODE_NAMES,
  GRAPH_MODES,
  graphPath,
  edgeGeometry,
  layoutGraph,
  type PipelineType,
} from '../../utils/workflowGraph.js';
import {
  buildWorkflowCards,
  scopeWorkflowCards,
  stageMoves,
  type WorkflowCard as Card,
} from '../../utils/workflows';
import { shortRepo } from '../../utils/board';
import { agentFolder, boardUrl, codeUrl } from '../../utils/codeTarget';
import { WorkflowCard } from './WorkflowCard';
import type { WorkflowNav } from './WorkflowDetails';
import { WorkflowGraph, type GraphView } from './WorkflowGraph';
import type { ScenePulse } from './WorkflowScene';

const RUNS_POLL_MS = 30_000;
const PROJECTS_KEY = 'devorbit.workflows.projects';

const loadProjects = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]');
    return Array.isArray(v) ? v.filter((r) => typeof r === 'string') : [];
  } catch {
    return [];
  }
};
const MOVED_MS = 2600;

const usePrefersReducedMotion = () => {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
};

/**
 * Workflows mode: every issue running through Martini Workflows (mw) on one stage track,
 * from release to merge, with GO where the next stage needs Hape.
 */
export const WorkflowView: React.FC<{ active: boolean }> = ({ active }) => {
  const navigate = useNavigate();
  // `?repo=owner/name&agent=<jobId>` from the rail (View Workflows / Show Workflow)
  const [searchParams, setSearchParams] = useSearchParams();
  const repo = active ? searchParams.get('repo') : null;
  const agent = active ? searchParams.get('agent') : null;
  const { data, loading, error, refresh } = useBoard(active);
  const { sessions } = useAgentSessions({ active });
  const [runs, setRuns] = useState<Record<string, WorkflowRunInfo>>({});
  const [view, setView] = useState<GraphView>('all');
  const [ptype, setPtype] = useState<PipelineType>('feature');
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [moved, setMoved] = useState<Set<string>>(new Set());
  const [pulses, setPulses] = useState<ScenePulse[]>([]);
  const [arrived, setArrived] = useState<Set<string>>(new Set());
  const [doc, setDoc] = useState<{ name: string; content: string } | null>(null);
  const [projects, setProjects] = useState<string[]>(loadProjects);
  const reducedMotion = usePrefersReducedMotion();
  const prevNodes = useRef<Map<string, string> | null>(null);

  const loadRuns = useCallback(
    (fresh = false) =>
      fetchWorkflowRuns(fresh)
        .then(setRuns)
        .catch(() => {
          // runs are an addition; the stage still follows the board without them
        }),
    []
  );
  useEffect(() => {
    if (!active) return;
    loadRuns();
    const t = setInterval(loadRuns, RUNS_POLL_MS);
    return () => clearInterval(t);
  }, [active, loadRuns]);

  const now = data?.fetchedAt ?? 0;
  const scopedCards = useMemo(
    () =>
      scopeWorkflowCards(
        buildWorkflowCards(data?.items ?? [], data?.statusField.options ?? [], runs, now),
        { repo, agent }
      ),
    [data, runs, now, repo, agent]
  );
  const allCards = useMemo(
    () => scopeWorkflowCards(scopedCards, { repos: projects }),
    [scopedCards, projects]
  );
  // Choices: the repos with issues in mw, plus picked ones that have none right now
  const repoChoices = useMemo(
    () =>
      [
        ...new Set([
          ...scopedCards.flatMap((c) => (c.item.repo ? [c.item.repo] : [])),
          ...projects,
        ]),
      ].sort((a, b) => shortRepo(a).localeCompare(shortRepo(b))),
    [scopedCards, projects]
  );
  const pickProjects = (next: string[]) => {
    setProjects(next);
    try {
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
    } catch {
      // storage full or blocked: the filter still works for this session
    }
  };
  // An agent's workflow: open its station and card right away
  const agentKey = agent ? allCards[0]?.key : undefined;
  const agentNode = agent ? allCards[0]?.node.id : undefined;
  useEffect(() => {
    if (!agentKey || !agentNode) return;
    setView('all');
    setSelected(agentNode);
    setExpanded((prev) => new Set(prev).add(agentKey));
  }, [agentKey, agentNode]);
  const cards = useMemo(
    () => (view === 'all' ? allCards : allCards.filter((c) => c.state.mode === view)),
    [allCards, view]
  );
  const byNode = useMemo(() => {
    const m = new Map<string, Card[]>();
    for (const c of cards) m.set(c.node.id, [...(m.get(c.node.id) ?? []), c]);
    return m;
  }, [cards]);
  const layout = useMemo(() => layoutGraph(view), [view]);
  const waitingOnMe = allCards.filter((c) => c.state.waitingOn === 'hape').length;

  // Station changes since the last refresh: comet along the edges + highlight on node and card
  useEffect(() => {
    if (!data) return;
    const prev = prevNodes.current;
    prevNodes.current = new Map(allCards.map((c) => [c.key, c.node.id]));
    if (!prev) return;
    const moves = stageMoves(prev, allCards);
    if (!moves.length) return;
    const ids = new Map(layout.nodes.map((n) => [n.id, n]));
    const stamp = Date.now();
    const found = moves.flatMap((m) => {
      const [from, to] = [ids.get(m.from), ids.get(m.to)];
      if (!from || !to) return []; // station outside the current view
      const path = graphPath(layout.edges, m.from, m.to);
      const pts = path.length
        ? path.flatMap((e) => edgeGeometry(e, ids).pts)
        : ([
            [from.x, from.y],
            [to.x, to.y],
          ] as [number, number][]);
      return [{ id: `${m.key}@${stamp}`, pts }];
    });
    setPulses(found);
    setMoved(new Set(moves.map((m) => m.key)));
    setArrived(new Set(moves.map((m) => m.to)));
    const t = setTimeout(() => {
      setMoved(new Set());
      setArrived(new Set());
    }, MOVED_MS);
    return () => clearTimeout(t);
  }, [allCards, data, layout]);

  const sessionOf = useCallback(
    (card: Card): AgentSession | undefined =>
      // Live session by its UUID, else by the job id (first 8 chars), as the board links them
      card.state.sessionId
        ? (sessions.find((s) => s.sessionId === card.state.sessionId) ??
          sessions.find((s) => s.id === card.state.sessionId?.slice(0, 8)))
        : undefined,
    [sessions]
  );

  const nav: WorkflowNav = useMemo(
    () => ({
      openAgent: (card, session) => {
        const jobId = session?.id ?? card.state.sessionId?.slice(0, 8);
        if (jobId) navigate(`/agents?attach=${encodeURIComponent(jobId)}`);
      },
      openCode: async (card, session) => {
        // An agent's cwd can be the main checkout while it works in a worktree
        const contexts: Record<string, AgentContext> = session
          ? await fetchAgentContexts().catch(() => ({}))
          : {};
        const folder =
          (session ? agentFolder(session, contexts[session.id]) : null) ??
          (card.item.repo ? await fetchRepoPath(card.item.repo).catch(() => null) : null);
        if (folder) navigate(codeUrl(folder));
        else toast.error(`Kein lokaler Checkout von ${card.item.repo ?? 'diesem Issue'} gefunden`);
      },
      openDoc: async (card, d) => {
        try {
          const res = await fetchWorkflowDoc(card.item.itemId, d.path);
          setDoc({ name: res.name, content: res.content });
        } catch (e) {
          toast.error(`Dokument nicht lesbar: ${(e as Error).message}`);
        }
      },
    }),
    [navigate]
  );

  const go = async (card: Card) => {
    if (!card.state.go) return;
    try {
      await sendWorkflowGo(card.item.itemId, card.state.go);
      toast.success(
        card.state.go.kind === 'build'
          ? `GO für ${card.key}: mw:build gesetzt`
          : `GO für ${card.key}: ${card.state.go.stage} freigegeben`
      );
      await Promise.all([refresh(), loadRuns(true)]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const setAll = (keys: string[], open: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (open) next.add(k);
        else next.delete(k);
      }
      return next;
    });

  const selectedNode = layout.nodes.find((n) => n.id === selected);
  const selectedCards = (selected && byNode.get(selected)) || [];

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);
  const showTypes = view === 'all' || view === 'pipeline';

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-gray-950 text-gray-100">
      <style>{`
        .wf-moved { animation: wf-moved ${MOVED_MS}ms cubic-bezier(0.16,1,0.3,1); }
        @keyframes wf-moved {
          0% { box-shadow: 0 0 0 1px #8fd0ff, 0 8px 28px -6px rgba(143,208,255,0.55); }
          100% { box-shadow: 0 0 0 1px transparent, 0 0 0 0 transparent; }
        }
        @media (prefers-reduced-motion: reduce) { .wf-moved { animation: none; outline: 1px solid #8fd0ff; } }
      `}</style>

      <header className="flex flex-wrap items-center gap-3 border-b border-gray-850 px-5 py-3">
        <h1 className="text-[15px] font-semibold tracking-tight">Workflows</h1>
        {(repo || agent) && (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-850 px-2 py-0.5 text-[12px] text-gray-200">
            {[repo, agent && `Agent ${agent}`].filter(Boolean).join(' · ')}
            <button
              type="button"
              onClick={() => setSearchParams({})}
              className="rounded p-0.5 text-gray-400 hover:text-white"
              aria-label="Filter entfernen"
              title="Filter entfernen"
            >
              <X size={12} />
            </button>
          </span>
        )}
        <span className="text-[12px] text-gray-400">
          {allCards.length} Issues in mw
          {waitingOnMe > 0 && (
            <span className="ml-2 rounded-full bg-amber-300/15 px-2 py-0.5 text-amber-100">
              {waitingOnMe} warten auf dich
            </span>
          )}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {repoChoices.length > 1 && (
            <div
              role="group"
              aria-label="Projekte filtern"
              className="flex flex-wrap rounded-lg border border-gray-850 p-0.5 text-[12px]"
            >
              <button
                type="button"
                aria-pressed={projects.length === 0}
                onClick={() => pickProjects([])}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  projects.length === 0 ? 'bg-sel text-white' : 'text-gray-400 hover:text-gray-100'
                }`}
              >
                Alle Projekte
              </button>
              {repoChoices.map((r) => {
                const on = projects.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={on}
                    title={r}
                    onClick={() =>
                      pickProjects(on ? projects.filter((p) => p !== r) : [...projects, r])
                    }
                    className={`rounded-md px-2.5 py-1 transition-colors ${
                      on ? 'bg-sel text-white' : 'text-gray-400 hover:text-gray-100'
                    }`}
                  >
                    {shortRepo(r)}
                  </button>
                );
              })}
            </div>
          )}
          {showTypes && (
            <div
              role="radiogroup"
              aria-label="Pipeline-Typ"
              className="flex rounded-lg border border-gray-850 p-0.5 text-[12px]"
            >
              {PIPELINE_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={ptype === t}
                  onClick={() => setPtype(t)}
                  className={`rounded-md px-2.5 py-1 transition-colors ${
                    ptype === t ? 'bg-sel text-white' : 'text-gray-400 hover:text-gray-100'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          <div
            role="radiogroup"
            aria-label="Ansicht"
            className="flex rounded-lg border border-gray-850 p-0.5 text-[12px]"
          >
            {(['all', ...GRAPH_MODES] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={view === m}
                onClick={() => {
                  setView(m);
                  setSelected(null);
                }}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  view === m ? 'bg-sel text-white' : 'text-gray-400 hover:text-gray-100'
                }`}
              >
                {m === 'all' ? 'Gesamt' : MODE_NAMES[m]}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            refresh();
            loadRuns(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-850 px-2.5 py-1 text-[12px] text-gray-300 hover:bg-gray-900"
          aria-label="Aktualisieren"
        >
          <RefreshCw size={13} className={loading ? 'motion-safe:animate-spin' : ''} />
          Aktualisieren
        </button>
        <button
          type="button"
          onClick={() => navigate(repo ? boardUrl(repo, agent ?? undefined) : '/board')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-850 px-2.5 py-1 text-[12px] text-gray-300 hover:bg-gray-900"
        >
          <Kanban size={13} /> Board
        </button>
      </header>

      {error && (
        <p className="mx-5 mt-3 rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
          Board nicht geladen: {error}
        </p>
      )}

      <div className="relative min-h-0 flex-1 overflow-auto">
        <WorkflowGraph
          active={active}
          view={view}
          pipelineType={ptype}
          byNode={byNode}
          selected={selected}
          onSelect={setSelected}
          arrived={arrived}
          pulses={pulses}
          reducedMotion={reducedMotion}
          popover={
            selectedNode && (
              <>
                <div className="mb-2 flex items-center gap-2 px-0.5">
                  <h2 className="text-[13px] font-semibold">{selectedNode.label}</h2>
                  <span className="tabular-nums text-[12px] text-gray-400">
                    {selectedCards.length}
                  </span>
                  {selectedCards.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setAll(
                            selectedCards.map((c) => c.key),
                            true
                          )
                        }
                        className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-900 hover:text-gray-100"
                        aria-label="Alle ausklappen"
                        title="Alle ausklappen"
                      >
                        <ChevronsUpDown size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setAll(
                            selectedCards.map((c) => c.key),
                            false
                          )
                        }
                        className="rounded p-1 text-gray-400 hover:bg-gray-900 hover:text-gray-100"
                        aria-label="Alle einklappen"
                        title="Alle einklappen"
                      >
                        <ChevronsDownUp size={14} />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className={`${selectedCards.length ? '' : 'ml-auto '}rounded p-1 text-gray-400 hover:bg-gray-900 hover:text-gray-100`}
                    aria-label="Schließen"
                  >
                    <X size={14} />
                  </button>
                </div>
                {selectedCards.length ? (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] items-start gap-2">
                    {selectedCards.map((card) => (
                      <WorkflowCard
                        key={card.key}
                        card={card}
                        session={sessionOf(card)}
                        expanded={expanded.has(card.key)}
                        moved={moved.has(card.key)}
                        onToggle={() => toggle(card.key)}
                        onGo={() => go(card)}
                        nav={nav}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="px-0.5 pb-1 text-[12px] text-gray-400">
                    Kein Issue an dieser Station.
                  </p>
                )}
              </>
            )
          }
        />
        {!loading && data && allCards.length === 0 && (
          <p className="sticky left-0 mt-6 px-5 text-[13px] text-gray-400">
            {repo || agent ? (
              'Für diesen Filter läuft kein Issue durch mw.'
            ) : (
              <>
                Kein Issue läuft gerade durch mw. Ein Issue mit Label <code>mw:go</code> erscheint
                hier, sobald es auf dem Board steht.
              </>
            )}
          </p>
        )}
      </div>

      {doc && (
        <aside
          aria-label={`Dokument ${doc.name}`}
          className="absolute inset-y-0 right-0 z-40 flex w-full max-w-[640px] flex-col border-l border-gray-800 bg-gray-950 shadow-[-16px_0_40px_-12px_rgba(0,0,0,0.6)]"
        >
          <div className="flex items-center gap-2 border-b border-gray-850 px-4 py-2.5">
            <h2 className="truncate text-[13px] font-semibold">{doc.name}</h2>
            <button
              type="button"
              onClick={() => setDoc(null)}
              className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-900 hover:text-gray-100"
              aria-label="Dokument schließen"
            >
              <X size={16} />
            </button>
          </div>
          <pre className="flex-1 overflow-auto whitespace-pre-wrap px-5 py-4 font-mono text-[12px] leading-relaxed text-gray-200">
            {doc.content}
          </pre>
        </aside>
      )}
    </div>
  );
};
