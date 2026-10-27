/**
 * Per-session context for the Agents View: git repo/branch, open issues/PRs (gh) and sub-agents.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import * as agentService from './agentService.js';

const GH_TTL_MS = 60_000;
const CONCURRENCY = 4;
const GH_FAIL_TTL_MS = 10_000;
const ghCache = new Map(); // slug -> { at, ttl, promise }
const LSOF_TTL_MS = 5_000;
let serverScan = null; // { at, promise }
// A hostile repo config must not execute code (fsmonitor, hooks) when we only read status.
const GIT_SAFE = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null'];

// lenient: keep stdout on a non-zero exit (lsof exits 1 when any listed pid vanished).
function run(cmd, args, cwd, timeout = 5000, { lenient = false, maxBuffer = 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer }, (error, stdout) =>
      resolve(error && !(lenient && error.code === 1 && stdout) ? null : String(stdout))
    );
  });
}

/**
 * "owner/repo" from a github remote URL (https, ssh, ssh://), else null.
 */
export function parseGithubSlug(remote) {
  const match = String(remote || '')
    .trim()
    .match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return match ? `${match[1]}/${match[2]}` : null;
}

/**
 * Parse `git rev-list --left-right --count @{u}...HEAD` ("behind\tahead").
 */
export function parseAheadBehind(output) {
  const [behind, ahead] = String(output || '')
    .trim()
    .split(/\s+/)
    .map(Number);
  return Number.isFinite(behind) && Number.isFinite(ahead)
    ? { ahead, behind }
    : { ahead: 0, behind: 0 };
}

/**
 * Sub-agents from state.json `fan` entries (agent-like kind, no doneAt = running).
 * shortcut: `fan` is undocumented; without it only inFlight.kinds is known (running = 1 if a
 * local_agent is in flight). Revisit if Claude Code exposes real sub-agent state.
 */
export function deriveSubagents(state) {
  const fan = Array.isArray(state?.fan)
    ? state.fan.filter((f) => /agent/i.test(f?.kind || ''))
    : [];
  if (fan.length) {
    const running = fan.filter((f) => !f.doneAt);
    return {
      running: running.length,
      total: fan.length,
      names: running.map((f) => String(f.label || f.id)).slice(0, 10),
    };
  }
  const live =
    Array.isArray(state?.inFlight?.kinds) && state.inFlight.kinds.includes('local_agent');
  return { running: live ? 1 : 0, total: live ? 1 : 0, names: [] };
}

/**
 * Repo identity from `git rev-parse --path-format=absolute --git-common-dir --git-dir --show-toplevel`.
 * A linked worktree has a git-dir below the common dir; its repo name is the MAIN checkout's
 * (dirname of the common dir, or the bare repo folder without ".git"). `root` is that main
 * checkout's path, shared by every subfolder and worktree of the repo.
 */
export function resolveRepoIdentity({ top, gitDir, commonDir }) {
  const isWorktree =
    Boolean(commonDir && gitDir) && path.resolve(commonDir) !== path.resolve(gitDir);
  if (!isWorktree) {
    return {
      name: path.basename(top),
      root: top,
      isWorktree: false,
      worktreeName: null,
      worktreePath: null,
    };
  }
  const common = path.resolve(commonDir);
  const root = path.basename(common) === '.git' ? path.dirname(common) : common;
  const name = path.basename(root).replace(/\.git$/, '');
  return { name, root, isWorktree: true, worktreeName: path.basename(top), worktreePath: top };
}

export async function gitInfo(dir) {
  const ids = await run(
    'git',
    [
      ...GIT_SAFE,
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
      '--git-dir',
      '--show-toplevel',
    ],
    dir
  );
  const [commonDir, gitDir, top] = String(ids || '')
    .split('\n')
    .map((l) => l.trim());
  if (!top) return null;
  const [branch, status, counts, remote] = await Promise.all([
    run('git', [...GIT_SAFE, 'rev-parse', '--abbrev-ref', 'HEAD'], dir),
    run('git', [...GIT_SAFE, 'status', '--porcelain'], dir),
    run('git', [...GIT_SAFE, 'rev-list', '--left-right', '--count', '@{u}...HEAD'], dir),
    run('git', [...GIT_SAFE, 'remote', 'get-url', 'origin'], dir),
  ]);
  const name = branch?.trim();
  return {
    ...resolveRepoIdentity({ top, gitDir, commonDir }),
    slug: parseGithubSlug(remote),
    branch: name && name !== 'HEAD' ? name : null,
    dirty: Boolean(status?.trim()),
    ...parseAheadBehind(counts),
  };
}

