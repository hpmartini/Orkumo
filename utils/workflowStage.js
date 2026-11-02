/**
 * Martini Workflows (mw 7): which abstract stage an issue is in, derived from its MACC column,
 * labels and `<!-- mw-board:… -->` marker comments (mw writes no local run state since 7.0).
 * Plain JS so the server (GO validation) and the client (view) share the same rule.
 */

/** @typedef {'released'|'briefing'|'awaiting'|'building'|'review'|'done'} WorkflowStageId */
/** @typedef {'default'|'image'} WorkflowMode */
/** @typedef {{ kind: string, attrs: Record<string, string>, at: string, note?: string }} MwMarker */
/** @typedef {{ kind: 'build' } | { kind: 'poll' }} WorkflowGo */
/**
 * Session switches of the `start` marker (dynamic, delegate, review) and the model/effort labels.
 * @typedef {{ dynamic: boolean, delegate: boolean, review: boolean, model: string | null,
 *   effort: string | null }} WorkflowSwitches
 */

/** The abstract stages, in order (one shared track for all mw modes) */
export const WORKFLOW_STAGES = /** @type {const} */ ([
  { id: 'released', label: 'Freigegeben', hint: 'Todo, wartet auf den Poll' },
  { id: 'briefing', label: 'Briefing & Vertrag', hint: 'Interview, Ziel-Vertrag, Rückfragen' },
  { id: 'awaiting', label: 'Wartet auf GO', hint: 'Freigabe durch Hape (mw:build)' },
  { id: 'building', label: 'Umsetzung', hint: '/goal bis PR mit Nachweisen' },
  { id: 'review', label: 'Review', hint: 'PR offen' },
  { id: 'done', label: 'Fertig', hint: 'Gemerged, Deploy, Abschluss' },
]);

export const GO_LABEL = 'mw:go';
export const BUILD_LABEL = 'mw:build';
export const NEED_INPUT_LABEL = 'need-input';
export const IMAGE_LABEL = 'mw:image';

/** Markers mw board writes when it cannot go on; the comment text holds the reason */
export const ERROR_MARKERS = {
  invalid: 'Ungültige Steuerwerte',
  noclone: 'Kein lokaler Klon',
  fail: 'Start fehlgeschlagen',
  resumefail: 'Session nicht geweckt',
  rmfail: 'Session nicht gelöscht',
};

/** Waiting on the mw-board poll: Hape may start it now instead of waiting for the next tick */
const POLL = /** @type {WorkflowGo} */ ({ kind: 'poll' });

const MARKER_RE = /<!--\s*mw-board:([a-z_-]+)((?:\s+[a-z_]+=\S+)*)\s*-->/g;
const NOTE_MAX = 300;

/**
 * mw-board markers of comment bodies in comment order; only comments by `trustedAuthors` count.
 * Error markers keep the comment text (without markers) as `note`, the reason mw gives.
 * @param {{ body?: string | null, createdAt?: string | null, author?: { login?: string } | null }[]} comments
 * @param {string[]} trustedAuthors
 * @returns {MwMarker[]}
 */
export function parseMwMarkers(comments, trustedAuthors) {
  const out = [];
  for (const c of comments || []) {
    if (!trustedAuthors.includes(c?.author?.login ?? '')) continue;
    const body = String(c?.body || '');
    for (const m of body.matchAll(MARKER_RE)) {
      const attrs = {};
      for (const kv of m[2].trim().split(/\s+/).filter(Boolean)) {
        const i = kv.indexOf('=');
        attrs[kv.slice(0, i)] = kv.slice(i + 1);
      }
      /** @type {MwMarker} */
      const marker = { kind: m[1], attrs, at: c?.createdAt ?? '' };
      if (m[1] in ERROR_MARKERS) {
        marker.note = body.replace(MARKER_RE, '').trim().slice(0, NOTE_MAX);
      }
      out.push(marker);
    }
  }
  return out;
}

/** Index of the last marker of `kind`, -1 if none */
const lastIndex = (/** @type {MwMarker[]} */ markers, /** @type {string} */ kind) =>
  markers.map((m) => m.kind).lastIndexOf(kind);

/**
 * An item belongs to a workflow once mw released (`mw:go`) or picked it up (any marker). A parent
 * with sub-issues is never a run itself (mw board runs its sub-issues), so it gets no card.
 * @param {{ labels: { name: string }[], mwMarkers?: MwMarker[], subIssues?: { total: number } }} item
 */
export function isWorkflowItem(item) {
  if ((item.subIssues?.total ?? 0) > 0) return false;
  return (item.mwMarkers?.length ?? 0) > 0 || item.labels.some((l) => l.name === GO_LABEL);
}

/**
 * Modes of mw 7 are default and image; a `start` marker of an mw 6 run (orchestrate, pipeline)
 * counts as default, since its issue now follows the default track.
 * @param {{ labels: { name: string }[], mwMarkers?: MwMarker[] }} item
 * @returns {WorkflowMode}
 */
export function workflowMode(item) {
  const markers = item.mwMarkers ?? [];
  const start = markers[lastIndex(markers, 'start')];
  if (start) return start.attrs.mode === 'image' ? 'image' : 'default';
  return item.labels.some((l) => l.name === IMAGE_LABEL) ? 'image' : 'default';
}

/**
 * Switches of the latest `start` marker, else of the labels (before the first start).
 * @param {{ labels: { name: string }[], mwMarkers?: MwMarker[] }} item
 * @returns {WorkflowSwitches}
 */
