/**
 * Agent Task Board: reads a GitHub ProjectV2 (all items + Status field) via `gh api graphql`
 * and writes an item's Status. Status comes from each item's field value, never from views.
 */
import { execFile } from 'child_process';
import { parseGithubSlug } from './agentContextService.js';
import { keepWrite, mergeRecentWrites } from '../../utils/boardWrites.js';
import { parseMwMarkers } from '../../utils/workflowStage.js';

const CACHE_TTL_MS = 60_000;
const PAGE_SIZE = 100; // measured on MACC: cost 4 per page with comments(last:20)
const MIN_PAGE_SIZE = 25;
const MW_BOARD_RE = /<!--\s*mw-board:start\s+session=([0-9a-f-]{36})/g;

const PR_FIELDS = 'number url title state repository{nameWithOwner} statusCheckRollup{state}';
// One ProjectV2Item node with its content; shared by the board query and single-item refetches
const ITEM_FIELDS = `id
  fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{optionId}}
  content{
    __typename
    ... on DraftIssue{title updatedAt}
    ... on Issue{id number title url state stateReason updatedAt closedAt repository{nameWithOwner}
      parent{id number title repository{nameWithOwner}} subIssuesSummary{total completed}
      labels(first:20){nodes{name color}} milestone{title} assignees(first:10){nodes{login}}
      closedByPullRequestsReferences(first:10){nodes{${PR_FIELDS}}}
      comments(last:20){nodes{body createdAt author{login}}}}
    ... on PullRequest{${PR_FIELDS} updatedAt closedAt
      labels(first:20){nodes{name color}} milestone{title} assignees(first:10){nodes{login}}
      comments(last:20){nodes{body}}}
  }`;
const ITEMS_QUERY = `query($owner:String!,$number:Int!,$first:Int!,$after:String){
  rateLimit{cost remaining}
  repositoryOwner(login:$owner){
    ... on User{projectV2(number:$number){...P}}
    ... on Organization{projectV2(number:$number){...P}}
  }
}
fragment P on ProjectV2{
  id title
  field(name:"Status"){... on ProjectV2SingleSelectField{id options{id name color}}}
  items(first:$first,after:$after){
    pageInfo{hasNextPage endCursor}
    nodes{${ITEM_FIELDS}}
  }
}`;
const ITEM_QUERY = `query($id:ID!){node(id:$id){... on ProjectV2Item{${ITEM_FIELDS}}}}`;
const STATUS_MUTATION = `mutation($projectId:ID!,$itemId:ID!,$fieldId:ID!,$optionId:String!){
  updateProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId,value:{singleSelectOptionId:$optionId}}){
    projectV2Item{id}
  }
}`;

let cache = null; // { key, at, data }
let inflight = null; // { key, promise }
// Items this server wrote (status, create, edit), newest per item: { key, at, item, created }.
// A fetch that started before a write must not undo it in the cache.
const recentWrites = new Map();

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

/**
 * Runs `gh api graphql` with an argument array (no shell); -f = string, -F = typed var.
 * Array string vars become `-f k[]=v` per element (`-F k[]` = empty list).
 * `typedVars` is only for numbers and `null`: `-F k=@path` makes gh read a local file, so a
 * user-supplied string must never go there (splitVars keeps every string in `stringVars`).
 */
function ghGraphql(query, stringVars = {}, typedVars = {}) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(stringVars)) {
    if (!Array.isArray(v)) args.push('-f', `${k}=${v}`);
    else if (v.length === 0) args.push('-F', `${k}[]`);
    else for (const el of v) args.push('-f', `${k}[]=${el}`);
  }
  for (const [k, v] of Object.entries(typedVars)) args.push('-F', `${k}=${v}`);
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      args,
      { timeout: 30_000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        let payload = null;
        try {
          payload = JSON.parse(String(stdout || ''));
        } catch {
          /* non-JSON output, handled below */
        }
        if (payload?.errors?.length) {
          return reject(
            httpError(`GitHub: ${payload.errors.map((e) => e.message).join('; ')}`, 502)
          );
        }
        // ENOENT reads like a wrong directory (#106); it means `gh` is not on the server's PATH
        if (error?.code === 'ENOENT') {
          return reject(
            httpError(
              `GitHub CLI (gh) nicht gefunden: nicht im PATH des Orkumo-Servers (${process.env.PATH || 'leer'}). gh installieren bzw. Desktop-App von main neu bauen.`,
              502
            )
          );
        }
        if (error || !payload) {
          return reject(
            httpError(`gh failed: ${String(stderr || error?.message || 'no output').trim()}`, 502)
          );
        }
        resolve(payload.data);
      }
    );
  });
}

