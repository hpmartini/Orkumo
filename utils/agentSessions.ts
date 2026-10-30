/**
 * Grouping, sorting and formatting helpers for the agent view session list.
 */
import type {
  AgentSession,
  AgentDisplayState,
  AgentGrouping,
  AgentPrLink,
  AgentContext,
  AgentPullRequest,
  AgentCardDetails,
} from '../types';
import { isCacheWarning } from './agentCache';

export type GroupKey =
  | 'pinned'
  | 'review'
  | 'needs-input'
  | 'working'
  | 'completed'
  | 'interactive'
  | 'all'
  | `dir:${string}`
  | `project:${string}`;

export interface SessionGroup {
  key: GroupKey;
  title: string;
  /** Directory path for directory groups (dispatch target) */
  cwd?: string;
  /** DevOrbit app behind a project group (header opens its detail view) */
  appId?: string;
  sessions: AgentSession[];
  /** Sessions hidden behind the "… N more" row */
  hidden: AgentSession[];
}

/** GitHub repo ("owner/name") of a project/directory group's agents; null for state groups */
export const groupRepoSlug = (
  group: Pick<SessionGroup, 'cwd' | 'sessions'>,
  contexts: Record<string, { repo?: { slug: string | null } | null } | undefined>
): string | null =>
  (group.cwd && group.sessions.map((s) => contexts[s.id]?.repo?.slug).find(Boolean)) || null;

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

const isOpenPr = (link: AgentPrLink) => !link.state || !/merged|closed/i.test(link.state);

export function openPrCount(session: AgentSession): number {
  return session.links.filter(isOpenPr).length;
}

export function hasOpenPr(session: AgentSession): boolean {
  return session.links.some(isOpenPr);
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
  options: {
    expandedCompleted?: boolean;
    collapsed?: string[];
    sort?: AgentSort;
    lookup?: SessionLookup;
    /** DevOrbit apps, needed for the 'project' grouping */
    apps?: ProjectApp[];
  } = {}
): SessionGroup[] {
  const order = (list: AgentSession[]) =>
    options.sort ? sortSessionsBy(list, options.sort, options.lookup) : sortSessions(list);

  if (grouping === 'none') {
    return [{ key: 'all', title: 'All', sessions: order(sessions), hidden: [] }];
  }
  if (grouping === 'project') return projectGroups(sessions, order, options.apps, options.lookup);
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
        sessions: order(list),
        hidden: [],
      }));
  }

  const buckets = new Map<GroupKey, AgentSession[]>();
  for (const key of STATE_GROUP_ORDER) buckets.set(key, []);
  for (const session of sessions) {
    buckets.get(stateGroupOf(session))!.push(session);
  }
  return STATE_GROUP_ORDER.map((key) => {
    const list = order(buckets.get(key) || []);
    if (
      key === 'completed' &&
      !options.expandedCompleted &&
      list.length > COMPLETED_VISIBLE_LIMIT
    ) {
      // Failures and open PRs always stay visible
      const alwaysVisible = list.filter((s) => s.state === 'failed' || hasOpenPr(s));
      const others = list.filter((s) => !alwaysVisible.includes(s));
      const room = Math.max(0, COMPLETED_VISIBLE_LIMIT - alwaysVisible.length);
      const visible = order([...alwaysVisible, ...others.slice(0, room)]);
      return { key, title: GROUP_TITLES[key], sessions: visible, hidden: others.slice(room) };
    }
    return { key, title: GROUP_TITLES[key], sessions: list, hidden: [] };
  });
}

/** Minimal DevOrbit app shape for the 'project' grouping */
export interface ProjectApp {
  id: string;
  name: string;
  path: string;
}

const bySpecificity = <T extends ProjectApp>(apps: T[]) =>
  [...apps].sort((a, b) => b.path.length - a.path.length);

/** The session's directories and their main checkouts (worktrees join their main repo) */
function sessionDirs(session: AgentSession, lookup?: SessionLookup) {
  const root = lookup?.contexts?.[session.id]?.repo?.root;
  const dirs = [session.worktree, session.cwd].filter((d): d is string => !!d);
  // Worktrees group with their main checkout, also before contexts have loaded
  const mains = [...(root ? [root] : []), ...dirs.map(mainRepoPath)];
  return { dirs, mains };
}

