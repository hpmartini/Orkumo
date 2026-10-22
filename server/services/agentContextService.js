/**
 * Per-session context for the Agents View: git repo/branch, open issues/PRs (gh) and sub-agents.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import * as agentService from './agentService.js';

const GH_TTL_MS = 60_000;
const CONCURRENCY = 4;
const GH_FAIL_TTL_MS = 10_000;
const ghCache = new Map(); // slug -> { at, ttl, promise }
// A hostile repo config must not execute code (fsmonitor, hooks) when we only read status.
const GIT_SAFE = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null'];

function run(cmd, args, cwd, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 1024 * 1024 }, (error, stdout) =>
      resolve(error ? null : String(stdout))
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

async function gitInfo(dir) {
  const top = await run('git', [...GIT_SAFE, 'rev-parse', '--show-toplevel'], dir);
  if (!top) return null;
  const [branch, status, counts, remote] = await Promise.all([
    run('git', [...GIT_SAFE, 'rev-parse', '--abbrev-ref', 'HEAD'], dir),
    run('git', [...GIT_SAFE, 'status', '--porcelain'], dir),
    run('git', [...GIT_SAFE, 'rev-list', '--left-right', '--count', '@{u}...HEAD'], dir),
    run('git', [...GIT_SAFE, 'remote', 'get-url', 'origin'], dir),
  ]);
  const name = branch?.trim();
  return {
    name: path.basename(top.trim()),
    slug: parseGithubSlug(remote),
    branch: name && name !== 'HEAD' ? name : null,
    dirty: Boolean(status?.trim()),
    ...parseAheadBehind(counts),
  };
}

async function ghCount(kind, slug) {
  const out = await run(
    'gh',
    [kind, 'list', '--repo', slug, '--state', 'open', '--json', 'number', '--limit', '100'],
    undefined,
    10000
  );
  try {
    return {
      open: JSON.parse(out).length,
      url: `https://github.com/${slug}/${kind === 'pr' ? 'pulls' : 'issues'}`,
    };
  } catch {
    return null;
  }
}

async function ghInfo(slug) {
  const hit = ghCache.get(slug);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.promise;
  // Cache the in-flight promise so concurrent polls share one gh run; failures expire quickly.
  const entry = { at: Date.now(), ttl: GH_TTL_MS, promise: null };
  entry.promise = Promise.all([ghCount('issue', slug), ghCount('pr', slug)]).then(
    ([issues, pulls]) => {
      if (!issues && !pulls) entry.ttl = GH_FAIL_TTL_MS;
      return { issues, pulls };
    }
  );
  ghCache.set(slug, entry);
  return entry.promise;
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
export async function getAgentContexts() {
  const sessions = await agentService.listSessions({ all: true });
  const dirOf = (s) => (isDir(s.worktree) ? s.worktree : isDir(s.cwd) ? s.cwd : null);
  const dirs = [...new Set(sessions.map(dirOf).filter(Boolean))];
  const repos = new Map();
  await mapLimit(dirs, CONCURRENCY, async (dir) => repos.set(dir, await gitInfo(dir)));
  const slugs = [...new Set([...repos.values()].map((r) => r?.slug).filter(Boolean))];
  const remotes = new Map();
  await mapLimit(slugs, CONCURRENCY, async (slug) => remotes.set(slug, await ghInfo(slug)));

  const contexts = {};
  await Promise.all(
    sessions.map(async (s) => {
      const repo = repos.get(dirOf(s)) || null;
      const remote = repo?.slug ? remotes.get(repo.slug) : null;
      contexts[s.id] = {
        repo,
        issues: remote?.issues || null,
        pulls: remote?.pulls || null,
        subagents:
          s.kind === 'background'
            ? deriveSubagents(await readState(s.id))
            : { running: 0, total: 0, names: [] },
      };
    })
  );
  return contexts;
}
