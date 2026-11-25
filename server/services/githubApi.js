/**
 * GitHub budget guards shared by every Orkumo GitHub read: the rate-limit backoff, the polling
 * switch for dev/test instances, and conditional REST GETs (ETag) whose unchanged answer (304)
 * costs no rate limit.
 */
import { execFile } from 'child_process';

export const MIN_BACKOFF_MS = 120_000;
export const MAX_BACKOFF_MS = 30 * 60_000;

const RATE_LIMIT_RE = /rate limit|already exceeded|abuse detection/i;

/** True for a primary or secondary rate-limit answer of GitHub (GraphQL error or REST 403/429) */
export function isRateLimitMessage(text) {
  return RATE_LIMIT_RE.test(String(text || ''));
}

// Per budget: GraphQL and REST (core) are counted separately by GitHub.
const limits = { graphql: { until: 0, strikes: 0 }, rest: { until: 0, strikes: 0 } };

/** Pauses `bucket` for 120 s, doubling per consecutive limit hit up to 30 min (or `retryAfterMs`). */
export function noteRateLimit(bucket, { now = Date.now(), retryAfterMs = 0 } = {}) {
  const state = limits[bucket];
  // Hits of calls that were in flight when the pause began do not count as new strikes
  if (state.until > now) return state.until;
  const backoff = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** state.strikes);
  state.strikes++;
  state.until = now + Math.min(MAX_BACKOFF_MS, Math.max(backoff, retryAfterMs));
  console.warn(
    `[github] ${bucket} rate limit: GitHub reads paused until ${new Date(state.until).toISOString()}`
  );
  return state.until;
}

/** A successful call ends the escalation */
export function noteSuccess(bucket) {
  limits[bucket].strikes = 0;
}

/** End of the current pause of `bucket`, 0 when calls may run */
export function limitedUntil(bucket, now = Date.now()) {
  return limits[bucket].until > now ? limits[bucket].until : 0;
}

/** Error for a call skipped while `bucket` is paused (429, `rateLimited`) */
export function rateLimitError(bucket, until = limitedUntil(bucket)) {
  return Object.assign(
    new Error(`GitHub rate limit: reads paused until ${new Date(until).toLocaleTimeString()}`),
    { status: 429, rateLimited: true }
  );
}

export function resetRateLimits() {
  for (const state of Object.values(limits)) Object.assign(state, { until: 0, strikes: 0 });
}

/**
 * Background GitHub reads (agent PR/issue lists, board and Issues refreshes) on or off.
 * ORKUMO_GITHUB_POLL=1/0 decides; unset, only production servers (desktop app, Docker) poll, so
 * dev servers and test instances in worktrees spend no budget unless switched on.
 */
export function githubPolling(env = process.env) {
  const value = String(env.ORKUMO_GITHUB_POLL ?? '')
    .trim()
    .toLowerCase();
  if (value) return !['0', 'false', 'off', 'no'].includes(value);
  return env.NODE_ENV === 'production';
}

/**
 * `gh api -i` output -> { status, headers (lowercase keys), body }. gh prints the status line,
 * the headers, a blank line, then the body.
 */
export function parseGhInclude(output) {
  const text = String(output || '');
  const split = text.search(/\r?\n\r?\n/);
  const head = split < 0 ? text : text.slice(0, split);
  const body = split < 0 ? '' : text.slice(split).replace(/^\r?\n\r?\n/, '');
  const [statusLine = '', ...lines] = head.split(/\r?\n/);
  const status = Number(statusLine.match(/^HTTP\/\S+\s+(\d{3})/)?.[1]) || 0;
  const headers = {};
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return { status, headers, body };
}

const ETAG_MAX = 2000;
const etagCache = new Map(); // path -> { etag, data }, oldest first

export function clearEtagCache() {
  etagCache.clear();
}

function rememberEtag(path, entry) {
  etagCache.delete(path);
  etagCache.set(path, entry);
  if (etagCache.size > ETAG_MAX) etagCache.delete(etagCache.keys().next().value);
}

const ghInclude = (args, timeout) =>
  new Promise((resolve) => {
    execFile('gh', args, { timeout, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) =>
      resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '') })
    );
  });

/**
 * GET `path` of the GitHub REST API with the ETag of the last answer: unchanged (304) returns
 * the remembered data without spending rate limit. `map` projects the answer before it is
 * remembered (keep only what the caller reads; one projection per path). Rejects (status,
 * `rateLimited`) on errors; a rate-limit answer pauses the REST bucket, and calls during the
 * pause reject without a request.
 */
export async function restGet(path, { map = (data) => data, timeout = 15_000 } = {}) {
  if (limitedUntil('rest')) throw rateLimitError('rest');
  const cached = etagCache.get(path);
  const args = ['api', '-i', '-H', 'Accept: application/vnd.github+json'];
  if (cached?.etag) args.push('-H', `If-None-Match: ${cached.etag}`);
  args.push(path);
  const { error, stdout, stderr } = await ghInclude(args, timeout);
  if (error?.code === 'ENOENT') {
    throw Object.assign(new Error('GitHub CLI (gh) not found on the server PATH'), { status: 502 });
  }
  const { status, headers, body } = parseGhInclude(stdout);
  if (status === 304 && cached) {
    rememberEtag(path, cached);
    noteSuccess('rest');
    return cached.data;
  }
  if (status >= 200 && status < 300) {
    const data = map(JSON.parse(body || 'null'));
    if (headers.etag) rememberEtag(path, { etag: headers.etag, data });
    noteSuccess('rest');
    return data;
  }
  let message = '';
  try {
    message = JSON.parse(body)?.message || '';
  } catch {
    /* not JSON */
  }
  message ||= stderr.trim() || error?.message || `HTTP ${status}`;
  const limited =
    (status === 403 || status === 429) &&
    (headers['x-ratelimit-remaining'] === '0' ||
      'retry-after' in headers ||
      isRateLimitMessage(message));
  if (limited) {
    const reset = Number(headers['x-ratelimit-reset']) * 1000;
    const retryAfterMs =
      Number(headers['retry-after']) * 1000 || (reset > Date.now() ? reset - Date.now() : 0);
    noteRateLimit('rest', { retryAfterMs });
    throw Object.assign(new Error(`GitHub: ${message}`), { status: 429, rateLimited: true });
  }
  throw Object.assign(new Error(`GitHub: ${message}`), { status: status || 502 });
}
