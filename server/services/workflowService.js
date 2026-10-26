/**
 * Martini Workflows (mw): local run state for the workflow view.
 * Reads only what mw writes (journal, `.git/mw6/runs/<id>/{trace.jsonl,approval-*.json}`) and calls
 * the unmodified `mw` CLI for approvals; the stage rule itself lives in utils/workflowStage.js.
 */
import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const MW_CACHE_DIR = path.join(os.homedir(), '.claude/plugins/cache/martini-labs/mw');
const RUNS_TTL_MS = 30_000;
const MAX_IMAGES = 12;
// Documents an mw run leaves in a checkout besides the briefing named by the `briefed` marker
const DOC_RE = /^(BRIEFING|PLAN|PRD|SPEC)[\w.-]*\.md$/i;

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

const journalPath = () =>
  process.env.MW_JOURNAL && process.env.MW_JOURNAL !== 'off'
    ? process.env.MW_JOURNAL
    : path.join(os.homedir(), '.local/state/mw/journal.jsonl');

/** Highest `x.y.z` among plugin version folder names, null if none */
export function pickLatestVersion(names) {
  const parse = (n) => (/^\d+\.\d+\.\d+$/.test(n) ? n.split('.').map(Number) : null);
  return (
    names
      .filter(parse)
      .sort((a, b) => {
        const [x, y] = [parse(a), parse(b)];
        return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
      })
      .at(-1) ?? null
  );
}

/** The installed mw CLI (the plugin version changes under running sessions), else `mw` on PATH */
export async function mwBin() {
  const latest = pickLatestVersion(await fs.readdir(MW_CACHE_DIR).catch(() => []));
  return latest ? path.join(MW_CACHE_DIR, latest, 'bin/mw') : 'mw';
}

/** session UUID -> newest journal entry with a run dir ({ runDir, repoPath }) */
export function parseJournal(text) {
  const bySession = new Map();
  for (const line of String(text).split('\n')) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e?.session && e.run_dir) {
      bySession.set(e.session, { runDir: e.run_dir, repoPath: e.repo_path ?? '' });
    }
  }
  return bySession;
}

/** trace.jsonl -> GitHub issue number of the run (0 = none) and its phases in order */
export function parseTrace(text) {
  let issue = 0;
  const phases = [];
  for (const line of String(text).split('\n')) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e?.phase) continue;
    if (!issue && e.issue) issue = e.issue;
    phases.push({
      phase: e.phase,
      result: e.result ?? '',
      at: e.ts ?? '',
      role: e.role ?? '',
      model: e.model ?? '',
    });
  }
  return { issue, phases };
}

/** An approval record mw is still waiting for: written by request_approval, no `by` yet */
export function pendingApproval(records) {
  const open = records.filter((r) => r && r.stage && r.sha && !r.by);
  const order = ['briefing', 'plan', 'pr'];
  open.sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));
  return open.at(-1) ? { stage: open.at(-1).stage, sha: open.at(-1).sha } : null;
}

const readText = (p) => fs.readFile(p, 'utf8').catch(() => '');

/** WorkflowRun for one run dir (see utils/workflowStage.js) */
async function readRun(runDir, repoPath) {
  const runId = path.basename(runDir);
  const names = await fs.readdir(runDir).catch(() => []);
  const records = await Promise.all(
    names
      .filter((n) => /^approval-(briefing|plan|pr)\.json$/.test(n))
      .map(async (n) => {
        try {
          return JSON.parse(await readText(path.join(runDir, n)));
        } catch {
          return null;
        }
      })
  );
  const { issue, phases } = parseTrace(await readText(path.join(runDir, 'trace.jsonl')));
  return {
    run: {
      runId,
      repoPath,
      mode: runId.startsWith('orch-') ? 'orchestrate' : 'pipeline',
      phases,
      pendingApproval: pendingApproval(records),
    },
    issue,
    runDir,
  };
}

/** Newest pipeline run per issue number in a checkout's `.git/mw6/runs` */
async function pipelineRuns(repoPath) {
  const dir = path.join(repoPath, '.git/mw6/runs');
  const names = (await fs.readdir(dir).catch(() => [])).filter((n) => n.startsWith('run-'));
  const runs = await Promise.all(names.map((n) => readRun(path.join(dir, n), repoPath)));
  const byIssue = new Map();
  for (const r of runs.sort((a, b) => a.run.runId.localeCompare(b.run.runId))) {
    if (r.issue) byIssue.set(r.issue, r);
  }
  return byIssue;
}

let runsCache = null; // { at, key, data }

/**
 * Local mw runs of the workflow items: { "<repo>#<n>": { ...WorkflowRun, runDir } }.
 * Orchestrate runs come via the journal (session of the `start` marker), pipeline runs via the
 * issue number in their trace.
 * @param {{ repo: string|null, number: number|null, mwMarkers: { kind: string, attrs: Record<string,string> }[] }[]} items
 * @param {(slug: string) => Promise<string|null>} findRepoPath
 */
