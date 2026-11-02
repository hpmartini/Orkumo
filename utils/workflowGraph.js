/**
 * Martini Workflows (mw 7) as a directed graph: the stations per mode (mw board, plugin 7.0), the
 * layout of the graph, and which station an issue is on.
 * Plain JS like workflowStage.js, so it is unit-tested without the DOM.
 */

/** @typedef {'default'|'image'} GraphMode */
/** @typedef {{ id: string, label: string, lane: string, col: number, y: number, x: number }} GraphNode */
/** @typedef {{ id: string, from: string, to: string, back: boolean, label?: string }} GraphEdge */

export const GRAPH_MODES = /** @type {const} */ (['default', 'image']);
export const MODE_NAMES = { default: 'Standard', image: 'Bild' };

const lane = (/** @type {string} */ mode, /** @type {[string, string][]} */ rows) =>
  rows.map(([key, label]) => ({ key, id: `${mode}.${key}`, label }));

/** Stations between "Abgeholt" and "PR", in order. `back` edges are loops. */
const LANES = {
  default: {
    nodes: lane('default', [
      ['interview', 'Interview'],
      ['contract', 'Ziel-Vertrag'],
      ['go_build', 'GO (mw:build)'],
      ['impl', 'Umsetzung /goal'],
    ]),
    back: [
      ['interview', 'interview', 'Rückfrage'],
      ['go_build', 'contract', 'Rückmeldung'],
    ],
  },
  image: { nodes: lane('image', [['images', 'Bilder erzeugen']]), back: [] },
};

const START = [
  { id: 'go', label: 'mw:go' },
  { id: 'picked', label: 'Abgeholt' },
];
const END = [
  { id: 'pr', label: 'PR + Nachweise' },
  { id: 'to_review', label: 'to Review' },
  { id: 'merge', label: 'Merge' },
  { id: 'deploy', label: 'to Deploy / Done' },
  { id: 'wrapup', label: 'Abschluss' },
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
      })
    );
    edge('picked', ns[0].id);
    ns.slice(1).forEach((n, i) => edge(ns[i].id, n.id));
    edge(ns[ns.length - 1].id, 'pr');
    for (const [a, b, label] of back) edge(`${m}.${a}`, `${m}.${b}`, true, label);
  });

  return { nodes, edges, width, height: endY + PAD_Y };
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

/**
 * The station an issue is on, plus the loop round shown at the node (null outside a loop).
 * @param {{ mwMarkers?: { kind: string }[] }} item
 * @param {import('./workflowStage.js').WorkflowState} state
 * @returns {{ id: string, round: string | null }}
 */
export function deriveNode(item, state) {
  const { mode, stage } = state;
  const markers = item.mwMarkers ?? [];
  const count = (/** @type {string} */ kind) => markers.filter((m) => m.kind === kind).length;
  const node = (/** @type {string} */ id, round = null) => ({ id, round });

  if (stage === 'done') {
    if (markers.some((m) => m.kind === 'removed')) return node('ended');
    return node(markers.some((m) => m.kind === 'wrap') ? 'wrapup' : 'deploy');
  }
  if (stage === 'review') return node('to_review');
  if (stage === 'released') return node('go');
  if (mode === 'image') return node('image.images');
  if (stage === 'awaiting') return node('default.go_build');
  if (stage === 'building') return node('default.impl');
  const kinds = markers.map((m) => m.kind);
  // Feedback (fed) or an answer (resumed) on the latest contract: the session revises it
  const iBriefed = kinds.lastIndexOf('briefed');
  if (iBriefed >= 0 && Math.max(kinds.lastIndexOf('fed'), kinds.lastIndexOf('resumed')) > iBriefed)
    return node('default.contract', `Runde ${count('fed') + 1}`);
  const asks = count('ask');
  return node('default.interview', asks ? `Rückfrage ${asks}` : null);
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
