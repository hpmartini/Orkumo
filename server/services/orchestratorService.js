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
      .replaceAll('{{BIN}}', binDir)
      .replaceAll('{{API_URL}}', apiUrl);
  const changed = [];
  const write = (rel, content, mode = RO) => {
    if (writeIfChanged(path.join(dir, rel), content, mode)) changed.push(rel);
  };
  const writeBin = (name, content, mode) => {
    if (writeIfChanged(path.join(binDir, name), content, mode))
      changed.push(`orchestrator-bin/${name}`);
  };

  // roles/ holds Hape's role files: created, never written
  fs.mkdirSync(rolesDir(dir), { recursive: true });
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
  // `/status-report`: one command that sends the full snapshot (AGENTS.md "Status report")
  const statusReport = fill(template('status-report.md'));
  write('.claude/skills/status-report/SKILL.md', statusReport);
  write('.omp/skills/status-report/SKILL.md', statusReport);
  writeBin('orkumo.mjs', template('orkumo.mjs'), 0o555);
  // What `orkumo report` sends: schema and a full example, read-only next to the CLI
  writeBin('report.schema.json', template('report.schema.json'), RO);
  writeBin('report.example.json', template('report.example.json'), RO);
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

/** Role files of specialised orchestrators (`<workspace>/roles/<id>.md`), written by Hape */
export const rolesDir = (dir = orchestratorDir()) => path.join(dir, 'roles');
/** A role id is a plain file name: no path separators, no leading dot */
const ROLE_ID_RE = /^[a-z0-9][\w.-]{0,63}$/i;

/** Roles in `roles/`, by file name, titled by their first `#` heading */
export function listRoles(dir = orchestratorDir()) {
  let files;
  try {
    files = fs.readdirSync(rolesDir(dir));
  } catch {
    return [];
  }
  return files
    .filter((f) => f.endsWith('.md') && ROLE_ID_RE.test(f.slice(0, -3)))
    .sort()
    .map((f) => {
      const id = f.slice(0, -3);
      const text = fs.readFileSync(path.join(rolesDir(dir), f), 'utf8');
      return { id, title: /^#\s+(.+)$/m.exec(text)?.[1].trim() || id };
    });
}

/** `id` when it names an existing role file, else a 400 */
export function assertRole(id, dir = orchestratorDir()) {
  if (typeof id !== 'string' || !ROLE_ID_RE.test(id) || !listRoles(dir).some((r) => r.id === id)) {
    throw httpError(400, 'Unknown orchestrator role');
  }
  return id;
}

/** First message of a new orchestrator with a role (it starts in the workspace) */
export const roleStartPrompt = (role) =>
  `Read AGENTS.md and roles/${role}.md in this workspace; the role applies in addition to AGENTS.md. ` +
  'Start as described there under "Start".';

/** Typed into / replied to a running orchestrator that is given a role */
export const roleBriefing = (role, dir = orchestratorDir()) =>
  `From now on you take the orchestrator role in ${path.join(rolesDir(dir), `${role}.md`)}; ` +
  'it applies in addition to AGENTS.md. Read it and start as described there under "Start".';

/** Role of a session in `agentView.orchestratorRoles` (by row id, transcript uuid or pane id) */
export const sessionRole = (session, roles = {}) =>
  [session.id, session.sessionId, session.paneId].map((k) => k && roles[k]).find(Boolean) ?? null;

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
export function overviewAgent(
  session,
  ctx,
  { orchestrators = [], orchestratorRoles = {}, lastText = null } = {}
) {
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
    role: sessionRole(session, orchestratorRoles),
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
  orchestratorRoles = {},
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
      overviewAgent(session, contexts[session.id], {
        orchestrators,
        orchestratorRoles,
        lastText: texts[i],
      })
    ),
  };
}

/**
 * Last `last` user/assistant turns of a session's transcript (omp store, Claude job, or a Claude
 * terminal's ~/.claude/projects file); [] when there is none.
 * @param {{ getTranscriptTail: Function, readTranscriptTail: Function, projectSlug: Function,
 *   projectsDir: string, findOmpSessionFile?: Function, readOmpTranscriptTail?: Function }} deps
 * @param {{ maxChars?: number }} [options] per-entry cap of the readers (default 4000)
 */