/** statusCheckRollup.state -> BoardCheckState */
export function mapCheckState(state) {
  if (state === 'SUCCESS') return 'success';
  if (state === 'FAILURE' || state === 'ERROR') return 'failure';
  if (state === 'PENDING' || state === 'EXPECTED') return 'pending';
  return null;
}

/** Unique session UUIDs from mw-board start markers in comment bodies. */
export function parseMwBoardSessions(bodies) {
  const ids = new Set();
  for (const body of bodies || []) {
    for (const m of String(body || '').matchAll(MW_BOARD_RE)) ids.add(m[1]);
  }
  return [...ids];
}

function mapPullRequest(pr) {
  return {
    repo: pr.repository?.nameWithOwner ?? '',
    number: pr.number,
    url: pr.url,
    title: pr.title ?? null,
    state: pr.state,
    checks: mapCheckState(pr.statusCheckRollup?.state),
  };
}

/**
 * ProjectV2Item node -> BoardItem. `trustedAuthors`: logins whose mw-board markers count (the board
 * owner, as mw's approvers); anyone else can comment a marker-like text.
 */
export function mapItem(node, trustedAuthors = []) {
  const c = node?.content || {};
  const type =
    c.__typename === 'PullRequest' || c.__typename === 'DraftIssue' ? c.__typename : 'Issue';
  const isDraft = type === 'DraftIssue';
  const pullRequests =
    type === 'PullRequest'
      ? [mapPullRequest(c)]
      : (c.closedByPullRequestsReferences?.nodes || []).filter(Boolean).map(mapPullRequest);
  return {
    itemId: node.id,
    type,
    /** Issue node id (I_…) for edits; null for PRs and drafts */
    issueId: type === 'Issue' ? (c.id ?? null) : null,
    number: isDraft ? null : (c.number ?? null),
    title: c.title ?? '',
    url: isDraft ? null : (c.url ?? null),
    repo: isDraft ? null : (c.repository?.nameWithOwner ?? null),
    state: isDraft ? 'OPEN' : (c.state ?? 'OPEN'),
    stateReason: c.stateReason ?? null,
    statusOptionId: node.fieldValueByName?.optionId ?? null,
    labels: (c.labels?.nodes || []).map((l) => ({ name: l.name, color: l.color })),
    milestone: c.milestone?.title ?? null,
    assignees: (c.assignees?.nodes || []).map((a) => a.login),
    parent: c.parent
      ? {
          id: c.parent.id,
          repo: c.parent.repository?.nameWithOwner ?? '',
          number: c.parent.number,
          title: c.parent.title,
        }
      : null,
    subIssues: {
      total: c.subIssuesSummary?.total ?? 0,
      completed: c.subIssuesSummary?.completed ?? 0,
    },
    pullRequests,
    mwBoardSessions: parseMwBoardSessions((c.comments?.nodes || []).map((n) => n?.body)),
    mwMarkers: parseMwMarkers(c.comments?.nodes || [], trustedAuthors),
    updatedAt: c.updatedAt ?? '',
    closedAt: c.closedAt ?? null,
  };
}

async function fetchPage(source, after, first) {
  try {
    const typed = { number: source.number, first };
    return await ghGraphql(
      ITEMS_QUERY,
      { owner: source.owner, ...(after ? { after } : {}) },
      typed
    );
  } catch (error) {
    // Node-limit / cost errors: retry the same page smaller.
    if (first > MIN_PAGE_SIZE && /node|cost|limit|exceed/i.test(error.message)) {
      return fetchPage(source, after, Math.floor(first / 2));
    }
    throw error;
  }
}