/** Most specific app containing the session; `apps` must be sorted by `bySpecificity` */
function sessionApp<T extends ProjectApp>(
  session: AgentSession,
  sortedApps: T[],
  lookup?: SessionLookup
): T | undefined {
  const { dirs, mains } = sessionDirs(session, lookup);
  // App paths may differ in case from session paths (case-insensitive macOS file system)
  return sortedApps.find(
    (a) => a.path && [...dirs, ...mains].some((d) => isUnder(a.path.toLowerCase(), d.toLowerCase()))
  );
}

/**
 * Sessions belonging to a project context (#133): those whose app is a member.
 * `appIds === null` is the "all" context and keeps every session.
 */
export function sessionsInContext(
  sessions: AgentSession[],
  apps: ProjectApp[],
  appIds: string[] | null | undefined,
  lookup?: SessionLookup
): AgentSession[] {
  if (!appIds) return sessions;
  const members = new Set(appIds);
  const sorted = bySpecificity(apps);
  return sessions.filter((s) => {
    const app = sessionApp(s, sorted, lookup);
    return !!app && members.has(app.id);
  });
}

/**
 * One cluster per DevOrbit app (most specific app path wins); sessions outside every app
 * cluster by repo root (subfolders and worktrees join their main checkout) after the apps.
 * Titled by the GitHub repo name when known, with the local folder in parentheses if it differs.
 */
function projectGroups(
  sessions: AgentSession[],
  order: (list: AgentSession[]) => AgentSession[],
  apps: ProjectApp[] = [],
  lookup?: SessionLookup
): SessionGroup[] {
  const sorted = bySpecificity(apps);
  const clusters = new Map<string, SessionGroup & { matched: boolean; fallback: string }>();
  for (const session of sessions) {
    const app = sessionApp(session, sorted, lookup);
    const mainDir = sessionDirs(session, lookup).mains[0];
    // Keyed by path, not display name: the name changes once contexts load and can collide
    const key: GroupKey = app ? `project:${app.id}` : `project:dir:${mainDir}`;
    let cluster = clusters.get(key);
    if (!cluster) {
      cluster = {
        key,
        title: '',
        fallback: app ? app.name : repoName(session, lookup),
        cwd: app ? app.path : mainDir,
        appId: app?.id,
        sessions: [],
        hidden: [],
        matched: !!app,
      };
      clusters.set(key, cluster);
    }
    cluster.sessions.push(session);
  }
  for (const cluster of clusters.values()) {
    const slug = cluster.sessions
      .map((s) => lookup?.contexts?.[s.id]?.repo?.slug)
      .find((s): s is string => !!s);
    const github = slug?.split('/')[1];
    const folder = lastSegment(cluster.cwd || '');
    cluster.title = !github
      ? cluster.fallback
      : github.toLowerCase() === folder.toLowerCase()
        ? github
        : `${github} (${folder})`;
  }
  return [...clusters.values()]
    .sort((a, b) => Number(b.matched) - Number(a.matched) || a.title.localeCompare(b.title))
    .map(({ matched: _matched, fallback: _fallback, ...group }) => ({
      ...group,
      sessions: order(group.sessions),
    }));
}

// ---------------------------------------------------------------------
// Sorting and quick filters (need per-session context and matched servers)
// ---------------------------------------------------------------------

/** A dev-server port of a DevOrbit app that lives in a session's directory */
export interface AgentServer {
  port: number;
  running: boolean;
  name: string;
  /** Only set for really listening processes (AgentContext.servers) */
  command?: string;
  pid?: number;
}

/** Minimal DevOrbit app shape needed to match servers to sessions */
export interface ServerApp {
  name: string;
  path: string;
  port?: number;
  addresses?: string[];
  status?: string;
}

/** Per-session data that is not part of the session itself */
export interface SessionLookup {
  contexts?: Record<string, AgentContext | undefined>;
  servers?: Map<string, AgentServer[]>;
  /** Clock for time-dependent filters (cache expiry); defaults to Date.now() */
  now?: number;
}

