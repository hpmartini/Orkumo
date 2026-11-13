/**
 * Orchestrators: agent sessions marked in `agentView.orchestrators` that watch, structure and
 * distribute the work of every other agent, but never execute it themselves. They run in a
 * workspace of their own (`<data>/orchestrator/`: AGENTS.md, Claude settings, skills, the
 * `orkumo` CLI), so their tooling never loads into a project agent's context. The CLI talks to
 * the routes under /api/orchestrator plus the existing agent routes (dispatch, reply, pane
 * message, stop).
 *
 * Everything that touches agentService is injected (`deps`): agentService imports
 * `orchestratorDir` from here to accept the workspace as a working directory.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDataPath } from './dataPath.js';
import { QUICK_HARNESSES, startQuickAgent } from './quickAgent.js';
import { findOmpSessionFile, readOmpTranscriptTail } from './ompSessions.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const SKILL_NAME = 'orkumo-orchestrator';
/** Harnesses an agent pane can start (it needs their session id to list them) */
export const PANE_HARNESSES = QUICK_HARNESSES;
/** Transcripts read for the "last answer" of one overview (newest agents first) */
export const OVERVIEW_TEXT_LIMIT = 25;
const LAST_TEXT_CHARS = 280;
const DAY_MS = 24 * 60 * 60 * 1000;
const FINISHED = new Set(['done', 'failed', 'stopped']);

const httpError = (status, message) => Object.assign(new Error(message), { status });

export const orchestratorDir = (dataDir = getDataPath()) => path.join(dataDir, 'orchestrator');
/**
 * CLI wrapper, script and config live next to the workspace, not in it: the guard lets an
 * orchestrator write inside its workspace, and it must not be able to rewrite its own CLI.
 */
export const orchestratorBinDir = (dir = orchestratorDir()) =>
  path.join(path.dirname(dir), 'orchestrator-bin');
export const orchestratorCli = (dir = orchestratorDir()) =>
  path.join(orchestratorBinDir(dir), 'orkumo');

/** Workspace templates: server/orchestrator in the source tree, dist-server/orchestrator in the bundle */
export function templatesDir() {
  const candidates = [path.join(here, '..', 'orchestrator'), path.join(here, 'orchestrator')];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'orkumo.mjs'))) ?? candidates[0];
}

/**
 * Writes `content` only when it differs, so a restart leaves unchanged files (and mtimes) alone.
 * Read-only files (no owner write bit) are replaced, not written through.
 */
