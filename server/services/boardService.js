/**
 * Agent Task Board: reads a GitHub ProjectV2 (all items + Status field) via `gh api graphql`
 * and writes an item's Status. Status comes from each item's field value, never from views.
 */
import { execFile } from 'child_process';

const CACHE_TTL_MS = 60_000;
const PAGE_SIZE = 100; // measured on MACC: cost 4 per page with comments(last:20)
const MIN_PAGE_SIZE = 25;
const MW_BOARD_RE = /<!--\s*mw-board:start\s+session=([0-9a-f-]{36})/g;

const PR_FIELDS = 'number url title state repository{nameWithOwner} statusCheckRollup{state}';
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
    nodes{
      id
      fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{optionId}}
      content{
        __typename
        ... on DraftIssue{title updatedAt}
        ... on Issue{number title url state updatedAt closedAt repository{nameWithOwner}
          parent{number title repository{nameWithOwner}} subIssuesSummary{total completed}
          labels(first:20){nodes{name color}} milestone{title} assignees(first:10){nodes{login}}
          closedByPullRequestsReferences(first:10){nodes{${PR_FIELDS}}}
          comments(last:20){nodes{body}}}
        ... on PullRequest{${PR_FIELDS} updatedAt closedAt
          labels(first:20){nodes{name color}} milestone{title} assignees(first:10){nodes{login}}
          comments(last:20){nodes{body}}}
      }
    }
  }
}`;
const STATUS_MUTATION = `mutation($projectId:ID!,$itemId:ID!,$fieldId:ID!,$optionId:String!){
  updateProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId,value:{singleSelectOptionId:$optionId}}){
    projectV2Item{id}
  }
}`;

let cache = null; // { key, at, data }
let inflight = null; // { key, promise }

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

/** Runs `gh api graphql` with an argument array (no shell); -f = string, -F = typed var. */
function ghGraphql(query, stringVars = {}, typedVars = {}) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(stringVars)) args.push('-f', `${k}=${v}`);
  for (const [k, v] of Object.entries(typedVars)) args.push('-F', `${k}=${v}`);
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout: 30_000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      let payload = null;
      try {
        payload = JSON.parse(String(stdout || ''));
      } catch {
        /* non-JSON output, handled below */
      }
      if (payload?.errors?.length) {
        return reject(httpError(`GitHub: ${payload.errors.map((e) => e.message).join('; ')}`, 502));
      }
      if (error || !payload) {
        return reject(httpError(`gh failed: ${String(stderr || error?.message || 'no output').trim()}`, 502));
      }
      resolve(payload.data);
    });
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

/** ProjectV2Item node -> BoardItem */
export function mapItem(node) {
  const c = node?.content || {};
  const type = c.__typename === 'PullRequest' || c.__typename === 'DraftIssue' ? c.__typename : 'Issue';
  const isDraft = type === 'DraftIssue';
  const pullRequests =
    type === 'PullRequest'
      ? [mapPullRequest(c)]
      : (c.closedByPullRequestsReferences?.nodes || []).filter(Boolean).map(mapPullRequest);
  return {
    itemId: node.id,
    type,
    number: isDraft ? null : (c.number ?? null),
    title: c.title ?? '',
    url: isDraft ? null : (c.url ?? null),
    repo: isDraft ? null : (c.repository?.nameWithOwner ?? null),
    state: isDraft ? 'OPEN' : (c.state ?? 'OPEN'),
    statusOptionId: node.fieldValueByName?.optionId ?? null,
    labels: (c.labels?.nodes || []).map((l) => ({ name: l.name, color: l.color })),
    milestone: c.milestone?.title ?? null,
    assignees: (c.assignees?.nodes || []).map((a) => a.login),
    parent: c.parent
      ? { repo: c.parent.repository?.nameWithOwner ?? '', number: c.parent.number, title: c.parent.title }
      : null,
    subIssues: {
      total: c.subIssuesSummary?.total ?? 0,
      completed: c.subIssuesSummary?.completed ?? 0,
    },
    pullRequests,
    mwBoardSessions: parseMwBoardSessions((c.comments?.nodes || []).map((n) => n?.body)),
    updatedAt: c.updatedAt ?? '',
    closedAt: c.closedAt ?? null,
  };
}

async function fetchPage(source, after, first) {
  try {
    const typed = { owner: source.owner, number: source.number, first };
    return await ghGraphql(ITEMS_QUERY, after ? { after } : {}, typed);
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
    items.push(...project.items.nodes.filter(Boolean).map(mapItem));
    after = project.items.pageInfo.hasNextPage ? project.items.pageInfo.endCursor : null;
  } while (after);
  if (!project.field?.id) {
    throw httpError(`Project ${source.owner}/${source.number} has no "Status" single-select field`, 502);
  }
  console.log(`[board] fetched ${items.length} items, GraphQL cost ${cost}, remaining ${remaining}`);
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
  // Status writes that land while this fetch runs; its data predates them
  const writes = new Map();
  const promise = loadBoard(source)
    .then((data) => {
      for (const item of data.items) {
        if (writes.has(item.itemId)) item.statusOptionId = writes.get(item.itemId);
      }
      cache = { key, at: Date.now(), data };
      return data;
    })
    .finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
  inflight = { key, promise, writes };
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
  item.statusOptionId = optionId;
  if (cache?.key === cacheKey(source)) {
    const cached = cache.data.items.find((i) => i.itemId === itemId);
    if (cached) cached.statusOptionId = optionId;
  }
  if (inflight?.key === cacheKey(source)) inflight.writes.set(itemId, optionId);
  return { itemId, statusOptionId: optionId };
}

export function clearCache() {
  cache = null;
}