export async function getRuns(items, findRepoPath, { refresh = false } = {}) {
  const key = items.map((i) => `${i.repo}#${i.number}`).join(',');
  if (!refresh && runsCache?.key === key && Date.now() - runsCache.at < RUNS_TTL_MS) {
    return runsCache.data;
  }
  const journal = parseJournal(await readText(journalPath()));
  const out = {};
  const repos = [...new Set(items.map((i) => i.repo).filter(Boolean))];
  const clones = new Map(
    await Promise.all(repos.map(async (r) => [r, await findRepoPath(r).catch(() => null)]))
  );
  const pipelines = new Map(
    await Promise.all([...clones].map(async ([r, p]) => [r, p ? await pipelineRuns(p) : new Map()]))
  );
  await Promise.all(
    items.map(async (item) => {
      if (!item.repo || !item.number) return;
      const sessions = item.mwMarkers.filter((m) => m.kind === 'start').map((m) => m.attrs.session);
      const fromJournal = sessions
        .map((s) => journal.get(s))
        .filter(Boolean)
        .at(-1);
      const found = fromJournal
        ? await readRun(fromJournal.runDir, fromJournal.repoPath)
        : pipelines.get(item.repo)?.get(item.number);
      if (found) out[`${item.repo}#${item.number}`] = { ...found.run, runDir: found.runDir };
    })
  );
  runsCache = { at: Date.now(), key, data: out };
  return out;
}

export function clearRunsCache() {
  runsCache = null;
}

/** Image URLs in markdown/HTML comment bodies (review screenshots), oldest first, deduplicated */
export function extractImages(bodies) {
  const urls = [];
  const re = /!\[[^\]]*\]\((https:\/\/[^)\s]+)\)|<img[^>]+src="(https:\/\/[^"]+)"/g;
  for (const body of bodies) {
    for (const m of String(body || '').matchAll(re)) {
      const url = m[1] || m[2];
      if (!urls.includes(url)) urls.push(url);
    }
  }
  return urls.slice(-MAX_IMAGES);
}

function gh(args) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) return reject(httpError(`gh failed: ${error.message}`, 502));
      try {
        resolve(JSON.parse(String(stdout || '[]')));
      } catch {
        reject(httpError('gh returned non-JSON', 502));
      }
    });
  });
}

/** Comment bodies of an issue or PR (`--paginate` concatenates pages into one array with --slurp) */
async function commentBodies(repo, number) {
  const pages = await gh([
    'api',
    '--paginate',
    '--slurp',
    `repos/${repo}/issues/${number}/comments`,
  ]);
  return pages.flat().map((c) => c?.body ?? '');
}

/**
 * Docs of a workflow: the briefing of the `briefed` marker and BRIEFING/PLAN/PRD/SPEC files in the
 * checkout/worktree, plus the plans (`plan-<n>.json`) of the mw run.
 */
export async function findDocs(dirs, briefingPath, runDir = null) {
  const docs = [];
  const add = async (dir, rel) => {
    const full = path.resolve(dir, rel);
    // Only files inside the checkout: a marker path must not walk out of it
    if (!full.startsWith(path.resolve(dir) + path.sep)) return;
    if (docs.some((d) => d.path === full)) return;
    const stat = await fs.stat(full).catch(() => null);
    if (stat?.isFile()) docs.push({ name: rel, path: full });
  };
  for (const dir of dirs.filter(Boolean)) {
    if (briefingPath) await add(dir, briefingPath);
    for (const n of await fs.readdir(dir).catch(() => [])) if (DOC_RE.test(n)) await add(dir, n);
  }
  if (runDir) {
    for (const n of await fs.readdir(runDir).catch(() => [])) {
      if (/^plan-\d+\.json$/.test(n)) docs.push({ name: n, path: path.join(runDir, n) });
    }
  }
  return docs;
}

/**
 * Lazy details of one workflow card: docs, review screenshots (issue + PR comments) and run phases.
 * @param {{ repo: string, number: number, pullRequests: { repo: string, number: number }[] }} item
 * @param {{ dirs: string[], briefingPath: string|null, runDir?: string|null }} where
 */
export async function getDetails(item, { dirs, briefingPath, runDir }) {
  const [docs, bodies] = await Promise.all([
    findDocs(dirs, briefingPath, runDir),
    Promise.all([
      commentBodies(item.repo, item.number),
      ...item.pullRequests.map((pr) => commentBodies(pr.repo, pr.number)),
    ]).then((lists) => lists.flat()),
  ]);
  return { docs, screenshots: extractImages(bodies) };
}

/** Content of a doc that getDetails listed for this item (the caller passes that list) */
export async function readDoc(docs, requested) {
  const doc = docs.find((d) => d.path === requested);
  if (!doc) throw httpError('Not a document of this workflow', 403);
  const text = await fs.readFile(doc.path, 'utf8');
  return { name: doc.name, path: doc.path, content: text.slice(0, 200_000) };
}

/** `mw approve --repo <checkout> <run> <stage> <sha>`; mw checks HEAD and a clean worktree itself */
export async function approve(run, stage, sha) {
  const bin = await mwBin();
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ['approve', '--repo', run.repoPath, run.runId, stage, sha],
      { cwd: run.repoPath, timeout: 60_000 },
      (error, stdout, stderr) => {
        if (error) {
          const msg = String(stderr || stdout || error.message).trim();
          return reject(httpError(`mw approve: ${msg}`, 409));
        }
        clearRunsCache();
        resolve({ ok: true, output: String(stdout).trim() });
      }
    );
  });
}
