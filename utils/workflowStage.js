/**
 * Martini Workflows (mw): which abstract stage an issue is in, derived from its MACC column,
 * labels, `<!-- mw-board:… -->` marker comments and the local mw run (trace + approvals).
 * Plain JS so the server (GO validation) and the client (view) share the same rule.
 */

/** @typedef {'released'|'briefing'|'awaiting'|'building'|'review'|'done'} WorkflowStageId */
/** @typedef {'default'|'orchestrate'|'pipeline'|'image'} WorkflowMode */
/** @typedef {{ kind: string, attrs: Record<string, string>, at: string }} MwMarker */
/**
 * @typedef {{ phase: string, result: string, at: string, role?: string, model?: string }} RunPhase
 * @typedef {{ stage: string, sha: string }} PendingApproval
 * @typedef {{ runId: string, repoPath: string, mode: 'orchestrate'|'pipeline', phases: RunPhase[],
 *   pendingApproval: PendingApproval | null }} WorkflowRun
 * @typedef {{ kind: 'build' } | { kind: 'approve', runId: string, stage: string, sha: string }} WorkflowGo
 */

/** The abstract stages, in order (one shared track for all mw modes) */
export const WORKFLOW_STAGES = /** @type {const} */ ([
  { id: 'released', label: 'Freigegeben', hint: 'Todo, wartet auf den Poll' },
  { id: 'briefing', label: 'Briefing & Plan', hint: 'Interview, Briefing, Rückfragen' },
  { id: 'awaiting', label: 'Wartet auf GO', hint: 'Freigabe durch Hape' },
  { id: 'building', label: 'Umsetzung', hint: 'Plan, Build, Gates, Review' },
  { id: 'review', label: 'Review', hint: 'PR offen' },
  { id: 'done', label: 'Fertig', hint: 'Gemerged / Deploy' },
]);

export const GO_LABEL = 'mw:go';
export const BUILD_LABEL = 'mw:build';
export const NEED_INPUT_LABEL = 'need-input';

const MARKER_RE = /<!--\s*mw-board:([a-z_-]+)((?:\s+[a-z_]+=\S+)*)\s*-->/g;

/**
 * mw-board markers of comment bodies in comment order; only comments by `trustedAuthors` count.
 * @param {{ body?: string | null, createdAt?: string | null, author?: { login?: string } | null }[]} comments
 * @param {string[]} trustedAuthors
 * @returns {MwMarker[]}
 */
export function parseMwMarkers(comments, trustedAuthors) {
  const out = [];
  for (const c of comments || []) {
    if (!trustedAuthors.includes(c?.author?.login ?? '')) continue;
    for (const m of String(c?.body || '').matchAll(MARKER_RE)) {
      const attrs = {};
      for (const kv of m[2].trim().split(/\s+/).filter(Boolean)) {
        const i = kv.indexOf('=');
        attrs[kv.slice(0, i)] = kv.slice(i + 1);
      }
      out.push({ kind: m[1], attrs, at: c?.createdAt ?? '' });
    }
  }
  return out;
}

/** Index of the last marker of `kind`, -1 if none */
const lastIndex = (/** @type {MwMarker[]} */ markers, /** @type {string} */ kind) =>
  markers.map((m) => m.kind).lastIndexOf(kind);

/** Display group of an mw trace phase (plan, build, gates, review, …) */
export function phaseGroup(/** @type {string} */ phase) {
  if (/review|check/.test(phase)) return 'Review';
  if (/gate/.test(phase)) return 'Gates';
  if (/plan|discovery|brief/.test(phase)) return 'Plan';
  if (/build|correction|repair|fix/.test(phase)) return 'Build';
  if (/doc/.test(phase)) return 'Doku';
  if (/pr|merge/.test(phase)) return 'PR';
  return phase;
}

/**
 * An item belongs to a workflow once mw released (`mw:go`) or picked it up (any marker).
 * @param {{ labels: { name: string }[], mwMarkers?: MwMarker[] }} item
 */
export function isWorkflowItem(item) {
  return (item.mwMarkers?.length ?? 0) > 0 || item.labels.some((l) => l.name === GO_LABEL);
}

/**
 * @param {{ labels: { name: string }[], mwMarkers?: MwMarker[] }} item
 * @param {WorkflowRun | null} [run]
 * @returns {WorkflowMode}
 */
export function workflowMode(item, run) {
  const markers = item.mwMarkers ?? [];
  const start = markers[lastIndex(markers, 'start')];
  const fromMarker = start?.attrs.mode;
  if (['orchestrate', 'pipeline', 'default', 'image'].includes(fromMarker)) return fromMarker;
  const names = item.labels.map((l) => l.name);
  if (names.includes('mw:image')) return 'image';
  if (names.includes('mw:pipeline') || run?.mode === 'pipeline') return 'pipeline';
  if (names.includes('mw:orchestrate')) return 'orchestrate';
  return 'default';
}

