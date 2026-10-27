/**
 * Martini Workflows (mw) as a directed graph: the real stations per mode (mw plugin 6.29 and the
 * trace phases of real runs), the layout of the graph, and which station an issue is on.
 * Plain JS like workflowStage.js, so it is unit-tested without the DOM.
 */

/** @typedef {'default'|'orchestrate'|'pipeline'|'image'} GraphMode */
/** @typedef {'feature'|'bug'|'hotfix'|'chore'} PipelineType */
/** @typedef {{ id: string, label: string, lane: string, col: number, y: number, x: number,
 *   types?: PipelineType[] }} GraphNode */
/** @typedef {{ id: string, from: string, to: string, back: boolean, label?: string }} GraphEdge */

export const GRAPH_MODES = /** @type {const} */ (['default', 'orchestrate', 'pipeline', 'image']);
export const PIPELINE_TYPES = /** @type {const} */ (['feature', 'bug', 'hotfix', 'chore']);
export const MODE_NAMES = {
  default: 'Standard',
  orchestrate: 'Orchestrate',
  pipeline: 'Pipeline',
  image: 'Bild',
};

const ALL = PIPELINE_TYPES;
const lane = (
  /** @type {string} */ mode,
  /** @type {[string, string, PipelineType[]?][]} */ rows
) => rows.map(([key, label, types]) => ({ key, id: `${mode}.${key}`, label, types }));

/**
 * Stations between "Abgeholt" and "PR", in order. `back` edges are loops; `max` caps the rounds.
 * shortcut: which pipeline types skip a station is assumed from the chain names (short_plan for
 * hotfix/chore, red_repro for bug/hotfix), adjust here when mw's chains differ.
 */
const LANES = {
  default: {
    nodes: lane('default', [
      ['interview', 'Interview'],
      ['briefing', 'Briefing'],
      ['go_build', 'GO'],
      ['impl', 'Umsetzung'],
    ]),
    back: [['interview', 'interview', 'Rückfrage']],
  },
  orchestrate: {
    nodes: lane('orchestrate', [
      ['plan', 'Plan'],
      ['build', 'Build'],
      ['gates', 'Gates'],
      ['review', 'Review'],
      ['check', 'Check'],
    ]),
    back: [
      ['review', 'build', 'Fix-Runde'],
      ['check', 'plan', 'Goal-Schleife'],
    ],
  },
  pipeline: {
    nodes: lane('pipeline', [
      ['discovery', 'Discovery', ['feature']],
      ['briefing_approval', 'Briefing-Freigabe', ['feature', 'bug']],
      ['plan', 'Plan', ['feature', 'bug']],
      ['short_plan', 'Kurzplan', ['hotfix', 'chore']],
      ['plan_approval', 'Plan-Freigabe', ['feature', 'bug']],
      ['red_repro', 'Red-Repro', ['bug', 'hotfix']],
      ['build', 'Build', ALL.slice()],
      ['gates', 'Gates', ALL.slice()],
      ['full_review', 'Full Review', ['feature', 'bug']],
      ['correction', 'Korrektur', ['feature', 'bug']],
      ['document', 'Doku', ['feature']],
      ['gates2', 'Gates', ALL.slice()],
      ['delta_review', 'Delta Review', ALL.slice()],
      ['draft_pr', 'Draft-PR', ALL.slice()],
      ['pr_approval', 'PR-Freigabe', ALL.slice()],
    ]),
    back: [],
  },
  image: { nodes: lane('image', [['images', 'Bilder erzeugen']]), back: [] },
};

const START = [
  { id: 'go', label: 'mw:go' },
  { id: 'picked', label: 'Abgeholt' },
];
const END = [
  { id: 'pr', label: 'PR' },
  { id: 'to_review', label: 'to Review' },
  { id: 'merge', label: 'Merge' },
  { id: 'wrapup', label: 'Wrap-up' },
  { id: 'deploy', label: 'to Deploy / Done' },
  { id: 'ended', label: 'Session entfernt' },
];

export const LANE_W = 260;
export const ROW_H = 60;
export const STEP_X = 168;
export const PAD_X = 40;
export const PAD_Y = 48;
/** extra room above the lanes (lane labels, fan-out) and below them (fan-in to PR) */
const LANE_GAP = 32;
const END_GAP = 40;

/**
 * Nodes and edges of the whole graph (`view` 'all') or of one mode, top to bottom: start as a
 * row on top, one column per lane, the end stations as a row at the bottom. Coordinates are node
 * centers in px.
 * @param {'all' | GraphMode} view
 * @returns {{ nodes: GraphNode[], edges: GraphEdge[], width: number, height: number }}
 */