export type AgentSortKey =
  | 'attention'
  | 'updated'
  | 'newest'
  | 'oldest'
  | 'name'
  | 'repo'
  | 'prs'
  | 'servers';

export interface AgentSort {
  key: AgentSortKey;
  dir: 'asc' | 'desc';
}

export const SORT_OPTIONS: {
  key: AgentSortKey;
  label: string;
  dir: 'asc' | 'desc';
  /** Whether the direction toggle makes sense */
  directional: boolean;
}[] = [
  { key: 'attention', label: 'Attention', dir: 'desc', directional: false },
  { key: 'updated', label: 'Recently updated', dir: 'desc', directional: true },
  { key: 'newest', label: 'Newest', dir: 'desc', directional: false },
  { key: 'oldest', label: 'Oldest', dir: 'asc', directional: false },
  { key: 'name', label: 'Name', dir: 'asc', directional: true },
  { key: 'repo', label: 'Repository', dir: 'asc', directional: true },
  { key: 'prs', label: 'Open PRs', dir: 'desc', directional: true },
  { key: 'servers', label: 'Running servers', dir: 'desc', directional: true },
];

export const DEFAULT_SORT: AgentSort = { key: 'attention', dir: 'desc' };

const lastSegment = (path: string) => path.split('/').filter(Boolean).pop() || path;

/**
 * Main checkout of a Claude/git worktree path ("<main>/.claude/worktrees/x" or
 * "<main>/.worktrees/x"), derived from the path alone so it works before contexts load.
 * Worktrees created elsewhere (`git worktree add ../x`) join their main checkout once the
 * server context delivers repo.root.
 */
export function mainRepoPath(dir: string): string {
  const match = dir.match(/^(.+?)\/(?:\.claude\/worktrees|\.worktrees)(?:\/|$)/);
  return match ? match[1] : dir;
}

/** Main repository name (never the worktree folder), falling back to the path-derived name */
export function repoName(session: AgentSession, lookup?: SessionLookup): string {
  return (
    lookup?.contexts?.[session.id]?.repo?.name ||
    lastSegment(mainRepoPath(session.worktree || session.cwd))
  );
}

/**
 * Repository shown in the rail: the server context, else a worktree hint from the session's
 * job state alone (context not loaded yet or git lookup failed). Branch stays unknown then.
 */
export function displayRepo(session: AgentSession, ctx?: AgentContext): AgentContext['repo'] {
  if (ctx?.repo || !session.worktree) return ctx?.repo ?? null;
  const root = mainRepoPath(session.worktree);
  return {
    name: lastSegment(root),
    root,
    slug: null,
    branch: null,
    dirty: false,
    ahead: 0,
    behind: 0,
    isWorktree: true,
    worktreeName: lastSegment(session.worktree),
    worktreePath: session.worktree,
  };
}

const MODEL_RE = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/;
const LEGACY_MODEL_RE = /^claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)(?:-\d{8})?$/;

/**
 * Display name of a model id: "claude-opus-5-5" -> "Opus 5.5", "claude-3-5-sonnet-20241022" ->
 * "Sonnet 3.5". Unknown ids stay unchanged; empty and "<synthetic>" give null.
 */
export function formatModelName(id: string | null | undefined): string | null {
  const raw = (id || '').trim();
  if (!raw || raw === '<synthetic>') return null;
  const key = raw.replace(/\[[^\]]*\]$/, '').toLowerCase();
  const modern = key.match(MODEL_RE);
  const legacy = modern ? null : key.match(LEGACY_MODEL_RE);
  const [family, major, minor] = modern
    ? [modern[1], modern[2], modern[3]]
    : legacy
      ? [legacy[3], legacy[1], legacy[2]]
      : [];
  if (!family) return raw;
  return `${family[0].toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`;
}

function runningServerCount(session: AgentSession, lookup?: SessionLookup): number {
  return (lookup?.servers?.get(session.id) || []).filter((s) => s.running).length;
}

