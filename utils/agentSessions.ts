/**
 * Grouping, sorting and formatting helpers for the agent view session list.
 */
import type { AgentSession, AgentDisplayState, AgentGrouping, AgentPrLink } from '../types';

export type GroupKey =
  | 'pinned'
  | 'review'
  | 'needs-input'
  | 'working'
  | 'completed'
  | 'interactive'
  | `dir:${string}`;

export interface SessionGroup {
  key: GroupKey;
  title: string;
  /** Directory path for directory groups (dispatch target) */
  cwd?: string;
  sessions: AgentSession[];
  /** Sessions hidden behind the "… N more" row */
  hidden: AgentSession[];
}

export const STATE_GROUP_ORDER: GroupKey[] = [
  'pinned',
  'review',
  'needs-input',
  'working',
  'completed',
  'interactive',
];

const GROUP_TITLES: Record<string, string> = {
  pinned: 'Pinned',
  review: 'Ready for review',
  'needs-input': 'Needs input',
  working: 'Working',
  completed: 'Completed',
  interactive: 'Interactive',
};

/** Maximum completed rows shown before folding into "… N more" */
export const COMPLETED_VISIBLE_LIMIT = 6;

export function hasOpenPr(session: AgentSession): boolean {
  return session.links.some((link) => !link.state || !/merged|closed/i.test(link.state));
}

export function isFinished(session: AgentSession): boolean {
  return session.state === 'done' || session.state === 'failed' || session.state === 'stopped';
}

/**
 * Sort inside a group: manual order first, then newest first.
 */
export function sortSessions(sessions: AgentSession[]): AgentSession[] {
  return [...sessions].sort((a, b) => {
    const ao = a.order ?? Number.POSITIVE_INFINITY;
    const bo = b.order ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return (b.startedAt || 0) - (a.startedAt || 0);
  });
}

function stateGroupOf(session: AgentSession): GroupKey {
  if (session.kind === 'interactive') return 'interactive';
  if (session.pinned) return 'pinned';
  if (hasOpenPr(session)) return 'review';
  if (session.state === 'blocked') return 'needs-input';
  if (session.state === 'working') return 'working';
  return 'completed';
}

/**
 * Group sessions by state (default) or by directory.
 */
export function groupSessions(
  sessions: AgentSession[],
  grouping: AgentGrouping,
  options: { expandedCompleted?: boolean; collapsed?: string[] } = {}
): SessionGroup[] {
  if (grouping === 'directory') {
    const byDir = new Map<string, AgentSession[]>();
    for (const session of sessions) {
      const list = byDir.get(session.cwd) || [];
      list.push(session);
      byDir.set(session.cwd, list);
    }
    return [...byDir.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([cwd, list]) => ({
        key: `dir:${cwd}` as GroupKey,
        title: cwd,
        cwd,
        sessions: sortSessions(list),
        hidden: [],
      }));
  }

  const buckets = new Map<GroupKey, AgentSession[]>();
  for (const key of STATE_GROUP_ORDER) buckets.set(key, []);
  for (const session of sessions) {
    buckets.get(stateGroupOf(session))!.push(session);
  }
  return STATE_GROUP_ORDER.map((key) => {
    const list = sortSessions(buckets.get(key) || []);
    if (
      key === 'completed' &&
      !options.expandedCompleted &&
      list.length > COMPLETED_VISIBLE_LIMIT
    ) {
      // Failures and open PRs always stay visible
      const alwaysVisible = list.filter((s) => s.state === 'failed' || hasOpenPr(s));
      const others = list.filter((s) => !alwaysVisible.includes(s));
      const room = Math.max(0, COMPLETED_VISIBLE_LIMIT - alwaysVisible.length);
      const visible = sortSessions([...alwaysVisible, ...others.slice(0, room)]);
      return { key, title: GROUP_TITLES[key], sessions: visible, hidden: others.slice(room) };
    }
    return { key, title: GROUP_TITLES[key], sessions: list, hidden: [] };
  });
}

/**
 * Flattened, keyboard-navigable list (group headers + rows).
 */
export type NavItem =
  | { type: 'group'; group: SessionGroup }
  | { type: 'session'; session: AgentSession; group: SessionGroup }
  | { type: 'more'; group: SessionGroup; count: number };