const MODEL_TAIL_BYTES = 64 * 1024;
// A single assistant line (large Write/tool_use input) can exceed the tail: widen up to this cap
const MODEL_MAX_BYTES = 1024 * 1024;
const modelCache = new Map(); // transcript file -> { mtimeMs, model }

/**
 * Model of the latest main-thread assistant entry in a transcript tail, else null.
 * Sub-agent (sidechain) turns and "<synthetic>" placeholders are not the session's model.
 */
export function parseModelFromTranscript(text) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue; // blank line or the partial first line of the tail
    }
    const model = entry?.message?.model;
    if (entry?.type === 'assistant' && !entry.isSidechain && model && model !== '<synthetic>') {
      return String(model);
    }
  }
  return null;
}

/**
 * Transcript files to try for a session, best first. The job state's scan path wins: a session that
 * entered a worktree (EnterWorktree) writes under the worktree's project slug, not under its cwd.
 */
export function transcriptCandidates(session) {
  const files = session.transcriptPath ? [session.transcriptPath] : [];
  if (session.sessionId) {
    for (const dir of [session.cwd, session.worktree]) {
      if (!dir) continue;
      files.push(
        path.join(
          agentService.paths.PROJECTS_DIR,
          agentService.projectSlug(dir),
          `${session.sessionId}.jsonl`
        )
      );
    }
  }
  return [...new Set(files)];
}

/** `--model` from a background job's start flags; stands in until the transcript names a model */
export function modelFromFlags(flags) {
  if (!Array.isArray(flags)) return null;
  const i = flags.lastIndexOf('--model');
  return i >= 0 && flags[i + 1] ? String(flags[i + 1]) : null;
}

export async function sessionModel(session) {
  for (const file of transcriptCandidates(session)) {
    try {
      const { mtimeMs, size } = await fsp.stat(file);
      const hit = modelCache.get(file);
      if (hit?.mtimeMs === mtimeMs) return hit.model;
      let model = null;
      const handle = await fsp.open(file, 'r');
      try {
        for (let window = MODEL_TAIL_BYTES; ; window *= 4) {
          const length = Math.min(size, window);
          const buffer = Buffer.alloc(length);
          await handle.read(buffer, 0, length, size - length);
          model = parseModelFromTranscript(buffer.toString('utf-8'));
          if (model || length >= size || window >= MODEL_MAX_BYTES) break;
        }
      } finally {
        await handle.close();
      }
      modelCache.set(file, { mtimeMs, model });
      return model;
    } catch {
      // no transcript under this path, try the next
    }
  }
  return null;
}

const CACHE_TTL_5M = 5 * 60_000;
const CACHE_TTL_1H = 60 * 60_000;
const CACHE_CHUNK_BYTES = 8 * 1024 * 1024;
const cacheUsageCache = new Map(); // transcript file -> { offset, usage }

/**
 * Folds the main-thread assistant turns of a transcript chunk into the running prompt-cache
 * stats. A turn is split into one line per content block sharing message.id: counted once.
 */
export function accumulateCacheUsage(prev, text) {
  const usage = prev
    ? { ...prev }
    : {
        turns: 0,
        hits: 0,
        readTokens: 0,
        inputTokens: 0,
        lastAt: null,
        ttlMs: null,
        cachedTokens: 0,
        lastMessageId: null,
      };
  for (const line of String(text || '').split('\n')) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const u = entry?.message?.usage;
    if (entry?.type !== 'assistant' || entry.isSidechain || !u) continue;
    if (entry.message.model === '<synthetic>') continue;
    const at = Date.parse(entry.timestamp);
    const read = u.cache_read_input_tokens || 0;
    const written = u.cache_creation_input_tokens || 0;
    if (entry.message.id && entry.message.id === usage.lastMessageId) {
      if (Number.isFinite(at)) usage.lastAt = Math.max(usage.lastAt || 0, at);
      continue;
    }
    usage.lastMessageId = entry.message.id || null;
    usage.turns += 1;
    if (read > 0) usage.hits += 1;
    usage.readTokens += read;
    usage.inputTokens += read + written + (u.input_tokens || 0);
    usage.cachedTokens = read + written + (u.input_tokens || 0);
    if (u.cache_creation?.ephemeral_1h_input_tokens > 0) usage.ttlMs = CACHE_TTL_1H;
    else if (u.cache_creation?.ephemeral_5m_input_tokens > 0) usage.ttlMs = CACHE_TTL_5M;
    // A read-only turn refreshes the cache with the TTL it was written with
    else if (usage.ttlMs === null) usage.ttlMs = CACHE_TTL_5M;
    if (Number.isFinite(at)) usage.lastAt = at;
  }
  return usage;
}