function sortMetric(
  key: AgentSortKey,
  session: AgentSession,
  lookup?: SessionLookup
): number | string {
  switch (key) {
    case 'attention':
      return session.state === 'blocked'
        ? 3
        : session.state === 'working'
          ? 2
          : session.state === 'failed'
            ? 1
            : 0;
    case 'updated':
      return session.updatedAt || session.startedAt || 0;
    case 'newest':
    case 'oldest':
      return session.startedAt || 0;
    case 'name':
      return session.name.toLowerCase();
    case 'repo':
      return repoName(session, lookup).toLowerCase();
    case 'prs':
      return openPrCount(session);
    case 'servers':
      return runningServerCount(session, lookup);
  }
}

export function sortSessionsBy(
  sessions: AgentSession[],
  sort: AgentSort,
  lookup?: SessionLookup
): AgentSession[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...sessions].sort((a, b) => {
    const am = sortMetric(sort.key, a, lookup);
    const bm = sortMetric(sort.key, b, lookup);
    const cmp = typeof am === 'string' ? am.localeCompare(String(bm)) : am - (bm as number);
    if (cmp !== 0) return sign * cmp;
    // Ties: most recently updated first for attention, otherwise manual order, newest first
    if (sort.key === 'attention') {
      return (b.updatedAt || b.startedAt || 0) - (a.updatedAt || a.startedAt || 0);
    }
    const ao = a.order ?? Number.POSITIVE_INFINITY;
    const bo = b.order ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return (b.startedAt || 0) - (a.startedAt || 0);
  });
}

export type AgentQuickFilter =
  | 'needs-input'
  | 'working'
  | 'completed'
  | 'failed'
  | 'pr'
  | 'server'
  | 'subagents'
  | 'cache-expiring';

export const QUICK_FILTERS: { key: AgentQuickFilter; label: string; title: string }[] = [
  { key: 'needs-input', label: 'Needs input', title: 'Agents waiting for your input' },
  { key: 'working', label: 'Working', title: 'Agents currently working' },
  { key: 'completed', label: 'Completed', title: 'Agents that finished without failing' },
  { key: 'failed', label: 'Failed', title: 'Agents that failed' },
  { key: 'pr', label: 'Open PR', title: 'Agents with an open pull request' },
  { key: 'server', label: 'Server', title: 'Agents with a running dev server in their directory' },
  { key: 'subagents', label: 'Sub-agents', title: 'Agents with running sub-agents' },
  {
    key: 'cache-expiring',
    label: 'Cache expiring',
    title: 'Agents whose prompt cache expires within 10 minutes',
  },
];

const STATE_FILTERS: AgentQuickFilter[] = ['needs-input', 'working', 'completed', 'failed'];

export function matchesQuickFilter(
  key: AgentQuickFilter,
  session: AgentSession,
  lookup?: SessionLookup
): boolean {
  switch (key) {
    case 'needs-input':
      return session.state === 'blocked';
    case 'working':
      return session.state === 'working';
    case 'completed':
      return session.state === 'done' || session.state === 'stopped';
    case 'failed':
      return session.state === 'failed';
    case 'pr':
      return hasOpenPr(session);
    case 'server':
      return runningServerCount(session, lookup) > 0;
    case 'subagents':
      return (lookup?.contexts?.[session.id]?.subagents.running || 0) > 0;
    case 'cache-expiring':
      return isCacheWarning(lookup?.contexts?.[session.id]?.cache, lookup?.now ?? Date.now());
  }
}

/** State chips combine with OR (they are alternatives), attribute chips with AND. */
export function applyQuickFilters(
  sessions: AgentSession[],
  active: ReadonlySet<AgentQuickFilter>,
  lookup?: SessionLookup
): AgentSession[] {
  if (active.size === 0) return sessions;
  const states = [...active].filter((k) => STATE_FILTERS.includes(k));
  const attrs = [...active].filter((k) => !STATE_FILTERS.includes(k));
  return sessions.filter(
    (s) =>
      (states.length === 0 || states.some((k) => matchesQuickFilter(k, s, lookup))) &&
      attrs.every((k) => matchesQuickFilter(k, s, lookup))
  );
}

const isUnder = (parent: string, child: string) =>
  child === parent || child.startsWith(parent.replace(/\/+$/, '') + '/');

/**
 * DevOrbit apps whose directory equals, contains or lies inside the session's directory.
 */