async function loadBoard(source) {
  const items = [];
  let project = null;
  let after = null;
  let cost = 0;
  let remaining = null;
  do {
    const data = await fetchPage(source, after, PAGE_SIZE);
    project = data?.repositoryOwner?.projectV2;
    if (!project) {
      throw httpError(`Project ${source.owner}/${source.number} not found or not accessible`, 404);
    }
    cost += data.rateLimit?.cost ?? 0;
    remaining = data.rateLimit?.remaining ?? remaining;
    items.push(...project.items.nodes.filter(Boolean).map((n) => mapItem(n, [source.owner])));
    after = project.items.pageInfo.hasNextPage ? project.items.pageInfo.endCursor : null;
  } while (after);
  if (!project.field?.id) {
    throw httpError(
      `Project ${source.owner}/${source.number} has no "Status" single-select field`,
      502
    );
  }
  console.log(
    `[board] fetched ${items.length} items, GraphQL cost ${cost}, remaining ${remaining}`
  );
  return {
    source: { owner: source.owner, number: source.number },
    projectId: project.id,
    title: project.title,
    statusField: { id: project.field.id, options: project.field.options },
    items,
    fetchedAt: Date.now(),
  };
}

const cacheKey = (source) => `${source.owner}/${source.number}`;

/** BoardData for the source; cached CACHE_TTL_MS, `refresh` bypasses. Concurrent calls share one fetch. */
export async function getBoard(source, { refresh = false } = {}) {
  const key = cacheKey(source);
  if (!refresh && cache?.key === key && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  if (inflight?.key === key) return inflight.promise;
  const startedAt = Date.now();
  const promise = loadBoard(source)
    .then((data) => {
      const now = Date.now();
      const writes = [...recentWrites.values()].filter((w) => w.key === key);
      data.items = mergeRecentWrites(data.items, writes, startedAt, now);
      for (const w of writes) if (!keepWrite(w, startedAt, now)) recentWrites.delete(w.item.itemId);
      cache = { key, at: now, data };
      return data;
    })
    .finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
  inflight = { key, promise };
  return promise;
}

/** Sets an item's Status option; validates against the (cached) status field and patches the cache. */
export async function setItemStatus(source, itemId, optionId) {
  const board = await getBoard(source);
  if (!board.statusField.options.some((o) => o.id === optionId)) {
    throw httpError('Unknown status option', 400);
  }
  const item = board.items.find((i) => i.itemId === itemId);
  if (!item) throw httpError('Item not on this board', 404);
  await ghGraphql(STATUS_MUTATION, {
    projectId: board.projectId,
    itemId,
    fieldId: board.statusField.id,
    optionId,
  });
  rememberItem(source, { ...item, statusOptionId: optionId });
  return { itemId, statusOptionId: optionId };
}

export function clearCache() {
  cache = null;
  projectMeta = null;
  recentWrites.clear();
}

/** Puts a written item into the cache and keeps it over fetches that predate the write. */
function rememberItem(source, item, created = false) {
  const key = cacheKey(source);
  const before = recentWrites.get(item.itemId);
  recentWrites.set(item.itemId, {
    key,
    at: Date.now(),
    item,
    created: created || (before?.key === key && before.created),
  });
  if (cache?.key !== key) return;
  const items = cache.data.items;
  const i = items.findIndex((x) => x.itemId === item.itemId);
  if (i >= 0) items[i] = item;
  else items.push(item);
}

// Project id and Status field only: issue creation needs them, not all items (cold cache ~10 s)
const PROJECT_META_QUERY = `query($owner:String!,$number:Int!){
  repositoryOwner(login:$owner){
    ... on User{projectV2(number:$number){...M}}
    ... on Organization{projectV2(number:$number){...M}}
  }
}
fragment M on ProjectV2{id field(name:"Status"){... on ProjectV2SingleSelectField{id options{id name color}}}}`;
let projectMeta = null; // { key, at, data: { projectId, statusField } }

/** projectId and Status field of the board project: from a fresh board cache, else one small query */
async function getProjectMeta(source) {
  const key = cacheKey(source);
  const fresh = (c) => c?.key === key && Date.now() - c.at < CACHE_TTL_MS;
  if (fresh(cache)) return { projectId: cache.data.projectId, statusField: cache.data.statusField };
  if (fresh(projectMeta)) return projectMeta.data;
  const typed = { number: source.number };
  const project = (await ghGraphql(PROJECT_META_QUERY, { owner: source.owner }, typed))
    ?.repositoryOwner?.projectV2;
  if (!project) {
    throw httpError(`Project ${source.owner}/${source.number} not found or not accessible`, 404);
  }
  if (!project.field?.id) {
    throw httpError(
      `Project ${source.owner}/${source.number} has no "Status" single-select field`,
      502
    );
  }
  const data = {
    projectId: project.id,
    statusField: { id: project.field.id, options: project.field.options },
  };
  projectMeta = { key, at: Date.now(), data };
  return data;
}

/**
 * 403 unless `slug` is a repo this server may write to: one with a local checkout Orkumo knows
 * (`findLocal(slug)` -> path|null) or one with items on the board project. The gh token can
 * write far more repos; remote access must not reach them.
 */
export async function assertRepoWritable(source, slug, findLocal) {
  const want = String(slug).toLowerCase();
  const onBoard = (data) => data.items.some((i) => i.repo?.toLowerCase() === want);
  // Cheapest first: a stale cache still proves the repo was on the board; the local lookup
  // lists agent sessions (~1 s); only a miss on both pays for a full board load
  if (cache?.key === cacheKey(source) && onBoard(cache.data)) return;
  if (await findLocal(slug)) return;
  if (onBoard(await getBoard(source))) return;
  throw httpError(`Repository ${slug} is not on the board and has no local checkout`, 403);
}

// ---------------------------------------------------------------------------
// Create and edit issues (#72)
// ---------------------------------------------------------------------------

// Hard stop for cursor paging (20 x 100 = 2000 nodes per connection) against a looping cursor
export const MAX_PAGES = 20;
const PAGE_INFO = 'pageInfo{hasNextPage endCursor}';

/**
 * All nodes of a connection whose first page is `first`; `nextPage(cursor)` fetches the next
 * connection page. Throws instead of silently truncating after MAX_PAGES.
 */
async function allNodes(first, nextPage) {
  const nodes = [...(first?.nodes || [])];
  let page = first;
  for (let n = 1; page?.pageInfo?.hasNextPage; n++) {
    if (n >= MAX_PAGES) throw httpError(`GitHub list longer than ${MAX_PAGES} pages`, 502);
    page = await nextPage(page.pageInfo.endCursor);
    nodes.push(...(page?.nodes || []));
  }
  return nodes.filter(Boolean);
}

const OPTIONS_TTL_MS = 5 * 60_000;
const REPO_CONNECTIONS = {
  labels: { args: 'orderBy:{field:NAME,direction:ASC}', fields: 'id name color' },
  assignableUsers: { args: '', fields: 'id login' },
  milestones: { args: 'states:OPEN,orderBy:{field:DUE_DATE,direction:ASC}', fields: 'id title' },
};
const connection = (name, after = '') => {
  const { args, fields } = REPO_CONNECTIONS[name];
  return `${name}(first:100${after}${args && `,${args}`}){${PAGE_INFO} nodes{${fields}}}`;
};
const REPO_OPTIONS_QUERY = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){
  id ${Object.keys(REPO_CONNECTIONS)
    .map((n) => connection(n))
    .join(' ')}
}}`;
const repoConnectionQuery = (name) =>
  `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){${connection(name, ',after:$after')}}}`;
const ISSUE_ID_QUERY = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){id}}}`;
const ISSUE_DETAILS_QUERY = `query($id:ID!,$after:String){node(id:$id){... on Issue{
  body
  subIssues(first:100,after:$after){${PAGE_INFO} nodes{id number title state repository{nameWithOwner}}}
}}}`;
const CREATE_ISSUE_MUTATION = `mutation($repositoryId:ID!,$title:String!,$body:String,$labelIds:[ID!],$assigneeIds:[ID!],$milestoneId:ID){
  createIssue(input:{repositoryId:$repositoryId,title:$title,body:$body,labelIds:$labelIds,assigneeIds:$assigneeIds,milestoneId:$milestoneId}){issue{id number url}}
}`;
// Live state of an issue: edits decide close/reopen and the old parent from this, not the cache
const ISSUE_STATE_QUERY = `query($id:ID!){node(id:$id){... on Issue{state stateReason parent{id}}}}`;
const ADD_ITEM_MUTATION = `mutation($projectId:ID!,$contentId:ID!){
  addProjectV2ItemById(input:{projectId:$projectId,contentId:$contentId}){item{id}}
}`;
const CLOSE_MUTATION = `mutation($id:ID!,$reason:IssueClosedStateReason){closeIssue(input:{issueId:$id,stateReason:$reason}){issue{id}}}`;
const REOPEN_MUTATION = `mutation($id:ID!){reopenIssue(input:{issueId:$id}){issue{id}}}`;
const ADD_SUB_MUTATION = `mutation($parentId:ID!,$subId:ID!){
  addSubIssue(input:{issueId:$parentId,subIssueId:$subId,replaceParent:true}){issue{id}}
}`;
const REMOVE_SUB_MUTATION = `mutation($parentId:ID!,$subId:ID!){
  removeSubIssue(input:{issueId:$parentId,subIssueId:$subId}){issue{id}}
}`;