export async function readSessionTranscript(session, last, deps, options) {
  const extra = options ? [options] : [];
  if (session.id.startsWith('omp-')) {
    const findFile = deps.findOmpSessionFile ?? findOmpSessionFile;
    const readTail = deps.readOmpTranscriptTail ?? readOmpTranscriptTail;
    const file = session.sessionId && (await findFile(session.sessionId));
    return file ? readTail(file, last, ...extra) : [];
  }
  if (session.kind === 'background') {
    return (await deps.getTranscriptTail(session.id, last, ...extra)).entries || [];
  }
  if (!session.sessionId || !session.cwd) return [];
  const file = path.join(
    deps.projectsDir,
    deps.projectSlug(session.cwd),
    `${session.sessionId}.jsonl`
  );
  if (!fs.existsSync(file)) return [];
  return (await deps.readTranscriptTail(file, last, ...extra)).entries || [];
}

/** Transcript files of a session (omp store, else Claude projects files: a job has one per resume) */
export async function sessionTranscriptFiles(session, deps) {
  if (session.id.startsWith('omp-')) {
    const file =
      session.sessionId &&
      (await (deps.findOmpSessionFile ?? findOmpSessionFile)(session.sessionId));
    return file ? [file] : [];
  }
  if (!session.cwd) return [];
  return [...new Set([session.sessionId, ...(session.sessionIds ?? [])])]
    .filter(Boolean)
    .map((id) => path.join(deps.projectsDir, deps.projectSlug(session.cwd), `${id}.jsonl`))
    .filter((file) => fs.existsSync(file));
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
 * @param {{ harness: string, cwd: string, prompt: string, orchestrator?: boolean, name?: string|null, model?: string|null,
 *   permissionMode?: string|null }} opts
 * @param {object} deps - startQuickAgent's deps, plus `workspace` and `orchestratorSettings` (the
 *   Claude Code role profile of an orchestrator, agentService.js ORCHESTRATOR_SETTINGS)
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
      name: opts.name ?? null,
      model: opts.model ?? null,
      permissionMode: opts.permissionMode ?? null,
      paneId: `${opts.orchestrator ? 'orch' : 'work'}-${crypto.randomUUID()}`,
      remoteControl: opts.orchestrator ? opts.name || 'orchestrator' : null,
      settings: opts.orchestrator ? deps.orchestratorSettings : null,
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

/**
 * Key of an orchestrator's threads: its session id; a Claude terminal's row id is its pid (new on
 * every restart), so its transcript uuid
 */
export const threadOwnerKey = (session) =>
  (session.id.startsWith('interactive-') && session.sessionId) || session.id;

// ---------------------------------------------------------------------------------------------
// C4 guards: one live holder per role; agents cannot end an orchestrator
// ---------------------------------------------------------------------------------------------

/** Pane ids of orchestrators the server started (startAgentPane): an orchestrator before it is marked */
export const ORCHESTRATOR_PANE_PREFIX = 'orch-';

/**
 * Why a caller may not end `session` (stop, pane stop, delete, respawn); null when it may.
 * Only the UI (Hape) can end an orchestrator, and the orchestrator itself (`caller.paneId` is the
 * pane it runs in, sent by the CLI as X-Orkumo-Pane). Workers and finished sessions are free.
 * @param {{ session: object|null, paneId?: string|null, caller: { ui: boolean, paneId?: string|null },
 *   settings: { orchestrators?: string[] } }} opts - `paneId`: the pane a pane route names
 */
export function stopRefusal({ session, paneId = session?.paneId, caller, settings }) {
  if (caller.ui || (session && isFinished(session))) return null;
  const marked = !!session && isOrchestratorSession(session, settings.orchestrators);
  if (!marked && !paneId?.startsWith(ORCHESTRATOR_PANE_PREFIX)) return null;
  if (caller.paneId && caller.paneId === paneId) return null;
  const name = session?.name || session?.id || paneId;
  return {
    status: 403,
    error: `${name} is an orchestrator; agents may not stop it. Only Hape can, in the Orkumo UI.`,
  };
}

/** Typed text that ends the agent (`/exit`, `/quit`): a way to stop it that no stop route sees */
export const endsSession = (text) => /^\s*\/(?:exit|quit)\b(?![\w-])/i.test(String(text));

/** Transcripts of an orchestrator's chat: the pane's earlier sessions (oldest first), then its own */
export const transcriptSessionIds = (session, earlier = []) => [
  ...new Set([...earlier, session.sessionId].filter(Boolean)),
];

const sameLabel = (a, b) =>
  !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/**
 * Why a second session may not take `role` (a live orchestrator holds it); null when it is free.
 * A role is also a name: `role` matches the role id OR the name of a live orchestrator (a marked
 * session or a server-started `orch-` pane), case-insensitively: stopping `playmaker` and starting
 * `--name playmaker` is a second holder. A role key that is the id of a pane whose agent still runs
 * (`livePanes`) holds the role too: the server marks a new orchestrator pane at start, before its
 * row is listed
 * `pending`: orchestrators the server started that no listing shows yet (`{ name, who }`): a second
 * start right behind the first must see it
 * @param {{ sessions: object[], settings: { orchestrators?: string[], orchestratorRoles?: object },
 *   livePanes?: Set<string>, pending?: { name: string, who: string }[] }} opts
 */
