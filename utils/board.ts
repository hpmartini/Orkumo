/**
 * Pure helpers for the agent task board (/board, #44): columns, slices, lanes,
 * agent <-> issue derivation and column colours.
 */
import type {
  AgentSession,
  BoardIssueRef,
  BoardItem,
  BoardSettings,
  BoardSliceKind,
  BoardStatusOption,
  BoardSwimlaneMode,
} from '../types';

export const DONE_WINDOW_DAYS = 14;
/** Column key for items without (or with an unknown) status */
export const UNSET_STATUS = '__none__';

const DAY_MS = 24 * 60 * 60 * 1000;

export function issueKey(repo: string, number: number): string {
  return `${repo}#${number}`;
}

/**
 * "#12", "12", "owner/name#12" or an issue URL -> { repo, number }; `defaultRepo` fills a bare number.
 * null when the text is not an issue reference.
 */
export function parseIssueRef(
  text: string,
  defaultRepo: string | null
): { repo: string; number: number } | null {
  const t = text.trim();
  const m =
    t.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)\/?$/) ??
    t.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/) ??
    t.match(/^()#?(\d+)$/);
  if (!m) return null;
  const repo = m[1] || defaultRepo;
  const number = Number(m[2]);
  return repo && number > 0 ? { repo, number } : null;
}

/** Stable item key: "owner/name#12", or the project item id for drafts */
export function itemKey(item: BoardItem): string {
  return item.repo && item.number != null ? issueKey(item.repo, item.number) : item.itemId;
}

export function shortRepo(repo: string | null): string {
  if (!repo) return '';
  return repo.slice(repo.lastIndexOf('/') + 1);
}

export function isDoneOption(o: BoardStatusOption): boolean {
  return /^done$/i.test(o.name.trim());
}

export function columnKeyOf(item: BoardItem, options: BoardStatusOption[]): string {
  const id = item.statusOptionId;
  return id && options.some((o) => o.id === id) ? id : UNSET_STATUS;
}

export function boardColumns(
  options: BoardStatusOption[],
  items: BoardItem[]
): { key: string; option: BoardStatusOption | null }[] {
  const columns: { key: string; option: BoardStatusOption | null }[] = options.map((option) => ({
    key: option.id,
    option,
  }));
  if (items.some((item) => columnKeyOf(item, options) === UNSET_STATUS)) {
    columns.push({ key: UNSET_STATUS, option: null });
  }
  return columns;
}

export function withinDoneWindow(item: BoardItem, now: number, days = DONE_WINDOW_DAYS): boolean {
  const at = Date.parse(item.closedAt ?? item.updatedAt);
  return Number.isFinite(at) && now - at <= days * DAY_MS;
}

// --- Slices -----------------------------------------------------------------

export function sliceValues(item: BoardItem, kind: BoardSliceKind): string[] {
  switch (kind) {
    case 'repo':
      return item.repo ? [item.repo] : [];
    case 'label':
      return item.labels.map((l) => l.name);
    case 'milestone':
      return item.milestone ? [item.milestone] : [];
    case 'assignee':
      return item.assignees;
  }
}

export function sliceKey(kind: BoardSliceKind, value: string): string {
  return `${kind}:${value}`;
}

export interface SliceEntry {
  key: string;
  kind: BoardSliceKind;
  value: string;
  count: number;
  favorite: boolean;
  hidden: boolean;
}

export function buildSlices(
  items: BoardItem[],
  kind: BoardSliceKind,
  settings: Pick<BoardSettings, 'favorites' | 'order' | 'hidden'>
): { favorites: SliceEntry[]; others: SliceEntry[]; hidden: SliceEntry[] } {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const value of new Set(sliceValues(item, kind))) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  const favorites = new Set(settings.favorites);
  const hidden = new Set(settings.hidden);
  const rank = new Map(settings.order.map((key, i) => [key, i]));

  const entries: SliceEntry[] = [...counts].map(([value, count]) => {
    const key = sliceKey(kind, value);
    return { key, kind, value, count, favorite: favorites.has(key), hidden: hidden.has(key) };
  });
  entries.sort((a, b) => {
    const ra = rank.get(a.key) ?? Infinity;
    const rb = rank.get(b.key) ?? Infinity;
    if (ra !== rb) return ra - rb;
    if (a.count !== b.count) return b.count - a.count;
    return a.value.localeCompare(b.value);
  });

  return {
    favorites: entries.filter((e) => e.favorite && !e.hidden),
    others: entries.filter((e) => !e.favorite && !e.hidden),
    hidden: entries.filter((e) => e.hidden),
  };
}