const repoOptionsCache = new Map(); // slug -> { at, data }

/** Labels, assignable users and open milestones of `owner/name` (cached), plus its node id. */
export async function getRepoOptions(slug, { refresh = false } = {}) {
  const hit = repoOptionsCache.get(slug);
  if (!refresh && hit && Date.now() - hit.at < OPTIONS_TTL_MS) return hit.data;
  const [owner, name] = slug.split('/');
  const repo = (await ghGraphql(REPO_OPTIONS_QUERY, { owner, name }))?.repository;
  if (!repo) throw httpError(`Repository ${slug} not found or not accessible`, 404);
  const all = (conn) =>
    allNodes(repo[conn], async (after) => {
      const next = await ghGraphql(repoConnectionQuery(conn), { owner, name, after });
      return next?.repository?.[conn];
    });
  const [labels, assignees, milestones] = await Promise.all(Object.keys(REPO_CONNECTIONS).map(all));
  const data = {
    repositoryId: repo.id,
    labels: labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
    assignees: assignees.map((u) => ({ id: u.id, login: u.login })),
    milestones: milestones.map((m) => ({ id: m.id, title: m.title })),
  };
  repoOptionsCache.set(slug, { at: Date.now(), data });
  return data;
}

/**
 * Label names / assignee logins / milestone title -> node ids for create/updateIssue.
 * Only the keys present in `input` are resolved; unknown names are a 400.
 */
