import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGroup } from 'motion/react';
import { Kanban, RefreshCw, X } from 'lucide-react';
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
import { WORKFLOW_STAGES } from '../../utils/workflowStage.js';
import {
  buildWorkflowCards,
  stageIndex,
  stageMoves,
  type WorkflowCard as Card,
} from '../../utils/workflows';
import { agentFolder, codeUrl } from '../../utils/codeTarget';
import { MODE_LABEL, WorkflowCard } from './WorkflowCard';
import type { WorkflowNav } from './WorkflowDetails';
import type { StagePulse } from './WorkflowScene';

const WorkflowScene = lazy(() => import('./WorkflowScene'));

const RUNS_POLL_MS = 30_000;
const MOVED_MS = 2600;
const TRACK_Y = 30;
type ModeFilter = 'all' | 'default' | 'orchestrate' | 'pipeline';

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
  const { data, loading, error, refresh } = useBoard(active);
  const { sessions } = useAgentSessions({ active });
  const [runs, setRuns] = useState<Record<string, WorkflowRunInfo>>({});
  const [mode, setMode] = useState<ModeFilter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [moved, setMoved] = useState<Set<string>>(new Set());
  const [pulses, setPulses] = useState<StagePulse[]>([]);
  const [doc, setDoc] = useState<{ name: string; content: string } | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const prevStages = useRef<Map<string, number> | null>(null);

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
  const allCards = useMemo(
    () => buildWorkflowCards(data?.items ?? [], data?.statusField.options ?? [], runs, now),
    [data, runs, now]
  );
  const cards = useMemo(
    () => (mode === 'all' ? allCards : allCards.filter((c) => c.state.mode === mode)),
    [allCards, mode]
  );
  const columns = useMemo(
    () => WORKFLOW_STAGES.map((s) => cards.filter((c) => c.state.stage === s.id)),
    [cards]
  );
  const waitingOnMe = allCards.filter((c) => c.state.waitingOn === 'hape').length;

  // Stage changes since the last refresh: comet on the track + highlight on the card
  useEffect(() => {
    if (!data) return;
    const prev = prevStages.current;
    prevStages.current = new Map(allCards.map((c) => [c.key, stageIndex(c.state.stage)]));
    if (!prev) return;
    const moves = stageMoves(prev, allCards);
    if (!moves.length) return;
    const stamp = Date.now();
    setPulses(moves.map((m) => ({ id: `${m.key}@${stamp}`, from: m.from, to: m.to })));
    setMoved(new Set(moves.map((m) => m.key)));
    const t = setTimeout(() => setMoved(new Set()), MOVED_MS);
    return () => clearTimeout(t);
  }, [allCards, data]);

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

  const counts = columns.map((c) => c.length);

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
        <span className="text-[12px] text-gray-400">
          {allCards.length} Issues in mw
          {waitingOnMe > 0 && (
            <span className="ml-2 rounded-full bg-amber-300/15 px-2 py-0.5 text-amber-100">
              {waitingOnMe} warten auf dich
            </span>
          )}
        </span>
        <div
          role="radiogroup"
          aria-label="Workflow-Modus"
          className="ml-auto flex rounded-lg border border-gray-850 p-0.5 text-[12px]"
        >
          {(['all', 'default', 'orchestrate', 'pipeline'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-md px-2.5 py-1 transition-colors ${
                mode === m ? 'bg-sel text-white' : 'text-gray-400 hover:text-gray-100'
              }`}
            >
              {m === 'all' ? 'Alle' : MODE_LABEL[m]}
            </button>
          ))}
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
          onClick={() => navigate('/board')}
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
        <div className="relative grid min-h-full min-w-[1200px] grid-cols-6">
          {active && (
            <Suspense fallback={null}>
              <WorkflowScene
                counts={counts}
                trackY={TRACK_Y}
                pulses={pulses}
                reducedMotion={reducedMotion}
              />
            </Suspense>
          )}
          <LayoutGroup>
            {WORKFLOW_STAGES.map((stage, i) => (
              <section
                key={stage.id}
                aria-labelledby={`wf-stage-${stage.id}`}
                className="relative flex min-w-0 flex-col border-r border-gray-900/80 last:border-r-0"
              >
                <div className="sticky top-0 z-10 px-3 pb-3 pt-12 text-center">
                  <h2
                    id={`wf-stage-${stage.id}`}
                    className="text-[12.5px] font-semibold text-gray-100"
                  >
                    {stage.label}
                    <span className="ml-1.5 tabular-nums text-gray-400">{columns[i].length}</span>
                  </h2>
                  <p className="mt-0.5 text-[11px] text-gray-400">{stage.hint}</p>
                </div>
                <div className="flex flex-1 flex-col gap-2.5 px-2.5 pb-6">
                  {columns[i].map((card) => (
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
                  {!columns[i].length && !loading && (
                    <p className="px-2 pt-2 text-center text-[11px] text-gray-500">Leer</p>
                  )}
                </div>
              </section>
            ))}
          </LayoutGroup>
        </div>
        {!loading && data && allCards.length === 0 && (
          <p className="absolute inset-x-0 top-40 text-center text-[13px] text-gray-400">
            Kein Issue läuft gerade durch mw. Ein Issue mit Label <code>mw:go</code> erscheint hier,
            sobald es auf dem Board steht.
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