/**
 * @typedef {{
 *   stage: WorkflowStageId,
 *   mode: WorkflowMode,
 *   waitingOn: 'hape' | 'agent' | 'poll' | null,
 *   reason: string,
 *   phase: string | null,
 *   since: string | null,
 *   go: WorkflowGo | null,
 *   briefingPath: string | null,
 *   sessionId: string | null,
 * }} WorkflowState
 */

/**
 * The abstract stage of one issue.
 * @param {{ state: string, closedAt?: string | null, labels: { name: string }[],
 *   mwMarkers?: MwMarker[], pullRequests: { state: string }[] }} item
 * @param {string | null} statusName MACC column name (Todo, In Progress, to Review, to Deploy, Done)
 * @param {WorkflowRun | null} [run]
 * @returns {WorkflowState}
 */
export function deriveWorkflowState(item, statusName, run = null) {
  const markers = item.mwMarkers ?? [];
  const labels = new Set(item.labels.map((l) => l.name));
  const mode = workflowMode(item, run);
  const iStart = lastIndex(markers, 'start');
  const iBriefed = lastIndex(markers, 'briefed');
  const iGoal = lastIndex(markers, 'goal');
  const iAsk = lastIndex(markers, 'ask');
  const lastPhase = run?.phases.at(-1) ?? null;
  const pending = run?.pendingApproval ?? null;
  const status = (statusName ?? '').toLowerCase();
  const base = {
    mode,
    phase: lastPhase ? phaseGroup(lastPhase.phase) : null,
    briefingPath: iBriefed >= 0 ? (markers[iBriefed].attrs.path ?? null) : null,
    sessionId: iStart >= 0 ? (markers[iStart].attrs.session ?? null) : null,
  };
  const at = (/** @type {number} */ i) => (i >= 0 ? markers[i].at || null : null);
  /** @returns {WorkflowState} */
  const state = (stage, waitingOn, reason, since, go = null) => ({
    ...base,
    stage,
    waitingOn,
    reason,
    since,
    go,
  });
  const approve = (/** @type {PendingApproval} */ p) =>
    /** @type {WorkflowGo} */ ({ kind: 'approve', runId: run?.runId ?? '', ...p });

  if (item.state !== 'OPEN' || status === 'done' || status === 'to deploy') {
    const merged = item.pullRequests.some((p) => p.state === 'MERGED');
    return state(
      'done',
      null,
      status === 'to deploy' ? 'Wartet auf Deploy' : merged ? 'Gemerged' : 'Abgeschlossen',
      item.closedAt ?? null
    );
  }
  if (status === 'to review') {
    if (pending?.stage === 'pr')
      return state('review', 'hape', 'PR wartet auf Freigabe', null, approve(pending));
    return state('review', 'hape', 'PR offen, wartet auf Review', at(lastIndex(markers, 'review')));
  }
  if (labels.has(NEED_INPUT_LABEL)) return state('briefing', 'hape', 'Rückfrage offen', at(iAsk));
  if (pending)
    return state(
      'awaiting',
      'hape',
      `Freigabe ${pending.stage === 'plan' ? 'des Plans' : pending.stage === 'pr' ? 'des PRs' : 'des Briefings'}`,
      null,
      approve(pending)
    );
  if (iBriefed > iGoal) {
    return labels.has(BUILD_LABEL)
      ? state('awaiting', 'poll', 'GO gegeben, startet beim nächsten Poll', at(iBriefed))
      : state('awaiting', 'hape', 'Briefing wartet auf GO', at(iBriefed), { kind: 'build' });
  }
  if (iGoal >= 0 || lastPhase)
    return state(
      'building',
      'agent',
      base.phase ? `Phase ${base.phase}` : 'Umsetzung läuft',
      lastPhase?.at ?? at(iGoal)
    );
  if (iStart >= 0)
    return state(
      'briefing',
      'agent',
      mode === 'default' ? 'Interview & Briefing' : 'Plan entsteht',
      at(iStart)
    );
  return state('released', 'poll', 'Wartet auf den Poll', null);
}

/**
 * Whether `go` (from the client) is exactly the GO the current state offers.
 * @param {WorkflowGo | null} offered
 * @param {WorkflowGo} requested
 */
export function sameGo(offered, requested) {
  if (!offered || offered.kind !== requested.kind) return false;
  if (offered.kind === 'build') return true;
  return (
    requested.kind === 'approve' &&
    offered.runId === requested.runId &&
    offered.stage === requested.stage &&
    offered.sha === requested.sha
  );
}