function writeIfChanged(file, content, mode) {
  let current = null;
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch {
    current = null;
  }
  if (current === content) {
    if (mode && (fs.statSync(file).mode & 0o777) !== mode) fs.chmodSync(file, mode);
    return false;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(file, { force: true });
  fs.writeFileSync(file, content, mode ? { mode } : undefined);
  if (mode) fs.chmodSync(file, mode);
  return true;
}

/** CLAUDE.md -> AGENTS.md (Claude Code reads CLAUDE.md, omp and Codex read AGENTS.md); a copy where links fail */
function linkClaudeMd(dir) {
  const link = path.join(dir, 'CLAUDE.md');
  try {
    if (fs.readlinkSync(link) === 'AGENTS.md') return false;
  } catch {
    // missing, or a plain file: replaced below
  }
  fs.rmSync(link, { force: true });
  try {
    fs.symlinkSync('AGENTS.md', link);
  } catch {
    fs.copyFileSync(path.join(dir, 'AGENTS.md'), link);
  }
  return true;
}

/** Claude Code settings of the workspace: the CLI allowed, sub-agents denied, edits outside blocked */
export function claudeSettings({ dir, cli }) {
  return {
    permissions: {
      allow: [`Bash(${cli} *)`, `Bash("${cli}" *)`, 'Bash("$ORKUMO_CLI" *)', 'Bash(orkumo *)'],
      deny: ['Task', 'Agent'],
    },
    // Also reaches sessions Orkumo did not start here (a marked `claude --bg` job in this folder)
    env: { ORKUMO_CLI: cli, ORKUMO_WORKSPACE: dir },
    hooks: {
      PreToolUse: [
        {
          // Deny rules cannot say "outside this folder": the guard checks the target path, and
          // (best effort) Bash commands writing into .claude/.omp/AGENTS.md/the CLI
          matcher: 'Edit|MultiEdit|Write|NotebookEdit|Bash',
          hooks: [{ type: 'command', command: `"${cli}" guard` }],
        },
      ],
    },
  };
}

/**
 * Creates or refreshes the orchestrator workspace (idempotent). Generated files are rewritten
 * from the templates and kept read-only; NOTES.md belongs to the orchestrators and is only
 * created when missing. The CLI goes to `orchestrator-bin/` next to the workspace.
 * @param {{ apiUrl: string, dataDir?: string, dir?: string, templates?: string, nodeFallback?: string }} opts
 * @returns {{ dir: string, cli: string, changed: string[] }} changed: workspace-relative paths
 *   written, `orchestrator-bin/…` for the CLI
 */
export function ensureOrchestratorWorkspace({
  apiUrl,
  dataDir = getDataPath(),
  dir = orchestratorDir(dataDir),
  templates = templatesDir(),
  nodeFallback = process.execPath,
}) {
  const cli = orchestratorCli(dir);
  const binDir = orchestratorBinDir(dir);
  const template = (name) => fs.readFileSync(path.join(templates, name), 'utf8');
  const fill = (text) =>
    text
      .replaceAll('{{WORKSPACE}}', dir)
      .replaceAll('{{CLI}}', cli)
      .replaceAll('{{API_URL}}', apiUrl);
  const changed = [];
  const write = (rel, content, mode = RO) => {
    if (writeIfChanged(path.join(dir, rel), content, mode)) changed.push(rel);
  };
  const writeBin = (name, content, mode) => {
    if (writeIfChanged(path.join(binDir, name), content, mode))
      changed.push(`orchestrator-bin/${name}`);
  };

  fs.mkdirSync(dir, { recursive: true });
  // Before 2026-11 the CLI lived in <workspace>/bin, writable by the orchestrator
  fs.rmSync(path.join(dir, 'bin'), { recursive: true, force: true });
  write('AGENTS.md', fill(template('agents.md')));
  if (linkClaudeMd(dir)) changed.push('CLAUDE.md');
  const notes = path.join(dir, 'NOTES.md');
  if (!fs.existsSync(notes)) write('NOTES.md', template('notes.md'), 0o644);
  write('.claude/settings.json', `${JSON.stringify(claudeSettings({ dir, cli }), null, 2)}\n`);
  const skill = fill(template('skill.md'));
  // omp reads project skills from .omp/skills (and Claude's from .claude/skills)
  write(`.claude/skills/${SKILL_NAME}/SKILL.md`, skill);
  write(`.omp/skills/${SKILL_NAME}/SKILL.md`, skill);
  writeBin('orkumo.mjs', template('orkumo.mjs'), 0o555);
  writeBin(
    'orkumo.json',
    `${JSON.stringify({ apiUrl, tokenFile: path.join(dataDir, 'remote-token'), workspace: dir }, null, 2)}\n`,
    RO
  );
  // node from PATH; else the runtime of this server (Electron's, run as plain node)
  writeBin(
    'orkumo',
    [
      '#!/bin/sh',
      '# Generated by Orkumo: runs the orkumo CLI (orkumo.mjs next to this file)',
      'dir=$(cd "$(dirname "$0")" && pwd)',
      'if command -v node >/dev/null 2>&1; then exec node "$dir/orkumo.mjs" "$@"; fi',
      `ELECTRON_RUN_AS_NODE=1 exec ${shellQuote(nodeFallback)} "$dir/orkumo.mjs" "$@"`,
      '',
    ].join('\n'),
    0o555
  );
  return { dir, cli, changed };
}

const RO = 0o444;
const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Typed into / replied to a session that was just marked as orchestrator */
export function orchestratorBriefing(dir = orchestratorDir()) {
  const cli = orchestratorCli(dir);
  return (
    `You are now an Orkumo orchestrator. Read ${path.join(dir, 'AGENTS.md')} and follow it from now on: ` +
    `coordinate the agents running in Orkumo, never execute work yourself, never spawn sub-agents; ` +
    `hand out work only with the orkumo CLI ("${cli}" help). ` +
    `Start with "${cli}" agents and give Hape a short status in German.`
  );
}

/** First message of a new orchestrator started in the workspace (AGENTS.md is loaded already) */
export const ORCHESTRATOR_START_PROMPT =
  'Survey the agents running in Orkumo (orkumo agents) and give Hape a short status in German, then wait for his instructions.';

/** A marked session: by row id, transcript uuid or pane id (ids change when a pane resumes) */
export function isOrchestratorSession(session, ids) {
  if (!ids || ids.length === 0) return false;
  return [session.id, session.sessionId, session.paneId].some((key) => key && ids.includes(key));
}

/** Main checkout of a worktree path; mirrors mainRepoPath in utils/agentSessions.ts */
export function mainRepoPath(dir) {
  const match = String(dir || '').match(/^(.+?)\/(?:\.claude\/worktrees|\.worktrees)(?:\/|$)/);
  return match ? match[1] : dir;
}

const isFinished = (session) => FINISHED.has(session.state);
const activityMs = (session) => session.updatedAt || session.startedAt || 0;

/** Listed without `all`: what the rail shows by default, minus finished agents older than a day */
export function isListedAgent(session, now = Date.now()) {
  if (session.kind === 'interactive' && !session.paneId) return false;
  return !(isFinished(session) && activityMs(session) < now - DAY_MS);
}

const prState = (pr) =>
  pr.isDraft ? 'draft' : pr.mergeReady ? 'ready' : pr.ci === 'failure' ? 'failing' : 'open';

/**
 * Open PR links: Claude jobs report theirs (every PR they ever touched, so merged and closed ones
 * are dropped), every other session gets the open PRs of its branch
 */
function agentPrs(session, ctx) {
  if (session.links?.length) {
    return session.links
      .filter((l) => !/merged|closed/i.test(l.state || ''))
      .map((l) => ({
        number: l.number ?? null,
        url: l.href,
        state: l.state ?? null,
        title: l.title ?? null,
      }));
  }
  const branch = ctx?.repo?.branch;
  if (!branch) return [];
  return (ctx.pulls?.items || [])
    .filter((pr) => pr.headRef === branch)
    .map((pr) => ({ number: pr.number, url: pr.url, state: prState(pr), title: pr.title }));
}

/** Newest assistant text of transcript entries as one short line */
export function lastAssistantText(entries) {
  const entry = [...(entries || [])].reverse().find((e) => e.role === 'assistant' && e.text);
  if (!entry) return null;
  const line = entry.text.replace(/\s+/g, ' ').trim();
  return line.length > LAST_TEXT_CHARS ? `${line.slice(0, LAST_TEXT_CHARS - 1)}…` : line;
}

/** One agent of the overview: what an orchestrator needs to judge it, nothing more */
export function overviewAgent(session, ctx, { orchestrators = [], lastText = null } = {}) {
  const at = activityMs(session);
  return {
    id: session.id,
    sessionId: session.sessionId ?? null,
    name: session.name || null,
    harness: session.ptyCommand ?? session.harness ?? 'claude',
    kind: session.kind,
    cwd: session.cwd || null,
    project: ctx?.repo?.name || (session.cwd ? path.basename(mainRepoPath(session.cwd)) : null),
    branch: ctx?.repo?.branch ?? null,
    state: session.state ?? null,
    displayState: session.displayState ?? null,
    waitingFor: session.waitingFor ?? null,
    lastActivity: at ? new Date(at).toISOString() : null,
    prs: agentPrs(session, ctx),
    lastText,
    paneId: session.paneId ?? null,
    pid: session.pid ?? null,
    orchestrator: isOrchestratorSession(session, orchestrators),
  };
}

/**
 * GET /api/orchestrator/overview: agents newest first.
 * @param {{ sessions: object[], contexts?: Record<string, object>, orchestrators?: string[],
 *   all?: boolean, withText?: boolean, readTranscript?: (session: object, last: number) => Promise<object[]>,
 *   now?: number, workspace?: string }} opts
 */
export async function buildOverview({
  sessions,
  contexts = {},
  orchestrators = [],
  all = false,
  withText = true,
  readTranscript,
  now = Date.now(),
  workspace = orchestratorDir(),
}) {
  // A copy: `sessions` is the agent watcher's cached list
  const listed = (all ? [...sessions] : sessions.filter((s) => isListedAgent(s, now))).sort(
    (a, b) => activityMs(b) - activityMs(a)
  );
  const texts = await Promise.all(
    listed.map((session, i) =>
      withText && readTranscript && i < OVERVIEW_TEXT_LIMIT
        ? readTranscript(session, 6).then(lastAssistantText, () => null)
        : null
    )
  );
  return {
    generatedAt: new Date(now).toISOString(),
    workspace,
    agents: listed.map((session, i) =>
      overviewAgent(session, contexts[session.id], { orchestrators, lastText: texts[i] })
    ),
  };
}

/**
 * Last `last` user/assistant turns of a session's transcript (omp store, Claude job, or a Claude
 * terminal's ~/.claude/projects file); [] when there is none.
 * @param {{ getTranscriptTail: Function, readTranscriptTail: Function, projectSlug: Function,
 *   projectsDir: string, findOmpSessionFile?: Function, readOmpTranscriptTail?: Function }} deps
 */
export async function readSessionTranscript(session, last, deps) {
  if (session.id.startsWith('omp-')) {
    const findFile = deps.findOmpSessionFile ?? findOmpSessionFile;
    const readTail = deps.readOmpTranscriptTail ?? readOmpTranscriptTail;
    const file = session.sessionId && (await findFile(session.sessionId));
    return file ? readTail(file, last) : [];
  }
  if (session.kind === 'background') {
    return (await deps.getTranscriptTail(session.id, last)).entries || [];
  }
  if (!session.sessionId || !session.cwd) return [];
  const file = path.join(
    deps.projectsDir,
    deps.projectSlug(session.cwd),
    `${session.sessionId}.jsonl`
  );
  if (!fs.existsSync(file)) return [];
  return (await deps.readTranscriptTail(file, last)).entries || [];
}

/** The session an id names (row id, transcript uuid or pane id); null when none */
export const findSessionByRef = (sessions, ref) =>
  sessions.find((s) => s.id === ref || s.sessionId === ref || s.paneId === ref) ?? null;

const isUnder = (dir, root) =>
  dir === root || dir.startsWith(root.endsWith('/') ? root : `${root}/`);

/** GET /api/orchestrator/projects: scanned projects with the number of listed agents in them */
export function projectList(apps, sessions, now = Date.now()) {
  const seen = new Set();
  return apps
    .filter((app) => app.path && !seen.has(app.path) && seen.add(app.path))
    .map((app) => ({
      name: app.name,
      path: app.path,
      agents: sessions.filter((s) => s.cwd && isUnder(s.cwd, app.path) && isListedAgent(s, now))
        .length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Starts an agent as a held Orkumo pane (listed in the rail, opened like any pane): a worker in a
 * project (`orkumo start --harness omp`), or a new orchestrator in the workspace, which finds the
 * CLI on PATH. Same start as a quick window agent (quickAgent.js).
 * @param {{ harness: string, cwd: string, prompt: string, orchestrator?: boolean, model?: string|null,
 *   permissionMode?: string|null }} opts
 * @param {object} deps - startQuickAgent's deps, plus `workspace`
 */
export function startAgentPane(opts, deps) {
  if (!QUICK_HARNESSES.includes(opts.harness)) {
    throw httpError(400, 'Agent panes run Claude Code or Oh My Pi');
  }
  const dir = deps.workspace ?? orchestratorDir();
  return startQuickAgent(
    {
      harness: opts.harness,
      cwd: opts.cwd,
      prompt: opts.prompt,
      model: opts.model ?? null,
      permissionMode: opts.permissionMode ?? null,
      paneId: `${opts.orchestrator ? 'orch' : 'work'}-${crypto.randomUUID()}`,
      ...(opts.orchestrator
        ? {
            pathPrefix: [orchestratorBinDir(dir)],
            env: { ORKUMO_CLI: orchestratorCli(dir), ORKUMO_WORKSPACE: dir },
          }
        : {}),
    },
    deps
  );
}