export function resolveIssueRefs(options, input) {
  const out = {};
  const pick = (list, key, value, what) => {
    const hit = list.find((x) => x[key].toLowerCase() === String(value).toLowerCase());
    if (!hit) throw httpError(`Unknown ${what}: ${value}`, 400);
    return hit.id;
  };
  if (input.labels)
    out.labelIds = input.labels.map((n) => pick(options.labels, 'name', n, 'label'));
  if (input.assignees) {
    out.assigneeIds = input.assignees.map((l) => pick(options.assignees, 'login', l, 'assignee'));
  }
  if (input.milestone !== undefined) {
    out.milestoneId =
      input.milestone === null
        ? null
        : pick(options.milestones, 'title', input.milestone, 'milestone');
  }
  return out;
}

/** Status option for a new issue: the requested one, else "Backlog", else the first. */
export function pickNewItemStatus(options, requestedId) {
  if (requestedId) {
    if (!options.some((o) => o.id === requestedId)) throw httpError('Unknown status option', 400);
    return requestedId;
  }
  return (options.find((o) => o.name.toLowerCase() === 'backlog') ?? options[0])?.id ?? null;
}

/**
 * Splits vars for ghGraphql: `null` (= clear an id) goes to the typed (-F) vars, every other
 * value stays a -f string. Never route strings to -F: `-F k=@path` reads a local file.
 */
function splitVars(vars) {
  const str = {};
  const typed = {};
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) continue;
    if (v === null) typed[k] = 'null';
    else str[k] = v;
  }
  return [str, typed];
}