export function layoutGraph(view) {
  const modes = view === 'all' ? GRAPH_MODES : [view];
  const longest = Math.max(...modes.map((m) => LANES[m].nodes.length));
  const span = Math.max((modes.length - 1) * LANE_W, (END.length - 1) * STEP_X) + NODE_W;
  const width = span + PAD_X * 2;
  const midX = width / 2;
  const row = (/** @type {number} */ x0, /** @type {number} */ i) => x0 + i * STEP_X;
  const laneTop = PAD_Y + ROW_H + LANE_GAP;
  const endY = laneTop + longest * ROW_H + END_GAP;
  /** @type {GraphNode[]} */
  const nodes = [];
  /** @type {GraphEdge[]} */
  const edges = [];
  const edge = (/** @type {string} */ from, /** @type {string} */ to, back = false, label) =>
    edges.push({ id: `${from}>${to}${back ? '~' : ''}`, from, to, back, label });

  const startX = midX - ((START.length - 1) * STEP_X) / 2;
  START.forEach((s, i) =>
    nodes.push({ ...s, lane: 'shared', col: i, x: row(startX, i), y: PAD_Y })
  );
  edge('go', 'picked');
  const endCol = 2 + longest;
  const endX = midX - ((END.length - 1) * STEP_X) / 2;
  END.forEach((s, i) =>
    nodes.push({ ...s, lane: 'shared', col: endCol + i, x: row(endX, i), y: endY })
  );
  END.slice(1).forEach((s, i) => edge(END[i].id, s.id));

  modes.forEach((m, li) => {
    const x = midX + (li - (modes.length - 1) / 2) * LANE_W;
    const { nodes: ns, back } = LANES[m];
    ns.forEach((n, i) =>
      nodes.push({
        id: n.id,
        label: n.label,
        lane: m,
        col: 2 + i,
        x,
        y: laneTop + i * ROW_H,
        types: n.types,
      })
    );
    edge('picked', ns[0].id);
    ns.slice(1).forEach((n, i) => edge(ns[i].id, n.id));
    edge(ns[ns.length - 1].id, 'pr');
    for (const [a, b, label] of back) edge(`${m}.${a}`, `${m}.${b}`, true, label);
  });

  return { nodes, edges, width, height: endY + PAD_Y };
}

/** Whether a pipeline station exists in this type's chain (others are dimmed) */
export const inChain = (/** @type {GraphNode} */ node, /** @type {PipelineType} */ type) =>
  !node.types || node.types.includes(type);

/** feature unless a label says bug, hotfix or chore */
export function pipelineType(/** @type {{ labels: { name: string }[] }} */ item) {
  const names = item.labels.map((l) => l.name.toLowerCase());
  return /** @type {PipelineType} */ (
    PIPELINE_TYPES.find(
      (t) => t !== 'feature' && names.some((n) => n === t || n.endsWith(`:${t}`))
    ) ?? 'feature'
  );
}

/** Forward path of edge ids from a node to another (shortest by hops), [] when none */
export function graphPath(
  /** @type {GraphEdge[]} */ edges,
  /** @type {string} */ from,
  /** @type {string} */ to
) {
  /** @type {Map<string, GraphEdge[]>} */
  const prev = new Map([[from, []]]);
  const queue = [from];
  for (const cur of queue) {
    if (cur === to) return prev.get(cur) ?? [];
    for (const e of edges.filter((x) => !x.back && x.from === cur)) {
      if (prev.has(e.to)) continue;
      prev.set(e.to, [...(prev.get(cur) ?? []), e]);
      queue.push(e.to);
    }
  }
  return [];
}

/** Station of an orchestrate or pipeline trace phase, null when unknown */
function phaseKey(
  /** @type {'orchestrate'|'pipeline'} */ mode,
  /** @type {string} */ phase,
  /** @type {{ phase: string }[]} */ phases
) {
  const p = phase.toLowerCase();
  if (mode === 'orchestrate') {
    if (/check/.test(p)) return 'check';
    if (/review/.test(p)) return 'review';
    if (/gate/.test(p)) return 'gates';
    if (/plan/.test(p)) return 'plan';
    return /build|fix|correct|repair/.test(p) ? 'build' : null;
  }
  if (/discovery/.test(p)) return 'discovery';
  if (/short_plan/.test(p)) return 'short_plan';
  if (/plan_approval/.test(p)) return 'plan_approval';
  if (/plan/.test(p)) return 'plan';
  if (/red_repro/.test(p)) return 'red_repro';
  if (/gate/.test(p)) return phases.some((x) => /^document/.test(x.phase)) ? 'gates2' : 'gates';
  if (/delta/.test(p)) return 'delta_review';
  if (/review/.test(p)) return 'full_review';
  if (/correction|repair|fix/.test(p)) return 'correction';
  if (/doc/.test(p)) return 'document';
  if (/draft|^pr/.test(p)) return 'draft_pr';
  return /build/.test(p) ? 'build' : null;
}