/** Context window of a model; shortcut: no model id carries the window, so >200k usage implies 1M */
export function contextWindowFor(model, cachedTokens) {
  return String(model || '').includes('[1m]') || cachedTokens > 200_000 ? 1_000_000 : 200_000;
}

/** Prompt-cache stats of a session; reads only the bytes appended since the last call */
async function sessionCache(session, model) {
  for (const file of transcriptCandidates(session)) {
    let size;
    try {
      ({ size } = await fsp.stat(file));
    } catch {
      continue; // no transcript under this path, try the next
    }
    let hit = cacheUsageCache.get(file);
    if (!hit || size < hit.offset) hit = { offset: 0, usage: null };
    if (size > hit.offset) {
      const handle = await fsp.open(file, 'r');
      try {
        // Chunked: first reads of long sessions are hundreds of MB
        for (let chunk = CACHE_CHUNK_BYTES; hit.offset < size; ) {
          const buffer = Buffer.alloc(Math.min(chunk, size - hit.offset));
          await handle.read(buffer, 0, buffer.length, hit.offset);
          // Only complete lines: a partially written last line is read again next time
          const end = buffer.lastIndexOf(0x0a) + 1;
          if (end === 0) {
            if (buffer.length < chunk) break; // the rest is an unfinished line
            chunk *= 2; // one line longer than the chunk
            continue;
          }
          chunk = CACHE_CHUNK_BYTES;
          hit = {
            offset: hit.offset + end,
            usage: accumulateCacheUsage(hit.usage, buffer.subarray(0, end).toString('utf-8')),
          };
        }
      } finally {
        await handle.close();
      }
      cacheUsageCache.set(file, hit);
    }
    const u = hit.usage;
    if (!u?.turns || !u.lastAt) return null;
    return {
      lastActivityAt: u.lastAt,
      ttlMs: u.ttlMs,
      cachedTokens: u.cachedTokens,
      contextWindow: contextWindowFor(model, u.cachedTokens),
      hits: u.hits,
      turns: u.turns,
      hitRatio: u.inputTokens ? u.readTokens / u.inputTokens : 0,
    };
  }
  return null;
}

const CI_FAIL = new Set([
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'ERROR',
]);
const CI_PASS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

/**
 * Aggregate gh `statusCheckRollup` (CheckRun: status/conclusion, StatusContext: state).
 */
export function summarizeChecks(rollup) {
  let ciPassed = 0;
  let ciFailed = 0;
  let ciPending = 0;
  for (const c of Array.isArray(rollup) ? rollup : []) {
    const result = String(c?.conclusion || c?.state || '').toUpperCase();
    const done = c?.status ? String(c.status).toUpperCase() === 'COMPLETED' : Boolean(result);
    if (!done || !result || result === 'PENDING' || result === 'EXPECTED') ciPending++;
    else if (CI_FAIL.has(result)) ciFailed++;
    else if (CI_PASS.has(result)) ciPassed++;
    else ciPending++;
  }
  const ci = ciFailed ? 'failure' : ciPending ? 'pending' : ciPassed ? 'success' : 'none';
  return { ci, ciPassed, ciFailed, ciPending };
}

/**
 * Map one `gh pr list --json ...` entry to AgentPullRequest.
 */