/** One item fresh from GitHub, put into the cache (cheap next to a full board reload) */
export async function refetchItem(source, itemId, created = false) {
  const node = (await ghGraphql(ITEM_QUERY, { id: itemId }))?.node;
  if (!node?.id) throw httpError('Item not found after write', 502);
  const item = mapItem(node, [source.owner]);
  rememberItem(source, item, created);
  return item;
}

export async function issueNodeId(repo, number) {
  const [owner, name] = repo.split('/');
  const id = (await ghGraphql(ISSUE_ID_QUERY, { owner, name }, { number }))?.repository?.issue?.id;
  if (!id) throw httpError(`Issue ${repo}#${number} not found`, 404);
  return id;
}

const ISSUE_SUMMARY_QUERY = `query($id:ID!){node(id:$id){... on Issue{
  id number title body url state repository{nameWithOwner} labels(first:50){nodes{name color}}
}}}`;

/** Title, body and labels of an issue by node id (issue modal for issues not on the board) */
export async function getIssueSummary(issueId) {
  const node = (await ghGraphql(ISSUE_SUMMARY_QUERY, { id: issueId }))?.node;
  if (!node?.id) throw httpError('Issue not found', 404);
  return {
    issueId: node.id,
    repo: node.repository?.nameWithOwner ?? '',
    number: node.number,
    title: node.title,
    body: node.body ?? '',
    url: node.url,
    state: node.state,
    labels: (node.labels?.nodes || [])
      .filter(Boolean)
      .map((l) => ({ name: l.name, color: l.color })),
  };
}

/** Replaces the label set of an issue that is not on the board; the repo comes from GitHub */
export async function setIssueLabels(issueId, labels) {
  const { repo } = await getIssueSummary(issueId);
  await applyIssuePatch({ issueId, repo }, { labels });
  return getIssueSummary(issueId);
}

/** Body and full sub-issue list of an issue (loaded when its panel opens, not with the board). */
export async function getIssueDetails(issueId) {
  const node = (await ghGraphql(ISSUE_DETAILS_QUERY, { id: issueId }))?.node;
  if (!node) throw httpError('Issue not found', 404);
  const subIssues = await allNodes(
    node.subIssues,
    async (after) => (await ghGraphql(ISSUE_DETAILS_QUERY, { id: issueId, after }))?.node?.subIssues
  );
  return {
    body: node.body ?? '',
    subIssues: subIssues.map((n) => ({
      id: n.id,
      repo: n.repository?.nameWithOwner ?? '',
      number: n.number,
      title: n.title,
      state: n.state,
    })),
  };
}

const COMMENTS_QUERY = `query($id:ID!,$after:String){node(id:$id){... on Issue{
  comments(first:100,after:$after){pageInfo{hasNextPage endCursor}
    nodes{id body createdAt url author{login}}}
}}}`;
const ADD_COMMENT_MUTATION = `mutation($id:ID!,$body:String!){addComment(input:{subjectId:$id,body:$body}){commentEdge{node{id}}}}`;
const MAX_COMMENT_PAGES = 20;

const mapComment = (n) => ({
  id: n.id,
  author: n.author?.login ?? 'ghost',
  body: n.body ?? '',
  createdAt: n.createdAt,
  url: n.url,
});

/** All comments of an issue, oldest first (paged; capped at MAX_COMMENT_PAGES * 100). */
export async function getIssueComments(issueId) {
  const comments = [];
  let after = null;
  for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
    const node = (await ghGraphql(COMMENTS_QUERY, after ? { id: issueId, after } : { id: issueId }))
      ?.node;
    if (!node?.comments) throw httpError('Issue not found', 404);
    comments.push(...(node.comments.nodes || []).filter(Boolean).map(mapComment));
    if (!node.comments.pageInfo?.hasNextPage) break;
    after = node.comments.pageInfo.endCursor;
  }
  return comments;
}

/** Posts a comment; returns the full list as GitHub has it afterwards. */
export async function addIssueComment(issueId, body) {
  await ghGraphql(ADD_COMMENT_MUTATION, { id: issueId, body });
  return getIssueComments(issueId);
}

/** httpError carrying extra JSON fields for the client (sent next to `error`) */
function detailedError(message, status, details) {
  return Object.assign(httpError(message, status), { details });
}

