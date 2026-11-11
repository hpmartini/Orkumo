/**
 * Chat pane side data (#189 follow-up): status line (git, context fill, plan limits),
 * `@` file completion and background shell output.
 */
import { execFile } from 'child_process';
import fsp from 'fs/promises';
import { gitInfo, sessionCache } from './agentContextService.js';
import { claudeLimits, defaultSources } from './usageService.js';

/**
 * Status line of a chat: { git, cache, context, limits }; each part null when unknown.
 * Claude Code: prompt cache and context from its transcript, plan limits from its login.
 * Other harnesses: context and limits as their driver reported them (`usage`); a Claude model
 * without own limits (omp, pi on the Claude subscription) shows Claude's plan limits.
 */
export async function chatStatus({ harness = 'claude', cwd, sessionId, model, usage = null }) {
  const claude = harness === 'claude';
  const claudeModel = claude || /claude|anthropic/i.test(model || '');
  const [git, cache, claudePlan] = await Promise.all([
    gitInfo(cwd).catch(() => null),
    claude && sessionId ? sessionCache({ cwd, sessionId }, model).catch(() => null) : null,
    claudeModel && !usage?.limits
      ? claudeLimits(defaultSources()[0], Date.now()).catch(() => null)
      : null,
  ]);
  return {
    git: git && {
      branch: git.branch,
      untracked: git.untracked ?? 0,
      changed: git.changed ?? 0,
      ahead: git.ahead,
      behind: git.behind,
    },
    cache,
    context: cache
      ? { tokens: cache.cachedTokens, window: cache.contextWindow }
      : (usage?.context ?? null),
    limits: usage?.limits ?? claudePlan,
  };
}

const FILES_TTL_MS = 15_000;
const fileLists = new Map(); // cwd -> { at, files }

function listFiles(cwd) {
  const hit = fileLists.get(cwd);
  if (hit && Date.now() - hit.at < FILES_TTL_MS) return Promise.resolve(hit.files);
  return new Promise((resolve) => {
    execFile(
      'git',
      ['ls-files', '-co', '--exclude-standard'],
      { cwd, timeout: 5000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        // Untracked dependency folders (not in .gitignore) would flood every @ query
        const files = error
          ? []
          : String(stdout)
              .split('\n')
              .filter((f) => f && !/(^|\/)node_modules\//.test(f));
        fileLists.set(cwd, { at: Date.now(), files });
        resolve(files);
      }
    );
  });
}

/** Repo files matching `query`: file-name prefix first, then path substring */
export function rankFiles(files, query, limit = 50) {
  const q = String(query || '').toLowerCase();
  if (!q) return files.slice(0, limit);
  const base = [];
  const rest = [];
  for (const f of files) {
    const lower = f.toLowerCase();
    if (lower.split('/').pop().startsWith(q)) base.push(f);
    else if (lower.includes(q)) rest.push(f);
    if (base.length >= limit) break;
  }
  return [...base, ...rest].slice(0, limit);
}

export async function chatFiles(cwd, query) {
  return rankFiles(await listFiles(cwd), query);
}

const TAIL_BYTES = 64 * 1024;

/** Last 64 KB of a shell output file and when it last changed; null when unreadable */
export async function shellTail(file) {
  try {
    const { size, mtimeMs } = await fsp.stat(file);
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    const handle = await fsp.open(file, 'r');
    try {
      await handle.read(buffer, 0, length, size - length);
    } finally {
      await handle.close();
    }
    return { output: buffer.toString('utf8'), updatedAt: mtimeMs, truncated: size > length };
  } catch {
    return null;
  }
}