export function mapPullRequest(pr, slug) {
  const isDraft = Boolean(pr.isDraft);
  const mergeable = ['MERGEABLE', 'CONFLICTING'].includes(pr.mergeable) ? pr.mergeable : 'UNKNOWN';
  const reviewDecision = pr.reviewDecision || null;
  const checks = summarizeChecks(pr.statusCheckRollup);
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    author: pr.author?.login || null,
    isDraft,
    headRef: pr.headRefName,
    baseRef: pr.baseRefName,
    updatedAt: pr.updatedAt,
    reviewDecision,
    mergeable,
    ...checks,
    mergeReady:
      !isDraft &&
      mergeable === 'MERGEABLE' &&
      (checks.ci === 'success' || checks.ci === 'none') &&
      reviewDecision !== 'CHANGES_REQUESTED' &&
      reviewDecision !== 'REVIEW_REQUIRED' &&
      (!pr.mergeStateStatus || ['CLEAN', 'HAS_HOOKS'].includes(pr.mergeStateStatus)),
    repoSlug: slug,
  };
}

async function ghIssues(slug) {
  const out = await run(
    'gh',
    ['issue', 'list', '--repo', slug, '--state', 'open', '--json', 'number', '--limit', '100'],
    undefined,
    10000
  );
  try {
    return { open: JSON.parse(out).length, url: `https://github.com/${slug}/issues` };
  } catch {
    return null;
  }
}

async function ghPulls(slug) {
  const out = await run(
    'gh',
    [
      'pr',
      'list',
      '--repo',
      slug,
      '--state',
      'open',
      '--limit',
      '100',
      '--json',
      'number,title,url,author,isDraft,headRefName,baseRefName,updatedAt,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup',
    ],
    undefined,
    15000,
    { maxBuffer: 16 * 1024 * 1024 }
  );
  try {
    const items = JSON.parse(out)
      .filter((pr) => /^https:\/\/github\.com\//.test(pr.url))
      .map((pr) => mapPullRequest(pr, slug));
    return { open: items.length, url: `https://github.com/${slug}/pulls`, items };
  } catch {
    return null;
  }
}

async function ghInfo(slug) {
  const hit = ghCache.get(slug);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.promise;
  // Cache the in-flight promise so concurrent polls share one gh run; failures expire quickly.
  const entry = { at: Date.now(), ttl: GH_TTL_MS, promise: null };
  entry.promise = Promise.all([ghIssues(slug), ghPulls(slug)]).then(([issues, pulls]) => {
    if (!issues || !pulls) entry.ttl = GH_FAIL_TTL_MS;
    return { issues, pulls };
  });
  ghCache.set(slug, entry);
  return entry.promise;
}

/**
 * Parse `lsof -nP -iTCP -sTCP:LISTEN -FpcnL`: p<pid> c<cmd> then n<addr:port> per socket.
 * Only loopback / any-interface sockets count; duplicates (IPv4+IPv6) collapse to one port.
 */
export function parseListeningSockets(output) {
  const seen = new Set();
  const result = [];
  let pid = null;
  let command = '';
  for (const line of String(output || '').split('\n')) {
    const value = line.slice(1);
    if (line[0] === 'p') {
      pid = Number(value);
      command = '';
    } else if (line[0] === 'c') command = value;
    else if (line[0] === 'n' && pid) {
      const m = value.match(/^(?:\*|\[[^\]]*\]|[^:\s]+):(\d+)$/);
      if (!m || seen.has(`${pid}:${m[1]}`)) continue;
      seen.add(`${pid}:${m[1]}`);
      result.push({ pid, command, port: Number(m[1]) });
    }
  }
  return result;
}

/**
 * Parse `lsof -a -d cwd -p ... -Fpn` into pid -> cwd.
 */
export function parseCwds(output) {
  const map = new Map();
  let pid = null;
  for (const line of String(output || '').split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1));
    else if (line[0] === 'n' && pid) map.set(pid, line.slice(1));
  }
  return map;
}

/**
 * True when dir is cwd or an ancestor of it. Home and root are too broad to own servers.
 */
export function dirOwnsCwd(dir, cwd) {
  if (!dir || !cwd || dir === '/' || dir === os.homedir()) return false;
  return cwd === dir || cwd.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
}

async function scanListeningServers() {
  const sockets = parseListeningSockets(
    await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-FpcnL'], undefined, 8000, {
      lenient: true,
    })
  ).filter((s) => s.pid !== process.pid && !/^(claude|\d+\.\d+\.\d+)$/i.test(s.command));
  if (!sockets.length) return [];
  const pids = [...new Set(sockets.map((s) => s.pid))];
  const cwds = parseCwds(
    await run('lsof', ['-a', '-d', 'cwd', '-p', pids.join(','), '-Fpn'], undefined, 8000, {
      lenient: true,
    })
  );
  return sockets
    .filter((s) => cwds.has(s.pid))
    .map((s) => ({
      port: s.port,
      pid: s.pid,
      command: s.command,
      url: `http://localhost:${s.port}`,
      cwd: cwds.get(s.pid),
    }))
    .sort((a, b) => a.port - b.port);
}

