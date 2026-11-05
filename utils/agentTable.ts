import type { AgentRemoveResult, AgentSession } from '../types';
import { ALIVE, type AgentOverview } from './agentOverview';
import { repoName } from './agentSessions';

/** Overview buckets; a session can sit in several (e.g. running + needs input + cache) */
export type AgentBucket = 'running' | 'needs-input' | 'working' | 'done' | 'cache' | 'compact';

export const BUCKETS: { key: AgentBucket; label: string; tone: string }[] = [
  { key: 'running', label: 'Running', tone: 'text-white' },
  { key: 'needs-input', label: 'Needs input', tone: 'text-yellow-400' },
  { key: 'working', label: 'Working', tone: 'text-blue-400' },
  { key: 'done', label: 'Done', tone: 'text-emerald-400' },
  { key: 'cache', label: 'Cache expires', tone: 'text-orange-400' },
  { key: 'compact', label: 'Compaction needed', tone: 'text-red-400' },
];

export interface AgentRow {
  session: AgentSession;
  buckets: AgentBucket[];
  project: string;
  /** Last update, else start time */
  lastActivity: number;
  cacheMs?: number;
  fill?: number;
}

/** One row per session with its buckets, using the same derivation as summarizeAgents */
export function buildRows(sessions: AgentSession[], overview: AgentOverview): AgentRow[] {
  const cache = new Map(overview.cacheExpiring.map((c) => [c.session.id, c.remainingMs]));
  const fill = new Map(overview.needsCompaction.map((c) => [c.session.id, c.fill]));
  return sessions.map((session) => {
    const state = session.displayState;
    const buckets: AgentBucket[] = [];
    if (ALIVE.has(state)) buckets.push('running');
    if (state === 'needs-input') buckets.push('needs-input');
    if (state === 'working') buckets.push('working');
    if (state === 'completed') buckets.push('done');
    if (cache.has(session.id)) buckets.push('cache');
    if (fill.has(session.id)) buckets.push('compact');
    return {
      session,
      buckets,
      project: repoName(session),
      lastActivity: session.updatedAt || session.startedAt || 0,
      cacheMs: cache.get(session.id),
      fill: fill.get(session.id),
    };
  });
}

/** Bucket chip (null = all) and case-insensitive text search over name, cwd and project */
export function filterRows(
  rows: AgentRow[],
  bucket: AgentBucket | null,
  query: string
): AgentRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (!bucket || row.buckets.includes(bucket)) &&
      (!q ||
        [row.session.name, row.session.cwd, row.project].some((s) => s?.toLowerCase().includes(q)))
  );
}

export function sortRows(rows: AgentRow[], dir: 'asc' | 'desc'): AgentRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => sign * (a.lastActivity - b.lastActivity));
}

export type AgentGrouping = 'none' | 'status' | 'project';

const STATE_LABEL: Record<string, string> = {
  'needs-input': 'Needs input',
  working: 'Working',
  idle: 'Idle',
  loop: 'Loop',
  interactive: 'Interactive',
  completed: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
};
const STATE_ORDER = Object.keys(STATE_LABEL);

/** Groups keep the row order they get (sort first); status groups follow attention order */
export function groupRows(
  rows: AgentRow[],
  grouping: AgentGrouping
): { key: string; label: string; rows: AgentRow[] }[] {
  if (grouping === 'none') return [{ key: 'all', label: '', rows }];
  const groups = new Map<string, AgentRow[]>();
  for (const row of rows) {
    const key = grouping === 'status' ? row.session.displayState : row.project;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const keys = [...groups.keys()].sort((a, b) =>
    grouping === 'status' ? STATE_ORDER.indexOf(a) - STATE_ORDER.indexOf(b) : a.localeCompare(b)
  );
  return keys.map((key) => ({
    key,
    label: grouping === 'status' ? (STATE_LABEL[key] ?? key) : key,
    rows: groups.get(key)!,
  }));
}

/** Options for a second delete attempt after the server refused (unpushed commits, dirty worktree) */
export function removeRetryOptions(
  result: AgentRemoveResult
): { discardUnpushed?: string; forceRemoveWorktree?: string } | null {
  if (result.removed) return null;
  if (result.hints?.discardUnpushed) return { discardUnpushed: result.hints.discardUnpushed };
  if (result.hints?.forceRemoveWorktree)
    return { forceRemoveWorktree: result.hints.forceRemoveWorktree };
  return null;
}