/**
 * The station an issue is on, plus the loop round shown at the node (null outside a loop).
 * @param {{ mwMarkers?: { kind: string }[] }} item
 * @param {import('./workflowStage.js').WorkflowState} state
 * @param {import('./workflowStage.js').WorkflowRun | null} run
 * @param {string | null} statusName
 * @returns {{ id: string, round: string | null }}
 */
export function deriveNode(item, state, run, statusName) {
  const { mode, stage } = state;
  const phases = run?.phases ?? [];
  const node = (/** @type {string} */ id, round = null) => ({ id, round });
  const pending = state.go?.kind === 'approve' ? state.go.stage : null;

  if (stage === 'done')
    return node((statusName ?? '').toLowerCase() === 'to deploy' ? 'deploy' : 'ended');
  if (stage === 'review') return node(pending === 'pr' ? 'pipeline.pr_approval' : 'to_review');
  if (stage === 'released') return node('go');
  if (mode === 'image') return node('image.images');

  if (mode === 'default') {
    if (stage === 'awaiting') return node('default.go_build');
    if (stage === 'building') return node('default.impl');
    const asks = (item.mwMarkers ?? []).filter((m) => m.kind === 'ask').length;
    return node('default.interview', asks ? `Rückfrage ${asks}` : null);
  }

  if (pending && mode === 'pipeline')
    return node(
      `pipeline.${pending === 'plan' ? 'plan_approval' : pending === 'pr' ? 'pr_approval' : 'briefing_approval'}`
    );
  const last = phases.at(-1);
  const key = last ? phaseKey(mode, last.phase, phases) : null;
  if (!key) return node(mode === 'orchestrate' ? 'orchestrate.plan' : 'pipeline.discovery');
  // Fix rounds: every build after the first is one trip back from review (max 2)
  const fixes = Math.min(
    2,
    Math.max(0, phases.filter((p) => phaseKey(mode, p.phase, phases) === 'build').length - 1)
  );
  const looped = mode === 'orchestrate' && fixes > 0 && (key === 'build' || key === 'review');
  return node(`${mode}.${key}`, looped ? `Fix-Runde ${fixes}/2` : null);
}

export const NODE_W = 136;
export const NODE_H = 44;
const CURVE_STEPS = 32;
/** a long drop runs straight down its lane and only bends in this last stretch */
const BEND = 64;

/**
 * Curve of one edge: SVG path, sampled points (for the WebGL layer) and the label anchor.
 * Forward edges run from the bottom of a node to the top of the next (side to side within a
 * row); loops bow out to the right of the lane, a self-loop is a small bow beside its node.
 * @param {GraphEdge} edge
 * @param {Map<string, GraphNode>} nodes
 * @returns {{ d: string, pts: [number, number][], mid: [number, number] }}
 */
export function edgeGeometry(edge, nodes) {
  const a = /** @type {GraphNode} */ (nodes.get(edge.from));
  const b = /** @type {GraphNode} */ (nodes.get(edge.to));
  /** @type {[number, number][]} */
  let p;
  /** @type {[number, number] | null} start of the straight drop before the curve */
  let lead = null;
  if (!edge.back && a.y === b.y) {
    const [x0, x1] = [a.x + NODE_W / 2, b.x - NODE_W / 2];
    const dx = (x1 - x0) / 3;
    p = [
      [x0, a.y],
      [x0 + dx, a.y],
      [x1 - dx, b.y],
      [x1, b.y],
    ];
  } else if (!edge.back) {
    const [y0, y1] = [a.y + NODE_H / 2, b.y - NODE_H / 2];
    const yb = Math.max(y0, y1 - BEND);
    if (yb > y0) lead = [a.x, y0];
    const dy = (y1 - yb) / 2;
    p = [
      [a.x, yb],
      [a.x, yb + dy],
      [b.x, y1 - dy],
      [b.x, y1],
    ];
  } else {
    const right = a.x + NODE_W / 2;
    const self = a === b;
    // control points sit 4/3 out so the bow's apex lands at `rise`
    const rise = self ? 24 : Math.min(56, 14 * Math.abs(a.col - b.col) - 2);
    const [y0, y1] = self ? [a.y - 10, a.y + 10] : [a.y, b.y];
    const c = right + (rise * 4) / 3;
    p = [
      [right, y0],
      [c, self ? y0 - 14 : y0],
      [c, self ? y1 + 14 : y1],
      [right, y1],
    ];
  }
  const at = (/** @type {number} */ t) => {
    const u = 1 - t;
    return /** @type {[number, number]} */ (
      [0, 1].map(
        (k) =>
          u ** 3 * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t ** 3 * p[3][k]
      )
    );
  };
  const curve = Array.from({ length: CURVE_STEPS + 1 }, (_, i) => at(i / CURVE_STEPS));
  const pts = lead ? [lead, ...curve] : curve;
  const d = `M${lead ?? p[0]} ${lead ? `L${p[0]} ` : ''}C${p[1]} ${p[2]} ${p[3]}`;
  return { d, pts, mid: at(0.5) };
}