/**
 * Creates an issue in `repo`, adds it to the board project with a status (default Backlog)
 * and returns it as a BoardItem (also inserted into the cache).
 * Not atomic on GitHub: if adding to the project fails after the issue exists, the 502 carries
 * `issue` ({id, number, url}); sending `issueId` then resumes with the project step instead of
 * creating a duplicate (addProjectV2ItemById is idempotent).
 * `allowed`: the caller's write check as a promise; it runs beside the reads, no mutation before it passes.
 */
export async function createIssue(source, input, { allowed } = {}) {
  const reads = Promise.all([
    getProjectMeta(source),
    input.issueId ? null : getRepoOptions(input.repo),
  ]);
  reads.catch(() => {}); // rejection is rethrown below; a failed write check reports first
  await allowed;
  const [board, options] = await reads;
  const statusOptionId = pickNewItemStatus(board.statusField.options, input.statusOptionId);
  let issue = input.issueId ? { id: input.issueId, number: null, url: null } : null;
  if (!issue) {
    const refs = resolveIssueRefs(options, input);
    const [str, typed] = splitVars({
      repositoryId: options.repositoryId,
      title: input.title,
      body: input.body ?? '',
      ...refs,
    });
    issue = (await ghGraphql(CREATE_ISSUE_MUTATION, str, typed))?.createIssue?.issue;
    if (!issue?.id) throw httpError('GitHub did not return the new issue', 502);
  }
  try {
    const added = await ghGraphql(ADD_ITEM_MUTATION, {
      projectId: board.projectId,
      contentId: issue.id,
    });
    const itemId = added?.addProjectV2ItemById?.item?.id;
    if (!itemId) throw httpError('GitHub did not return the project item', 502);
    if (statusOptionId) {
      await ghGraphql(STATUS_MUTATION, {
        projectId: board.projectId,
        itemId,
        fieldId: board.statusField.id,
        optionId: statusOptionId,
      });
    }
    return await refetchItem(source, itemId, true);
  } catch (error) {
    const ref = issue.number ? `${input.repo}#${issue.number}` : 'Issue';
    throw detailedError(`${ref} angelegt, aber nicht aufs Board gesetzt: ${error.message}`, 502, {
      issue,
    });
  }
}

/**
 * Edits an issue on the board. `patch` keys (all optional): title, body, labels (names),
 * assignees (logins), milestone (title|null), state (OPEN|CLOSED) + stateReason,
 * parent ({repo, number}|null), addSubIssue ({repo, number}), removeSubIssue (issue node id).
 * Returns the refreshed BoardItem. The steps are separate mutations: when one fails after
 * others applied, the error carries `item` = the issue as GitHub has it now.
 */
export async function updateIssue(source, itemId, patch) {
  const board = await getBoard(source);
  const item = board.items.find((i) => i.itemId === itemId);
  if (!item) throw httpError('Item not on this board', 404);
  if (!item.issueId) throw httpError('Only issues can be edited', 400);
  try {
    await applyIssuePatch(item, patch);
  } catch (error) {
    const current = await refetchItem(source, itemId).catch(() => null);
    if (current) error.details = { item: current };
    throw error;
  }
  return refetchItem(source, itemId);
}

// GraphQL type of each updateIssue input field this server sets
const UPDATE_ISSUE_FIELD_TYPES = {
  title: 'String',
  body: 'String',
  labelIds: '[ID!]',
  assigneeIds: '[ID!]',
  milestoneId: 'ID',
};

/** updateIssue mutation setting exactly `keys`; a key without a known type throws */
export function updateIssueMutation(keys) {
  const unknown = keys.filter((k) => !Object.hasOwn(UPDATE_ISSUE_FIELD_TYPES, k));
  if (unknown.length) throw new Error(`updateIssue: no GraphQL type for ${unknown.join(', ')}`);
  const decl = keys.map((k) => `$${k}:${UPDATE_ISSUE_FIELD_TYPES[k]}`).join(',');
  const assign = keys.map((k) => `${k}:$${k}`).join(',');
  return `mutation($id:ID!,${decl}){updateIssue(input:{id:$id,${assign}}){issue{id}}}`;
}