export function filterItems(
  items: BoardItem[],
  opts: {
    kind: BoardSliceKind;
    selected: string | null;
    hidden: string[];
    agentIssueKeys?: Set<string> | null;
  }
): BoardItem[] {
  const hidden = new Set(opts.hidden);
  return items.filter((item) => {
    if (item.repo && hidden.has(sliceKey('repo', item.repo))) return false;
    const values = sliceValues(item, opts.kind);
    if (values.some((v) => hidden.has(sliceKey(opts.kind, v)))) return false;
    if (opts.selected !== null && !values.includes(opts.selected)) return false;
    if (opts.agentIssueKeys && !opts.agentIssueKeys.has(itemKey(item))) return false;
    return true;
  });
}

/**
 * Board filter of a project context: for every kind it names, the item needs one of the
 * listed values (OR within a kind, AND across kinds). An empty filter keeps everything.
 */
export function matchesContextFilter(item: BoardItem, filter: string[]): boolean {
  const byKind = new Map<BoardSliceKind, string[]>();
  for (const key of filter) {
    const kind = key.slice(0, key.indexOf(':')) as BoardSliceKind;
    byKind.set(kind, [...(byKind.get(kind) ?? []), key]);
  }
  return [...byKind].every(([kind, keys]) =>
    sliceValues(item, kind).some((v) => keys.includes(sliceKey(kind, v)))
  );
}

/** Parses "label:epic-x, milestone:v2" into slice keys; unknown kinds and empty values drop */
export function parseContextFilter(text: string): string[] {
  const kinds = ['repo', 'label', 'milestone', 'assignee'];
  return [
    ...new Set(
      text
        .split(',')
        .map((part) => part.trim())
        .filter((key) => {
          const colon = key.indexOf(':');
          return colon > 0 && kinds.includes(key.slice(0, colon)) && key.slice(colon + 1).trim();
        })
    ),
  ];
}

/** Search box: "label:ui" matches label names, anything else "#nr title" (repo included). */
export function matchesQuery(item: BoardItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (q.startsWith('label:')) {
    const name = q.slice(6).trim();
    return item.labels.some((l) => l.name.toLowerCase().includes(name));
  }
  return `${item.repo ?? ''}#${item.number ?? ''} ${item.title}`.toLowerCase().includes(q);
}

/** `?repo=owner/name` overrides the stored slice: repo slice with that repo selected. */
export function sliceFromRepoParam(
  view: { sliceKind: BoardSliceKind; selected: string | null },
  repo: string | null
): { sliceKind: BoardSliceKind; selected: string | null } {
  return repo
    ? { sliceKind: 'repo', selected: repo }
    : { sliceKind: view.sliceKind, selected: view.selected };
}

/** Moves `key` before `beforeKey` (null = to the end). Keys of other kinds in `order` are kept. */
export function moveSliceKey(
  order: string[],
  allKeys: string[],
  key: string,
  beforeKey: string | null
): string[] {
  const known = new Set(order);
  const full = [...order, ...allKeys.filter((k) => !known.has(k))].filter((k) => k !== key);
  const at = beforeKey === null ? -1 : full.indexOf(beforeKey);
  full.splice(at === -1 ? full.length : at, 0, key);
  return full;
}

// --- Swimlanes --------------------------------------------------------------

export interface Lane {
  key: string;
  title: string;
  parent: BoardIssueRef | null;
  items: BoardItem[];
  done: number;
  total: number;
}

export const NO_PARENT_LANE = 'parent:none';
export const NO_REPO_LANE = 'repo:none';