export function workflowSwitches(item) {
  const markers = item.mwMarkers ?? [];
  const start = markers[lastIndex(markers, 'start')];
  const names = item.labels.map((l) => l.name);
  const prefixed = (/** @type {string} */ p) =>
    names.find((n) => n.startsWith(p))?.slice(p.length) || null;
  const on = (/** @type {'dynamic'|'delegate'|'review'} */ k) =>
    start?.attrs[k] ? start.attrs[k] === 'on' : names.includes(`mw:${k}`);
  return {
    dynamic: start?.attrs.dynamic ? start.attrs.dynamic === 'on' : true, // mw 7 default: on
    delegate: on('delegate'),
    review: on('review'),
    model: prefixed('model:'),
    effort: prefixed('effort:'),
  };
}

/**
 * @typedef {{
 *   stage: WorkflowStageId,
 *   mode: WorkflowMode,
 *   waitingOn: 'hape' | 'agent' | 'poll' | null,
 *   reason: string,
 *   since: string | null,
 *   go: WorkflowGo | null,
 *   briefingPath: string | null,
 *   sessionId: string | null,
 *   switches: WorkflowSwitches,
 *   error: { kind: string, label: string, note: string, at: string | null } | null,
 * }} WorkflowState
 */

/**
 * The abstract stage of one issue.
 * @param {{ state: string, closedAt?: string | null, labels: { name: string }[],
 *   mwMarkers?: MwMarker[], pullRequests: { state: string }[] }} item
 * @param {string | null} statusName MACC column name (Todo, In Progress, to Review, to Deploy, Done)
 * @returns {WorkflowState}
 */
export function deriveWorkflowState(item, statusName) {
  const markers = item.mwMarkers ?? [];
  const labels = new Set(item.labels.map((l) => l.name));
  const mode = workflowMode(item);
  const iStart = lastIndex(markers, 'start');
  const iBriefed = lastIndex(markers, 'briefed');
  // fed (contract feedback) or resumed (answer) after the contract: the session revises it
  const iFed = Math.max(lastIndex(markers, 'fed'), lastIndex(markers, 'resumed'));
  const iGoal = lastIndex(markers, 'goal');
  const iAsk = lastIndex(markers, 'ask');
  const status = (statusName ?? '').toLowerCase();
  const newest = markers.at(-1);
  // An error stands until mw writes any later marker (a retry that worked, a new start)
  const error =
    newest && newest.kind in ERROR_MARKERS
      ? {
          kind: newest.kind,
          label: ERROR_MARKERS[/** @type {keyof typeof ERROR_MARKERS} */ (newest.kind)],
          note: newest.note ?? '',
          at: newest.at || null,
        }
      : null;
  const base = {
    mode,
    briefingPath: iBriefed >= 0 ? (markers[iBriefed].attrs.path ?? null) : null,
    sessionId: iStart >= 0 ? (markers[iStart].attrs.session ?? null) : null,
    switches: workflowSwitches(item),
    error,
  };
  const at = (/** @type {number} */ i) => (i >= 0 ? markers[i].at || null : null);
  /** @returns {WorkflowState} */
  const state = (stage, waitingOn, reason, since, go = null) =>
    error
      ? { ...base, stage, waitingOn: 'hape', reason: error.label, since: error.at, go: null }
      : { ...base, stage, waitingOn, reason, since, go };

  if (item.state !== 'OPEN' || status === 'done' || status === 'to deploy') {
    const merged = item.pullRequests.some((p) => p.state === 'MERGED');
    if (lastIndex(markers, 'removed') >= 0)
      return state(
        'done',
        null,
        'Abgeschlossen, Session entfernt',
        at(lastIndex(markers, 'removed'))
      );
    if (lastIndex(markers, 'wrap') >= 0)
      return state('done', 'agent', 'Session räumt auf', at(lastIndex(markers, 'wrap')));
    return state(
      'done',
      null,
      status === 'to deploy' ? 'Wartet auf Deploy' : merged ? 'Gemerged' : 'Abgeschlossen',
      item.closedAt ?? null
    );
  }
  if (status === 'to review')
    return state('review', 'hape', 'PR offen, wartet auf Review', at(lastIndex(markers, 'review')));
  if (labels.has(NEED_INPUT_LABEL)) return state('briefing', 'hape', 'Rückfrage offen', at(iAsk));
  if (iBriefed > iGoal) {
    if (iFed > iBriefed)
      return state('briefing', 'agent', 'Rückmeldung, Vertrag wird überarbeitet', at(iFed));
    return labels.has(BUILD_LABEL)
      ? state('awaiting', 'poll', 'GO gegeben, startet beim nächsten Poll', at(iBriefed), POLL)
      : state('awaiting', 'hape', 'Ziel-Vertrag wartet auf GO', at(iBriefed), { kind: 'build' });
  }
  if (iGoal >= 0) return state('building', 'agent', 'Umsetzung mit /goal', at(iGoal));
  if (iStart >= 0)
    return state(
      'briefing',
      'agent',
      mode === 'image' ? 'Bilder entstehen' : 'Interview & Ziel-Vertrag',
      at(iStart)
    );
  return state('released', 'poll', 'Wartet auf den Poll', null, POLL);
}

/**
 * Whether `go` (from the client) is exactly the GO the current state offers.
 * @param {WorkflowGo | null} offered
 * @param {WorkflowGo} requested
 */
export function sameGo(offered, requested) {
  return !!offered && offered.kind === requested.kind;
}