export function matchServers(session: AgentSession, apps: ServerApp[]): AgentServer[] {
  const dirs = [session.cwd, session.worktree].filter((d): d is string => !!d);
  const byPort = new Map<number, AgentServer>();
  for (const app of apps) {
    if (!app.path || !dirs.some((d) => isUnder(app.path, d) || isUnder(d, app.path))) continue;
    const running = app.status === 'RUNNING';
    const ports = new Set<number>();
    if (app.port) ports.add(app.port);
    for (const address of app.addresses || []) {
      const port = Number(address.match(/:(\d{2,5})(?:[/?#]|$)/)?.[1]);
      if (port) ports.add(port);
    }
    for (const port of ports) {
      const prev = byPort.get(port);
      byPort.set(port, { port, name: prev?.name || app.name, running: running || !!prev?.running });
    }
  }
  return [...byPort.values()].sort(
    (a, b) => Number(b.running) - Number(a.running) || a.port - b.port
  );
}

/**
 * A session's servers: DevOrbit apps in its directory plus really listening
 * processes (AgentContext.servers), deduped by port. Listening processes win
 * because they prove the port is live.
 */
export function mergeServers(
  session: AgentSession,
  apps: ServerApp[],
  context?: AgentContext
): AgentServer[] {
  const byPort = new Map<number, AgentServer>();
  for (const server of matchServers(session, apps)) byPort.set(server.port, server);
  for (const live of context?.servers || []) {
    byPort.set(live.port, {
      port: live.port,
      running: true,
      name: byPort.get(live.port)?.name || live.command,
      command: live.command,
      pid: live.pid,
    });
  }
  return [...byPort.values()].sort(
    (a, b) => Number(b.running) - Number(a.running) || a.port - b.port
  );
}

export interface PullRequestRow {
  pr: AgentPullRequest;
  /** Sessions whose current branch is the PR's head branch */
  agents: AgentSession[];
}

/**
 * Every open PR across all agent repos, deduped by repo + number, merge-ready
 * first, then most recently updated.
 */
export function collectPullRequests(
  sessions: AgentSession[],
  contexts: Record<string, AgentContext | undefined>
): PullRequestRow[] {
  const rows = new Map<string, PullRequestRow>();
  for (const session of sessions) {
    const ctx = contexts[session.id];
    for (const pr of ctx?.pulls?.items || []) {
      const key = `${pr.repoSlug.toLowerCase()}#${pr.number}`;
      const row = rows.get(key) || { pr, agents: [] };
      if (ctx?.repo?.branch === pr.headRef) row.agents.push(session);
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      Number(b.pr.mergeReady) - Number(a.pr.mergeReady) ||
      (Date.parse(b.pr.updatedAt) || 0) - (Date.parse(a.pr.updatedAt) || 0)
  );
}

/** Totals across all sessions for the summary bar. */
export function summarizeContext(
  sessions: AgentSession[],
  lookup?: SessionLookup
): { openPrs: number | null; runningServers: number | null } {
  const ports = new Set<number>();
  const prs = new Set<string>();
  const contexts = lookup?.contexts || {};
  // Links carry no live state (merged PRs look open) and servers need lsof, so until
  // /context has answered the totals are unknown (null), not 0.
  if (Object.keys(contexts).length === 0 && sessions.length > 0) {
    return { openPrs: null, runningServers: null };
  }
  for (const session of sessions) {
    for (const pr of contexts[session.id]?.pulls?.items || []) prs.add(pr.url);
    for (const server of lookup?.servers?.get(session.id) || []) {
      if (server.running) ports.add(server.port);
    }
  }
  return { openPrs: prs.size, runningServers: ports.size };
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
    // The flat list has no header row
    if (group.key !== 'all') items.push({ type: 'group', group });
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
  if (!Number.isFinite(ms)) return '?';
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
 * Whether a session card shows its details. A click on the chevron pins them in every mode;
 * in `hover` mode the hovered card and the keyboard-selected card (rail focused) show them too.
 */
export function cardDetailsVisible(
  mode: AgentCardDetails,
  state: { hasDetails: boolean; pinned: boolean; hovered: boolean; focused: boolean }
): boolean {
  if (!state.hasDetails) return false;
  if (mode === 'always' || state.pinned) return true;
  return mode === 'hover' && (state.hovered || state.focused);
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