export function roleHeldRefusal(role, { sessions, settings, livePanes, pending = [] }) {
  const { orchestrators = [], orchestratorRoles = {} } = settings;
  const session = sessions.find(
    (s) =>
      !isFinished(s) &&
      (isOrchestratorSession(s, orchestrators) || s.paneId?.startsWith(ORCHESTRATOR_PANE_PREFIX)) &&
      (sameLabel(sessionRole(s, orchestratorRoles), role) || sameLabel(s.name, role))
  );
  const paneId =
    session?.paneId ??
    Object.keys(orchestratorRoles).find(
      (key) => sameLabel(orchestratorRoles[key], role) && livePanes?.has(key)
    );
  const waiting = pending.find((p) => sameLabel(p.name, role));
  if (!session && !paneId && !waiting) return null;
  const who = session
    ? `${session.name || session.id}${session.paneId ? ` (pane ${session.paneId})` : ''}`
    : paneId
      ? `pane ${paneId}`
      : waiting.who;
  return {
    status: 409,
    error: `Role ${role} is already held by ${who}. Use that session; reset it with Handoff + Reset instead of starting a second one.`,
  };
}

/**
 * Marks and roles the server wrote (pane follower, a started orchestrator) that no client has read
 * yet. A page that did not know of them PUTs its own copy of `orchestrators` / `orchestratorRoles`
 * and would undo them: `reconcile` maps keys the follower moved (a stale copy still has the old
 * session id) and keeps the unread keys. A client read (`seen`) ends the protection: from then on
 * a missing key is the user's decision. [shortcut: one reader assumed; a second open page that has
 * not read yet keeps the keys once more]
 */