export function flattenGroups(
  groups: SessionGroup[],
  collapsed: Set<string>,
  hideEmpty = false
): NavItem[] {
  const items: NavItem[] = [];
  for (const group of groups) {
    if (hideEmpty && group.sessions.length === 0 && group.hidden.length === 0) continue;
    items.push({ type: 'group', group });
    if (collapsed.has(group.key)) continue;
    for (const session of group.sessions) items.push({ type: 'session', session, group });
    if (group.hidden.length > 0) items.push({ type: 'more', group, count: group.hidden.length });
  }
  return items;
}

export function summarizeSessions(sessions: AgentSession[]): {
  awaitingInput: number;
  working: number;
  completed: number;
  failed: number;
} {
  let awaitingInput = 0;
  let working = 0;
  let completed = 0;
  let failed = 0;
  for (const session of sessions) {
    if (session.kind !== 'background') continue;
    if (session.state === 'blocked') awaitingInput += 1;
    else if (session.state === 'working') working += 1;
    else if (session.state === 'failed') failed += 1;
    else if (isFinished(session)) completed += 1;
  }
  return { awaitingInput, working, completed, failed };
}

/**
 * Age since creation. Frozen at the last update once the session finished.
 */
export function sessionAgeMs(session: AgentSession, now = Date.now()): number {
  const end = isFinished(session) && session.updatedAt ? session.updatedAt : now;
  return Math.max(0, end - (session.startedAt || end));
}

export function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Icon glyph + colour for a display state, matching the TUI legend.
 */
export function stateGlyph(state: AgentDisplayState): {
  glyph: string;
  className: string;
  animate: boolean;
  label: string;
} {
  switch (state) {
    case 'working':
      return { glyph: '✽', className: 'text-orange-400', animate: true, label: 'Working' };
    case 'needs-input':
      return { glyph: '✻', className: 'text-yellow-400', animate: false, label: 'Needs input' };
    case 'idle':
      return { glyph: '∙', className: 'text-gray-500', animate: false, label: 'Idle' };
    case 'completed':
      return { glyph: '✻', className: 'text-emerald-400', animate: false, label: 'Completed' };
    case 'failed':
      return { glyph: '✻', className: 'text-red-400', animate: false, label: 'Failed' };
    case 'stopped':
      return { glyph: '✻', className: 'text-gray-500', animate: false, label: 'Stopped' };
    case 'loop':
      return { glyph: '✢', className: 'text-blue-400', animate: false, label: 'Loop (sleeping)' };
    case 'interactive':
      return { glyph: '▪', className: 'text-purple-400', animate: false, label: 'Interactive' };
    default:
      return { glyph: '∙', className: 'text-gray-500', animate: false, label: 'Unknown' };
  }
}

/**
 * PR label for the right edge of a row.
 */
export function prLabel(
  links: AgentPrLink[]
): { text: string; className: string; href: string | null } | null {
  if (links.length === 0) return null;
  if (links.length > 1) {
    return { text: `${links.length} PRs`, className: prClass(links[0].state), href: null };
  }
  const link = links[0];
  const prefix = link.provider === 'gitlab' ? '!' : '#';
  return {
    text: link.number ? `${prefix}${link.number}` : 'PR',
    className: prClass(link.state),
    href: link.href,
  };
}

function prClass(state: string | null): string {
  const value = (state || '').toLowerCase();
  if (/merged/.test(value)) return 'text-purple-400 border-purple-500/40';
  if (/draft|closed/.test(value)) return 'text-gray-500 border-gray-700';
  if (/pass|green|approved|ready/.test(value)) return 'text-emerald-400 border-emerald-500/40';
  return 'text-yellow-400 border-yellow-500/40';
}

/**
 * Title for the browser tab: "2 awaiting input · claude agents".
 */
export function documentTitle(awaitingInput: number): string {
  return awaitingInput > 0 ? `${awaitingInput} awaiting input · claude agents` : 'claude agents';
}

export function shortenPath(cwd: string, max = 40): string {
  if (cwd.length <= max) return cwd;
  const parts = cwd.split('/');
  let out = parts[parts.length - 1] || cwd;
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    const candidate = `${parts[i]}/${out}`;
    if (candidate.length > max - 2) break;
    out = candidate;
  }
  return `…/${out}`;
}