async function applyIssuePatch(item, patch) {
  const id = item.issueId;
  const fields = {};
  if (patch.title !== undefined) fields.title = patch.title;
  if (patch.body !== undefined) fields.body = patch.body;
  if (patch.labels || patch.assignees || patch.milestone !== undefined) {
    Object.assign(fields, resolveIssueRefs(await getRepoOptions(item.repo), patch));
  }
  if (Object.keys(fields).length) {
    const [str, typed] = splitVars({ id, ...fields });
    await ghGraphql(updateIssueMutation(Object.keys(fields)), str, typed);
  }

  const live =
    patch.state !== undefined || patch.parent === null
      ? (await ghGraphql(ISSUE_STATE_QUERY, { id }))?.node
      : null;
  if (patch.state !== undefined && !live) throw httpError('Issue not found', 404);
  const reason = patch.stateReason || 'COMPLETED';
  // Closing a closed issue again only changes its reason
  if (patch.state === 'CLOSED' && (live.state !== 'CLOSED' || live.stateReason !== reason)) {
    await ghGraphql(CLOSE_MUTATION, { id, reason });
  } else if (patch.state === 'OPEN' && live.state === 'CLOSED') {
    await ghGraphql(REOPEN_MUTATION, { id });
  }

  if (patch.parent === null) {
    if (live?.parent?.id)
      await ghGraphql(REMOVE_SUB_MUTATION, { parentId: live.parent.id, subId: id });
  } else if (patch.parent) {
    const parentId = await issueNodeId(patch.parent.repo, patch.parent.number);
    if (parentId === id) throw httpError('An issue cannot be its own parent', 400);
    await ghGraphql(ADD_SUB_MUTATION, { parentId, subId: id });
  }
  if (patch.addSubIssue) {
    const subId = await issueNodeId(patch.addSubIssue.repo, patch.addSubIssue.number);
    if (subId === id) throw httpError('An issue cannot be its own sub-issue', 400);
    await ghGraphql(ADD_SUB_MUTATION, { parentId: id, subId });
  }
  if (patch.removeSubIssue) {
    await ghGraphql(REMOVE_SUB_MUTATION, { parentId: id, subId: patch.removeSubIssue });
  }
}

// ---------------------------------------------------------------------------
// Local checkout of a GitHub repo ("Agent starten" target directory)
// ---------------------------------------------------------------------------

const REPO_INDEX_TTL_MS = 5 * 60_000;
// A hostile repo config must not execute code when we only read the remote
const GIT_SAFE = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null'];
let repoIndex = null; // { at, entries: [{ path, slug }] }

function originSlug(dir) {
  return new Promise((resolve) => {
    execFile(
      'git',
      [...GIT_SAFE, 'remote', 'get-url', 'origin'],
      { cwd: dir, timeout: 3000 },
      (e, out) => resolve(e ? null : parseGithubSlug(out))
    );
  });
}

/**
 * Best local directory for `slug` among `entries` ({ path, slug }): case-insensitive match,
 * main checkouts before agent worktrees, then the shortest path.
 */
export function pickRepoPath(slug, entries) {
  const want = String(slug).toLowerCase();
  const isWorktree = (p) => p.includes('/.claude/worktrees/');
  const hits = entries
    .filter((e) => e.slug && e.slug.toLowerCase() === want)
    .map((e) => e.path)
    .sort((a, b) => isWorktree(a) - isWorktree(b) || a.length - b.length);
  return hits[0] ?? null;
}

/** Local directory whose `origin` is github.com/<slug>, searched among `candidates` (dirs). */
export async function findRepoPath(slug, candidates) {
  const dirs = [...new Set(candidates.filter(Boolean))];
  const known = new Set(repoIndex?.entries.map((e) => e.path));
  if (
    !repoIndex ||
    Date.now() - repoIndex.at > REPO_INDEX_TTL_MS ||
    dirs.some((d) => !known.has(d))
  ) {
    const slugs = await Promise.all(dirs.map(originSlug));
    repoIndex = { at: Date.now(), entries: dirs.map((path, i) => ({ path, slug: slugs[i] })) };
  }
  return pickRepoPath(slug, repoIndex.entries);
}