// One lsof scan shared by all sessions and polls within the TTL.
function listeningServers() {
  if (!serverScan || Date.now() - serverScan.at > LSOF_TTL_MS) {
    serverScan = { at: Date.now(), promise: scanListeningServers() };
  }
  return serverScan.promise;
}

async function readState(id) {
  try {
    const file = path.join(agentService.paths.JOBS_DIR, id, 'state.json');
    return JSON.parse(await fsp.readFile(file, 'utf-8'));
  } catch {
    return null;
  }
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    })
  );
}

// lsof reports resolved paths, session dirs may be symlinked.
function real(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function isDir(p) {
  try {
    return Boolean(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * @returns {Promise<Record<string, import('../../types').AgentContext>>}
 */
async function computeAgentContexts() {
  const sessions = await agentService.listSessions({ all: true });
  const dirOf = (s) => (isDir(s.worktree) ? s.worktree : isDir(s.cwd) ? s.cwd : null);
  const dirs = [...new Set(sessions.map(dirOf).filter(Boolean))];
  const repos = new Map();
  await mapLimit(dirs, CONCURRENCY, async (dir) => repos.set(dir, await gitInfo(dir)));
  const slugs = [...new Set([...repos.values()].map((r) => r?.slug).filter(Boolean))];
  const remotes = new Map();
  await mapLimit(slugs, CONCURRENCY, async (slug) => remotes.set(slug, await ghInfo(slug)));

  const listening = await listeningServers();
  // Each server belongs to the most specific session dir containing its cwd, not to every ancestor.
  const realDirs = new Map(dirs.map((d) => [d, real(d)]));
  const ownerDir = new Map();
  for (const l of listening) {
    const cwd = real(l.cwd);
    let best = null;
    for (const [dir, rd] of realDirs) {
      if (dirOwnsCwd(rd, cwd) && (!best || rd.length > realDirs.get(best).length)) best = dir;
    }
    if (best) ownerDir.set(l, best);
  }
  const contexts = {};
  await Promise.all(
    sessions.map(async (s) => {
      const repo = repos.get(dirOf(s)) || null;
      const remote = repo?.slug ? remotes.get(repo.slug) : null;
      const model = (await sessionModel(s)) ?? modelFromFlags(s.respawnFlags);
      contexts[s.id] = {
        repo,
        model,
        cache: await sessionCache(s, model).catch(() => null),
        issues: remote?.issues || null,
        pulls: remote?.pulls || null,
        servers: listening
          .filter((l) => ownerDir.get(l) === dirOf(s))
          // eslint-disable-next-line no-unused-vars -- cwd is stripped from the response
          .map(({ cwd, ...server }) => server),
        subagents:
          s.kind === 'background'
            ? deriveSubagents(await readState(s.id))
            : { running: 0, total: 0, names: [] },
      };
    })
  );
  return contexts;
}

// Stale-while-revalidate: gh + lsof take 7-12s cold, so serve the last result and refresh behind it.
const CONTEXT_FRESH_MS = 10_000;
let contextCache = null; // { at, value, promise }

/** Pids of the listening servers the dashboard shows: the only ones the stats route may report */
export async function getKnownServerPids() {
  const contexts = await getAgentContexts();
  return new Set(Object.values(contexts).flatMap((c) => c.servers.map((server) => server.pid)));
}

/**
 * @returns {Promise<Record<string, import('../../types').AgentContext>>}
 */
export function getAgentContexts() {
  if (contextCache?.value && Date.now() - contextCache.at < CONTEXT_FRESH_MS) {
    return Promise.resolve(contextCache.value);
  }
  if (!contextCache?.promise) {
    const promise = computeAgentContexts().then(
      (value) => {
        contextCache = { at: Date.now(), value, promise: null };
        return value;
      },
      (error) => {
        contextCache.promise = null;
        throw error;
      }
    );
    contextCache = { ...(contextCache || { at: 0, value: null }), promise };
  }
  return contextCache.value ? Promise.resolve(contextCache.value) : contextCache.promise;
}
