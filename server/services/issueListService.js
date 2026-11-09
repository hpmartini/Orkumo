/**
 * Issues mode (/issues): issues of a project context's repositories, read straight from the
 * repos via `gh api graphql`, so issues that are not on the board's ProjectV2 are listed too.
 */
import { ghGraphql, originSlug } from './boardService.js';

const CACHE_TTL_MS = 60_000;
const SLUG_TTL_MS = 5 * 60_000;
const PAGE_SIZE = 100;
// Open issues are the working set (up to 300 per repo); closed ones only the 100 most recent
const MAX_PAGES = { open: 3, closed: 1 };
const CONCURRENCY = 4;
export const SLUG_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

const ISSUES_QUERY = `query($owner:String!,$name:String!,$states:[IssueState!],$first:Int!,$after:String){
  repository(owner:$owner,name:$name){
    issues(states:$states,first:$first,after:$after,orderBy:{field:UPDATED_AT,direction:DESC}){
      pageInfo{hasNextPage endCursor}
      nodes{
        id number title url state createdAt updatedAt closedAt author{login}
        labels(first:20){nodes{name color}} assignees(first:10){nodes{login}} milestone{title}
        comments{totalCount}
        projectItems(first:10){nodes{project{number owner{... on User{login} ... on Organization{login}}}}}
      }
    }
  }
}`;

const issueCache = new Map(); // `${slug}#${state}` -> { at, nodes }
const inflight = new Map(); // same key -> promise
const slugCache = new Map(); // path -> { at, slug }

export function clearIssueCache() {
  issueCache.clear();
  inflight.clear();
  slugCache.clear();
}

async function cachedSlug(dir) {
  const hit = slugCache.get(dir);
  if (hit && Date.now() - hit.at < SLUG_TTL_MS) return hit.slug;
  const slug = await originSlug(dir);
  slugCache.set(dir, { at: Date.now(), slug });
  return slug;
}

/**
 * GitHub repos of `context`: the origin remotes of its member apps (appIds null = every app)
 * plus the `repo:owner/name` slices of its board filter. Deduplicated case-insensitively, sorted.
 */
export async function contextRepos(context, apps) {
  const members = context.appIds ? new Set(context.appIds) : null;
  const paths = [
    ...new Set(
      apps
        .filter((a) => !members || members.has(a.id))
        .map((a) => a.path)
        .filter(Boolean)
    ),
  ];
  const fromApps = await Promise.all(paths.map(cachedSlug));
  const fromFilter = (context.boardFilter || [])
    .filter((key) => key.startsWith('repo:'))
    .map((key) => key.slice('repo:'.length));
  const repos = new Map();
  for (const slug of [...fromApps, ...fromFilter]) {
    if (slug && SLUG_RE.test(slug) && !repos.has(slug.toLowerCase())) {
      repos.set(slug.toLowerCase(), slug);
    }
  }
  return [...repos.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

async function fetchIssueNodes(slug, state) {
  const [owner, name] = slug.split('/');
  const nodes = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES[state]; page++) {
    const data = await ghGraphql(
      ISSUES_QUERY,
      { owner, name, states: [state.toUpperCase()], ...(after ? { after } : {}) },
      { first: PAGE_SIZE }
    );
    const issues = data?.repository?.issues;
    nodes.push(...(issues?.nodes || []).filter(Boolean));
    if (!issues?.pageInfo?.hasNextPage) break;
    after = issues.pageInfo.endCursor;
  }
  return nodes;
}

/** Raw issue nodes of one repo; cached CACHE_TTL_MS, `refresh` bypasses, concurrent calls share one fetch */
function repoIssueNodes(slug, state, refresh) {
  const key = `${slug.toLowerCase()}#${state}`;
  const hit = issueCache.get(key);
  if (!refresh && hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.nodes);
  if (inflight.has(key)) return inflight.get(key);
  const promise = fetchIssueNodes(slug, state)
    .then((nodes) => {
      issueCache.set(key, { at: Date.now(), nodes });
      return nodes;
    })
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

/** True when one of the issue's project items is in the board's source project */
export function isOnBoard(node, source) {
  const owner = String(source?.owner || '').toLowerCase();
  return (node.projectItems?.nodes || []).some(
    (item) =>
      item?.project?.number === source?.number &&
      String(item.project.owner?.login || '').toLowerCase() === owner
  );
}

/** GraphQL issue node -> RepoIssue (types.ts) */
export function mapIssue(node, repo, source) {
  return {
    id: node.id,
    repo,
    number: node.number,
    title: node.title,
    url: node.url,
    state: node.state === 'CLOSED' ? 'closed' : 'open',
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    closedAt: node.closedAt ?? null,
    author: node.author?.login ?? null,
    labels: (node.labels?.nodes || [])
      .filter(Boolean)
      .map((l) => ({ name: l.name, color: l.color })),
    assignees: (node.assignees?.nodes || []).filter(Boolean).map((a) => a.login),
    milestone: node.milestone?.title ?? null,
    comments: node.comments?.totalCount ?? 0,
    onBoard: isOnBoard(node, source),
  };
}

/**
 * Issues (state open|closed) of `repos`, newest update first. A failing repo does not fail
 * the list: it lands in `errors` as { repo, message }.
 */
export async function listIssues(repos, { state = 'open', source, refresh = false } = {}) {
  const results = new Array(repos.length);
  let next = 0;
  const worker = async () => {
    while (next < repos.length) {
      const i = next++;
      const repo = repos[i];
      try {
        const nodes = await repoIssueNodes(repo, state, refresh);
        results[i] = { issues: nodes.map((n) => mapIssue(n, repo, source)) };
      } catch (error) {
        results[i] = { error: { repo, message: error?.message || String(error) } };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, repos.length) }, worker));
  const issues = results
    .flatMap((r) => r.issues || [])
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  return { repos, issues, errors: results.flatMap((r) => (r.error ? [r.error] : [])) };
}