export function createMarkGuard() {
  let unseen = { marks: new Set(), roles: {}, moved: {} };
  return {
    /** @param {{ marks?: string[], roles?: Record<string,string>, moved?: Record<string,string> }} change */
    written({ marks = [], roles = {}, moved = {} }) {
      for (const [from, to] of Object.entries(unseen.moved))
        if (to in moved) unseen.moved[from] = moved[to];
      Object.assign(unseen.moved, moved);
      // a key that was moved on again is no longer the server's to protect
      for (const from of Object.keys(moved)) {
        unseen.marks.delete(from);
        delete unseen.roles[from];
      }
      for (const key of marks) unseen.marks.add(key);
      Object.assign(unseen.roles, roles);
    },
    seen() {
      unseen = { marks: new Set(), roles: {}, moved: {} };
    },
    /** The PUT body with the server's unread changes applied; fields it does not carry stay out */
    reconcile(partial) {
      const out = { ...partial };
      const key = (k) => unseen.moved[k] ?? k;
      if (Array.isArray(partial.orchestrators))
        out.orchestrators = [...new Set([...partial.orchestrators.map(key), ...unseen.marks])];
      if (partial.orchestratorRoles && typeof partial.orchestratorRoles === 'object') {
        const roles = {};
        for (const [k, role] of Object.entries(partial.orchestratorRoles))
          if (!(key(k) in roles) || key(k) === k) roles[key(k)] = role;
        out.orchestratorRoles = { ...unseen.roles, ...roles };
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// C4: an orchestrator's identity follows its pane
// ---------------------------------------------------------------------------------------------

const newestFirst = (a, b) => activityMs(b) - activityMs(a);

/**
 * A new row in the pane is the same agent when the same process runs it (`/clear`, `/new`,
 * `/resume`). Without a pid nothing is known (every orchestrator shares one cwd): not followed
 */
const sameProcess = (tracked, row) => !!tracked.pid && tracked.pid === row.pid;

/**
 * Follows orchestrator panes across new session ids. The agents refresh feeds `observe` every
 * listing (and orchestrator routes on a lazy read), so it works without an open UI view.
 *
 * Per pane with a marked terminal row it remembers `{ rowId, sessionId, pid, cwd }` (persisted:
 * the agent runs in a holder process and can switch while the server is down). When the pane's
 * live row has another session id and the same process (pid), the old session's keys move:
 * marks and roles (keys that are not the pane id or still valid for the new row), the threads
 * file (owner key) and a row-keyed status report. Nothing moves when
 * - the pane's PTY is gone (pane closed: the entry is dropped, a later reuse of the id is a new
 *   agent), or another process (pid) runs in it now,
 * - the pane has no live row (omp has not written the new session yet): it waits,
 * - the old session was unmarked meanwhile.
 * @param {{ file: string, getSettings: () => { orchestrators?: string[], orchestratorRoles?: object },
 *   setSettings: (partial: object, moved: Record<string, string>) => void, threads: { moveOwner: Function },
 *   reports: { get: Function, rekey: Function } }} deps
 */
export function createPaneFollower({ file, getSettings, setSettings, threads, reports }) {
  let tracked = null;
  const load = () => {
    if (tracked) return tracked;
    try {
      tracked = JSON.parse(fs.readFileSync(file, 'utf8')) ?? {};
    } catch {
      tracked = {};
    }
    return tracked;
  };
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(tracked));
    fs.renameSync(tmp, file);
  };
  // `previous`: the sessions the pane had before (oldest first): the transcripts that hold the
  // entries of the threads that moved along
  const track = (row, previous = []) => ({
    rowId: row.id,
    sessionId: row.sessionId ?? null,
    pid: row.pid ?? null,
    cwd: row.cwd ?? null,
    previous,
  });
  const same = (t, row) => row.id === t.rowId && (row.sessionId ?? null) === t.sessionId;

  /** Moves what the session `t` owned to `next` */
  function follow(paneId, t, next) {
    const settings = getSettings();
    const { orchestrators = [], orchestratorRoles = {} } = settings;
    const before = { id: t.rowId, sessionId: t.sessionId, paneId };
    if (!isOrchestratorSession(before, orchestrators)) return false;

    const newKey = next.sessionId || next.paneId || next.id;
    const stillValid = new Set([next.id, next.sessionId, next.paneId]);
    const gone = [t.rowId, t.sessionId].filter((key) => key && !stillValid.has(key));

    let marks = orchestrators;
    if (gone.some((key) => marks.includes(key))) {
      marks = marks.filter((key) => !gone.includes(key));
      if (!isOrchestratorSession(next, marks)) marks = [...marks, newKey];
    }
    const roles = Object.fromEntries(
      Object.entries(orchestratorRoles).filter(([key]) => !gone.includes(key))
    );
    const movedRole = gone.map((key) => orchestratorRoles[key]).find(Boolean);
    if (movedRole && !sessionRole(next, roles)) roles[newKey] = movedRole;
    if (marks !== orchestrators || gone.some((key) => key in orchestratorRoles))
      setSettings(
        { orchestrators: marks, orchestratorRoles: roles },
        Object.fromEntries(gone.map((key) => [key, newKey]))
      );

    threads.moveOwner(
      threadOwnerKey({ id: t.rowId, sessionId: t.sessionId }),
      threadOwnerKey(next)
    );
    const reportBefore = sessionRole(before, orchestratorRoles) ?? t.rowId;
    const agentId = reports.get(reportBefore)?.report.orchestrator.agentId;
    reports.rekey(reportBefore, sessionRole(next, roles) ?? next.id, {
      agentId: agentId === t.rowId ? next.id : agentId === t.sessionId ? next.sessionId : undefined,
    });
    return true;
  }

  return {
    /** Sessions the pane had before its current one, oldest first */
    previousSessions: (paneId) => load()[paneId]?.previous ?? [],
    /**
     * @param {object[]} sessions the agents listing
     * @param {Set<string>|null} livePanes panes whose agent PTY runs; null: unknown
     */
    observe(sessions, livePanes = null) {
      const map = load();
      let dirty = false;
      for (const [paneId, t] of Object.entries(map)) {
        if (livePanes && !livePanes.has(paneId)) {
          delete map[paneId];
          dirty = true;
          continue;
        }
        const here = sessions.filter((s) => s.paneId === paneId && !isFinished(s));
        if (!here.length) continue;
        const current = here.find((row) => same(t, row));
        if (current) {
          if ((current.pid ?? null) !== t.pid) {
            map[paneId] = track(current, t.previous);
            dirty = true;
          }
          continue;
        }
        const next = [...here].sort(newestFirst)[0];
        delete map[paneId]; // a new agent in the pane is tracked below when its row is marked
        if (sameProcess(t, next) && follow(paneId, t, next))
          map[paneId] = track(
            next,
            [...(t.previous ?? []), t.sessionId].filter(Boolean).slice(-20)
          );
        dirty = true;
      }
      const { orchestrators = [] } = getSettings();
      for (const s of sessions) {
        if (
          s.paneId &&
          s.kind === 'interactive' &&
          !isFinished(s) &&
          !map[s.paneId] &&
          isOrchestratorSession(s, orchestrators)
        ) {
          map[s.paneId] = track(s);
          dirty = true;
        }
      }
      if (dirty) save();
    },
  };
}