export function buildLanes(
  items: BoardItem[],
  mode: BoardSwimlaneMode,
  doneOptionIds: Set<string>
): Lane[] {
  const lanes = new Map<string, Lane>();
  const add = (key: string, title: string, parent: BoardIssueRef | null, item: BoardItem) => {
    let lane = lanes.get(key);
    if (!lane) {
      lane = { key, title, parent, items: [], done: 0, total: 0 };
      lanes.set(key, lane);
    }
    lane.items.push(item);
    lane.total++;
    if (item.statusOptionId && doneOptionIds.has(item.statusOptionId)) lane.done++;
  };

  for (const item of items) {
    if (mode === 'parent') {
      const p = item.parent;
      if (p) add(issueKey(p.repo, p.number), p.title, p, item);
      else add(NO_PARENT_LANE, 'Ohne Parent', null, item);
    } else if (mode === 'repo') {
      if (item.repo) add(`repo:${item.repo}`, shortRepo(item.repo), null, item);
      else add(NO_REPO_LANE, 'Ohne Repo', null, item);
    } else {
      add('all', 'Alle', null, item);
    }
  }

  const isRest = (l: Lane) => l.key === NO_PARENT_LANE || l.key === NO_REPO_LANE;
  return [...lanes.values()].sort((a, b) => {
    if (isRest(a) !== isRest(b)) return isRest(a) ? 1 : -1;
    if (a.total !== b.total) return b.total - a.total;
    return a.title.localeCompare(b.title);
  });
}

// --- Agent <-> issue links (derived, never manual) --------------------------

export interface AgentIssueLink {
  jobId: string;
  issueKey: string;
  via: 'mw-board' | 'pr';
}

const normUrl = (url: string) => url.replace(/\/+$/, '');

export function deriveAgentLinks(
  items: BoardItem[],
  sessions: Pick<AgentSession, 'id' | 'sessionId' | 'links'>[]
): AgentIssueLink[] {
  const links = new Map<string, AgentIssueLink>();
  const add = (link: AgentIssueLink) => {
    const k = `${link.jobId}|${link.issueKey}`;
    if (!links.has(k)) links.set(k, link);
  };

  // mw-board first so it wins the dedup
  for (const item of items) {
    for (const uuid of item.mwBoardSessions) {
      const short = uuid.slice(0, 8);
      const live =
        sessions.find((s) => s.sessionId === uuid) ?? sessions.find((s) => s.id === short);
      add({ jobId: live?.id ?? short, issueKey: itemKey(item), via: 'mw-board' });
    }
  }

  const prOwners = new Map<string, string[]>();
  for (const item of items) {
    const urls = item.pullRequests.map((pr) => pr.url);
    if (item.type === 'PullRequest' && item.url) urls.push(item.url);
    for (const url of new Set(urls.map(normUrl))) {
      prOwners.set(url, [...(prOwners.get(url) ?? []), itemKey(item)]);
    }
  }
  for (const session of sessions) {
    for (const link of session.links ?? []) {
      for (const key of prOwners.get(normUrl(link.href)) ?? []) {
        add({ jobId: session.id, issueKey: key, via: 'pr' });
      }
    }
  }

  return [...links.values()];
}

function groupBy(links: AgentIssueLink[], by: 'issueKey' | 'jobId'): Map<string, string[]> {
  const other = by === 'issueKey' ? 'jobId' : 'issueKey';
  const map = new Map<string, string[]>();
  for (const link of links) {
    const list = map.get(link[by]) ?? [];
    if (!list.includes(link[other])) list.push(link[other]);
    map.set(link[by], list);
  }
  return map;
}

export function linksByIssue(links: AgentIssueLink[]): Map<string, string[]> {
  return groupBy(links, 'issueKey');
}

export function linksByAgent(links: AgentIssueLink[]): Map<string, string[]> {
  return groupBy(links, 'jobId');
}

// --- Column colours (from the approved mockup, briefings/mockups/44-board.html) ---

/** GitHub ProjectV2 color name -> accent hex. MACC: Backlog GRAY, Todo BLUE, In Progress YELLOW, … */
const COLUMN_ACCENTS: Record<string, string> = {
  GRAY: '#94a8d6',
  BLUE: '#7dd3fc',
  YELLOW: '#fde047',
  PURPLE: '#c4b5fd',
  ORANGE: '#fdba74',
  GREEN: '#6ee7b7',
  RED: '#fca5a5',
  PINK: '#f9a8d4',
};

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Mockup: header background `${hex}24` (alpha .14), cell background `${hex}14` (alpha .08). */
export function columnTint(color: string): { head: string; cell: string } {
  const hex = COLUMN_ACCENTS[color.toUpperCase()] ?? COLUMN_ACCENTS.GRAY;
  return { head: rgba(hex, 0.14), cell: rgba(hex, 0.08) };
}
