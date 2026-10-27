import React, { Suspense, lazy, useMemo } from 'react';
import type { WorkflowCard } from '../../utils/workflows';
import {
  NODE_H,
  NODE_W,
  edgeGeometry,
  inChain,
  layoutGraph,
  MODE_NAMES,
  type GraphMode,
  type PipelineType,
} from '../../utils/workflowGraph.js';
import { supportsWebGL, type ScenePulse } from './WorkflowScene';

const WorkflowScene = lazy(() => import('./WorkflowScene'));

export type GraphView = 'all' | GraphMode;

interface WorkflowGraphProps {
  active: boolean;
  view: GraphView;
  pipelineType: PipelineType;
  /** cards on the graph, by station id */
  byNode: Map<string, WorkflowCard[]>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** stations that received an issue on the last refresh */
  arrived: Set<string>;
  pulses: ScenePulse[];
  reducedMotion: boolean;
}

/**
 * The mw workflows as a graph, left to right: stations are HTML buttons (click, keyboard, count),
 * the edges, particles and comets are drawn by the WebGL layer underneath. Loops arc above the
 * lane and show the round of the issues running through them.
 */
export const WorkflowGraph: React.FC<WorkflowGraphProps> = ({
  active,
  view,
  pipelineType,
  byNode,
  selected,
  onSelect,
  arrived,
  pulses,
  reducedMotion,
}) => {
  const layout = useMemo(() => layoutGraph(view), [view]);
  const nodeById = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);
  const geo = useMemo(
    () => layout.edges.map((e) => ({ e, g: edgeGeometry(e, nodeById) })),
    [layout, nodeById]
  );
  const webgl = useMemo(supportsWebGL, []);
  const count = (id: string) => byNode.get(id)?.length ?? 0;
  const dimmed = (id: string) => {
    const n = nodeById.get(id)!;
    return n.lane === 'pipeline' && !inChain(n, pipelineType) && count(id) === 0;
  };

  const sceneEdges = geo.map(({ e, g }) => ({
    id: e.id,
    pts: g.pts,
    back: e.back,
    active: count(e.from),
  }));
  const sceneNodes = layout.nodes.map((n) => ({ x: n.x, y: n.y, count: count(n.id) }));
  const laneLabels = layout.nodes.filter((n) => n.lane !== 'shared' && n.col === 2);

  return (
    <div className="relative" style={{ width: layout.width, height: layout.height }}>
      <style>{`
        .wf-node { transition: border-color .2s, background-color .2s, opacity .2s, transform .2s cubic-bezier(0.16,1,0.3,1); }
        .wf-node:hover { transform: translateY(-1px); }
        .wf-arrive { animation: wf-arrive 2600ms cubic-bezier(0.16,1,0.3,1); }
        @keyframes wf-arrive {
          0% { box-shadow: 0 0 0 1px #8fd0ff, 0 8px 28px -6px rgba(143,208,255,0.55); }
          100% { box-shadow: 0 0 0 1px transparent, 0 0 0 0 transparent; }
        }
        @media (prefers-reduced-motion: reduce) {
          .wf-node { transition: none; }
          .wf-node:hover { transform: none; }
          .wf-arrive { animation: none; outline: 1px solid #8fd0ff; }
        }
      `}</style>

      {active && webgl && (
        <Suspense fallback={null}>
          <WorkflowScene
            width={layout.width}
            height={layout.height}
            edges={sceneEdges}
            nodes={sceneNodes}
            pulses={pulses}
            reducedMotion={reducedMotion}
          />
        </Suspense>
      )}

      <svg
        width={layout.width}
        height={layout.height}
        className="pointer-events-none absolute left-0 top-0"
        aria-hidden="true"
      >
        {!webgl &&
          geo.map(({ e, g }) => (
            <path
              key={e.id}
              d={g.d}
              fill="none"
              stroke="#4f67a0"
              strokeWidth={1.25}
              strokeDasharray={e.back ? '6 5' : undefined}
            />
          ))}
        {geo
          .filter(({ e }) => e.back && e.label)
          .map(({ e, g }) => (
            <text
              key={e.id}
              x={g.mid[0]}
              y={g.mid[1] - 6}
              textAnchor="middle"
              className="fill-gray-400"
              fontSize={11}
            >
              ⟲ {e.label}
            </text>
          ))}
      </svg>

      {laneLabels.map((n) => (
        <p
          key={n.lane}
          className="absolute text-[11px] text-gray-400"
          style={{ left: n.x - NODE_W / 2, top: n.y + NODE_H / 2 + 8 }}
        >
          {MODE_NAMES[n.lane as GraphMode]}
        </p>
      ))}

      {layout.nodes.map((n) => {
        const cards = byNode.get(n.id) ?? [];
        const waiting = cards.some((c) => c.state.waitingOn === 'hape');
        const rounds = [...new Set(cards.map((c) => c.node.round).filter(Boolean))];
        const off = dimmed(n.id);
        return (
          <button
            key={n.id}
            type="button"
            aria-pressed={selected === n.id}
            aria-label={`${n.label}, ${cards.length} Issues${off ? ', nicht in dieser Kette' : ''}`}
            onClick={() => onSelect(selected === n.id ? null : n.id)}
            className={`wf-node absolute flex flex-col justify-center rounded-lg border px-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor ${
              selected === n.id
                ? 'border-cursor bg-gray-850'
                : waiting
                  ? 'border-amber-300/60 bg-gray-900'
                  : cards.length
                    ? 'border-gray-700 bg-gray-900 hover:border-gray-600'
                    : 'border-gray-850 bg-gray-950/80 hover:border-gray-700'
            } ${off ? 'opacity-40' : ''} ${arrived.has(n.id) ? 'wf-arrive' : ''}`}
            style={{ left: n.x - NODE_W / 2, top: n.y - NODE_H / 2, width: NODE_W, height: NODE_H }}
          >
            <span className="flex items-baseline gap-2">
              <span
                className={`truncate text-[12.5px] font-semibold ${cards.length ? 'text-gray-100' : 'text-gray-300'}`}
              >
                {n.label}
              </span>
              {cards.length > 0 && (
                <span className="ml-auto rounded-full bg-gray-800 px-1.5 text-[11px] tabular-nums text-gray-100">
                  {cards.length}
                </span>
              )}
            </span>
            {rounds.length > 0 && (
              <span className="truncate text-[11px] text-cursor">{rounds.join(' · ')}</span>
            )}
          </button>
        );
      })}
    </div>
  );
};
