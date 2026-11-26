/**
 * Handoff + Reset of an agent pane: the agent writes a handoff file (skill `handoff-reset` of
 * hape-skills), the pane is reset (`/clear`, omp `/new`) and the new session continues from the
 * file. The skill's script `handoff.py mark` puts a marker `~/.claude/handoffs/.pending/<K>`
 * (line 1: the handoff file path, line 2: the reset id the job passed) and the new session's start
 * hook takes (deletes) it: marker with this job's reset id = handoff written, marker gone after the
 * reset = taken. K is the pane key (`orkumo-pane-<paneId>`; every agent pane PTY has env
 * `ORKUMO_PANE_ID`), or, for a pane started before that env existed, the cwd key. This service
 * types the three steps into the pane PTY and watches the marker; one in-memory job per pane.
 *
 * Everything outside (clock, PTY, pane lookup, pending dir) is injected, so tests run with fakes.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { paneIdOf } from '../../config/ptyEnv.js';
import { TRANSCRIPT_READERS } from './chatTranscripts.js';

/**
 * harness → what is typed. Command names verified against the live lists: Claude lists plugin
 * skills as `<plugin>:<skill>` (listSlashCommands, plugin `hape-skills`), omp as `/skill:<skill>`
 * (listOmpCommands / the skills overlay). `observeReset`: the harness exposes which session a
 * terminal runs (chatTranscripts `locate`), so the reset can be seen; pi's cannot.
 */
export const HARNESS_STEPS = Object.freeze({
  claude: { skill: '/hape-skills:handoff-reset', reset: '/clear', observeReset: true },
  omp: { skill: '/skill:handoff-reset', reset: '/new', observeReset: true },
  pi: { skill: '/skill:handoff-reset', reset: '/new', observeReset: false },
});
export const CONTINUE_TEXT = 'weiter';

export const TIMEOUTS = Object.freeze({
  pollMs: 1000,
  markerMs: 20 * 60_000,
  turnEndMs: 2 * 60_000,
  resetMs: 60_000,
  takeMs: 30_000,
  /** pi: its session switch cannot be seen, give `/new` this long */
  blindResetMs: 3000,
  /** after the new session is seen: its TUI takes input */
  afterResetMs: 1500,
  retainMs: 10 * 60_000,
});

const ACTIVE = new Set(['writing', 'resetting', 'continuing']);

export const defaultPendingDir = (home = os.homedir()) =>
  path.join(home, '.claude', 'handoffs', '.pending');

/** Python's non-strict `os.path.realpath`: symlinks of the existing part, the rest as given */
function realpathLoose(target) {
  const resolved = path.resolve(target);
  let existing = resolved;
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(existing), ...rest.reverse());
    } catch (error) {
      const parent = path.dirname(existing);
      if (error.code !== 'ENOENT' || parent === existing) return resolved;
      rest.push(path.basename(existing));
      existing = parent;
    }
  }
}

/**
 * File name of a working folder's marker: handoff.py `schluessel`
 * (`re.sub(r"[^A-Za-z0-9]+", "-", os.path.realpath(cwd)).strip("-") or "root"`)
 */
export const markerKey = (cwd) =>
  realpathLoose(cwd)
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'root';

/**
 * File name of a pane's marker: `orkumo-pane-` + the pane id, normalised like handoff.py's
 * `normalisieren` (runs of characters outside [A-Za-z0-9] become one `-`, edge dashes go)
 */
export const paneKey = (paneId) =>
  `orkumo-pane-${paneId}`.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Marker content: line 1 the handoff file, line 2 the reset id of the job that asked for it */
function readMarker(file) {
  try {
    const [handoffFile = '', resetId = ''] = fs.readFileSync(file, 'utf8').split('\n');
    return { handoffFile: handoffFile.trim(), resetId: resetId.trim() };
  } catch {
    return null;
  }
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

class Cancelled extends Error {}

const defaultCommandOf = (pid) =>
  new Promise((resolve) => {
    execFile('ps', ['-p', String(pid), '-o', 'args='], { timeout: 3000 }, (error, stdout) =>
      resolve(error ? '' : String(stdout).trim().split(/\s+/)[0])
    );
  });

/** Environment of a process (macOS `ps -E`); null where `ps` fails (Linux, timeout under load) */
const defaultEnvOf = (pid) =>
  new Promise((resolve) => {
    execFile(
      '/bin/ps',
      ['-E', '-ww', '-o', 'command=', '-p', String(pid)],
      { timeout: 3000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => resolve(error ? null : String(stdout))
    );
  });

const TURN_ACTIVE = new Set(['busy', 'waiting']);
const TURN_ACTIVE_DISPLAY = new Set(['working', 'needs-input']);
/** A pane without a row (pi) counts as working while its terminal printed this recently */
const PTY_QUIET_MS = 3000;

/**
 * Does the process have `ORKUMO_PANE_ID=<paneId>`? true: yes; false: its environment was read
 * (it has a PATH) and the variable is not in it; null: unknown (`ps` failed, or hides the
 * environment of the process).
 */
function paneEnvOf(envText, paneId) {
  if (typeof envText !== 'string' || !envText) return null;
  const own = new RegExp(`(?:^|\\s)ORKUMO_PANE_ID=${paneId.replace(/\W/g, '\\$&')}(?:\\s|$)`);
  if (own.test(envText)) return true;
  return /(?:^|\s)PATH=/.test(envText) && !/(?:^|\s)ORKUMO_PANE_ID=/.test(envText) ? false : null;
}

/**
 * `lookupPane(paneId)` for the job service: `{ harness, cwd, sessionId, working, paneEnv }` of the agent behind `paneId`, `{ refusal }` for a session that cannot be reset
 * (the start answers 400 with that text), null when nothing runs there. `paneEnv`: true / false /
 * null (unknown), see `paneEnvOf` (panes started before the env existed lack it). Claude (also its
 * app / remote-control rows) and omp panes come from the agent rows (the row of the pane names
 * harness, cwd and session); any other pane (pi) from its process. A Claude background job is
 * recognised by its job id (its attach pane is `agent-<jobId>-<ts>`) and refused.
 * @param {{ listRows: () => Promise<object[]>, ptySessions: () => object[], commandOf?: (pid: number) => Promise<string>, envOf?: (pid: number) => Promise<string|null>, now?: () => number }} deps
 */
export function createPaneLookup({
  listRows,
  ptySessions,
  commandOf = defaultCommandOf,
  envOf = defaultEnvOf,
  now = Date.now,
}) {
  return async (paneId) => {
    const pty = ptySessions()
      .filter((s) => paneIdOf(s.id) === paneId)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    const rows = await listRows().catch(() => []);
    const job = rows.find((r) => r.kind === 'background' && r.id === paneId);
    if (job) {
      if (!job.pid) {
        return {
          refusal: `Background job ${job.name || job.id} (${job.id}) is not running (${job.displayState || job.state || 'stopped'}): nothing to reset`,
        };
      }
      // A daemon-run session has no pane env (`claude --bg` does not hand its environment on,
      // verified) and so no pane key: its marker would sit under the cwd key, which any session
      // starting in that folder takes. Refused until handoff.py can key it (its env has
      // CLAUDE_JOB_DIR=~/.claude/jobs/<jobId>).
      return {
        refusal: `Background jobs have no pane key yet; the handoff could be taken by another session in ${job.cwd || pty?.cwd}. Open the session in an Orkumo pane, or reset by hand.`,
      };
    }
    if (!pty) {
      const known = rows.find((r) => r.id === paneId);
      return known
        ? {
            refusal: `${known.name || known.id} (${known.id}) was not started in an Orkumo pane: Handoff + Reset needs an agent pane`,
          }
        : null;
    }
    // the server recorded at spawn that it set the env (also in the holder of a restored PTY);
    // `ps` only for a PTY that predates that record
    const paneEnv =
      typeof pty.paneEnvSet === 'boolean'
        ? pty.paneEnvSet
        : pty.pid
          ? paneEnvOf(await envOf(pty.pid), paneId)
          : null;
    const row = rows.find(
      (r) => r.paneId === paneId && (r.kind === 'interactive' || r.kind === 'app')
    );
    if (row) {
      return {
        harness: row.ptyCommand === 'omp' ? 'omp' : 'claude',
        cwd: row.cwd || pty.cwd,
        sessionId: row.sessionId ?? null,
        working: isWorking(row),
        paneEnv,
      };
    }
    const command = pty.pid ? await commandOf(pty.pid) : '';
    return {
      harness: path.basename(command) || 'unknown',
      cwd: pty.cwd,
      sessionId: null,
      working: !!pty.outputAt && now() - pty.outputAt < PTY_QUIET_MS,
      paneEnv,
    };
  };
}

const isWorking = (row) => TURN_ACTIVE.has(row.status) || TURN_ACTIVE_DISPLAY.has(row.displayState);

const defaultLocate = (harness, sessionId) =>
  TRANSCRIPT_READERS[harness]?.locate?.(sessionId, {}) ?? null;

/**
 * Detector for a pane's session switch (`/clear`, `/resume`, omp `/new`). Create it BEFORE the
 * switch, while the pane still runs `sessionId`: the returned `current()` resolves to the session
 * id the agent of that pane writes now (the id itself while nothing changed, null when unknown).
 * Claude reads `~/.claude/sessions/<pid>.json`, omp `~/.omp/agent/terminal-sessions/<tty>`
 * (chatTranscripts `locate`); where the harness has no such registry it falls back to the
 * pane's agent row (`lookupPane(paneId).sessionId`).
 * @returns {() => Promise<string|null>}
 */
export function createSessionTracker({
  harness,
  sessionId,
  paneId,
  lookupPane,
  locate = defaultLocate,
}) {
  const probe = sessionId ? locate(harness, sessionId) : null;
  return async () => {
    const id = probe?.();
    if (typeof id === 'string') return id;
    return (await lookupPane(paneId))?.sessionId ?? null;
  };
}

/**
 * @typedef {'writing'|'resetting'|'continuing'|'done'|'error'} HandoffResetPhase
 * @param {object} deps
 * @param {(paneId: string) => Promise<{harness: string, cwd: string, sessionId: string|null, working: boolean}|null>} deps.lookupPane
 * @param {(paneId: string) => boolean} deps.paneRunning an agent PTY still runs in the pane
 * @param {(paneId: string, text: string) => boolean} deps.type types and submits `text` into the pane
 */
export function createHandoffReset({
  lookupPane,
  paneRunning,
  type,
  pendingDir = defaultPendingDir(),
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeouts = {},
  locate = defaultLocate,
  newResetId = randomUUID,
}) {
  const t = { ...TIMEOUTS, ...timeouts };
  const jobs = new Map(); // paneId -> { job, ctl }
  const starting = new Set();

  const isActive = (entry) => !!entry && ACTIVE.has(entry.job.phase);

  async function run(entry, candidates) {
    const { job, ctl } = entry;
    const { paneId } = job;
    const steps = HARNESS_STEPS[job.harness];
    const alive = () => {
      if (ctl.cancelled) throw new Cancelled();
    };
    const phase = (name) => {
      alive();
      job.phase = name;
      job.updatedAt = now();
    };
    const typeStep = (text) => {
      alive();
      if (!type(paneId, text)) throw new Error('The agent in this pane is gone');
    };
    /** Polls `check` until it returns a truthy value; null at the deadline */
    const until = async (limitMs, check) => {
      const end = now() + limitMs;
      for (;;) {
        alive();
        const value = await check();
        if (value) return value;
        if (!paneRunning(paneId)) throw new Error('The agent in this pane is gone');
        if (now() >= end) return null;
        await sleep(t.pollMs);
      }
    };

    const track = createSessionTracker({
      harness: job.harness,
      sessionId: job.oldSessionId,
      paneId,
      lookupPane,
      locate,
    });

    // Only a marker carrying this job's reset id is this handoff; older ones (any age) never count.
    // Env presence unknown (a legacy PTY `ps` could not read): --key anyway, handoff.py honours it.
    typeStep(
      job.keyMode === 'cwd'
        ? `${steps.skill} --reset-id ${job.resetId}`
        : `${steps.skill} --key ${paneKey(paneId)} --reset-id ${job.resetId}`
    );
    let file = null; // the marker of this job, once it is written
    const marked = await until(t.markerMs, () => {
      for (const candidate of candidates) {
        const marker = readMarker(path.join(pendingDir, candidate.key));
        if (marker?.handoffFile && marker.resetId === job.resetId) {
          file = path.join(pendingDir, candidate.key);
          job.markerKey = candidate.key;
          job.keyMode = candidate.mode;
          return marker.handoffFile;
        }
      }
      return null;
    });
    if (!marked) {
      throw new Error(
        `Timed out after ${Math.round(t.markerMs / 60_000)} min waiting for the handoff (no marker at ${candidates.map((c) => path.join(pendingDir, c.key)).join(' or ')})`
      );
    }
    job.handoffFile = marked;
    job.updatedAt = now();

    // The agent still answers after writing the marker: reset only once its turn has ended
    let quiet = 0;
    const ended = await until(t.turnEndMs, async () => {
      quiet = (await lookupPane(paneId))?.working === false ? quiet + 1 : 0;
      return quiet >= 2;
    });
    if (!ended) {
      throw new Error(
        `The agent did not finish its turn within ${Math.round(t.turnEndMs / 1000)} s after writing the handoff; not resetting`
      );
    }

    phase('resetting');
    typeStep(steps.reset);
    if (steps.observeReset) {
      const next = await until(t.resetMs, async () => {
        const id = await track();
        return id && id !== job.oldSessionId ? id : null;
      });
      if (!next) {
        throw new Error(
          `Reset not observed: the pane still runs session ${job.oldSessionId} ${Math.round(t.resetMs / 1000)} s after ${steps.reset}`
        );
      }
      job.newSessionId = next;
    } else {
      await sleep(t.blindResetMs);
    }
    await sleep(t.afterResetMs);

    phase('continuing');
    typeStep(CONTINUE_TEXT);
    // Taken: the marker is gone (or a later job already wrote its own)
    const taken = await until(t.takeMs, () => {
      const marker = readMarker(file);
      return !marker || marker.resetId !== job.resetId;
    });
    if (!taken) {
      throw new Error(`The new session did not take the handoff (marker still pending: ${file})`);
    }
    phase('done');
  }

  const snapshot = (entry) => ({ ...entry.job });

  return {
    /** Starts a job for the pane; throws errors with `status` (400 unknown pane / harness, 409 active) */
    async start(paneId) {
      if (isActive(jobs.get(paneId)) || starting.has(paneId)) {
        throw httpError(409, 'Handoff + Reset already runs in this pane');
      }
      for (const [id, old] of jobs) {
        if (!isActive(old) && now() - old.job.updatedAt > t.retainMs) jobs.delete(id);
      }
      starting.add(paneId);
      let entry;
      try {
        const pane = await lookupPane(paneId);
        if (!pane) throw httpError(400, `No agent runs in pane ${paneId}`);
        if (pane.refusal) throw httpError(400, pane.refusal);
        const steps = HARNESS_STEPS[pane.harness];
        if (!steps) {
          throw httpError(400, `Handoff + Reset is not supported for ${pane.harness}`);
        }
        if (steps.observeReset && !pane.sessionId) {
          throw httpError(
            400,
            `The session of this ${pane.harness} pane is not known (yet); try again in a moment. Panes that only attach to a background job have none`
          );
        }
        const started = now();
        entry = {
          pane,
          ctl: { cancelled: false },
          job: {
            paneId,
            harness: pane.harness,
            cwd: pane.cwd,
            phase: 'writing',
            startedAt: started,
            updatedAt: started,
            oldSessionId: pane.sessionId,
            newSessionId: null,
            handoffFile: null,
            resetId: newResetId(),
            // Until the marker shows which file it is: the pane key unless the env is known absent
            keyMode: pane.paneEnv === false ? 'cwd' : 'pane',
            markerKey: pane.paneEnv === false ? markerKey(pane.cwd) : paneKey(paneId),
            error: null,
          },
        };
        jobs.set(paneId, entry);
      } finally {
        starting.delete(paneId);
      }
      const { paneEnv, cwd } = entry.pane;
      // `--key` makes handoff.py write the pane marker whatever the env; only a pane known to lack
      // the env is typed without it and marks under the cwd key
      const candidates = [
        paneEnv === false
          ? { key: markerKey(cwd), mode: 'cwd' }
          : { key: paneKey(paneId), mode: 'pane' },
      ];
      run(entry, candidates).catch((error) => {
        if (error instanceof Cancelled || entry.ctl.cancelled) return;
        entry.job.phase = 'error';
        entry.job.error = error.message;
        entry.job.updatedAt = now();
      });
      return snapshot(entry);
    },

    /** Last job of the pane, kept `retainMs` after it ended; null when none */
    get(paneId) {
      const entry = jobs.get(paneId);
      if (!entry) return null;
      if (!isActive(entry) && now() - entry.job.updatedAt > t.retainMs) {
        jobs.delete(paneId);
        return null;
      }
      return snapshot(entry);
    },

    /** Cancels the active job (phase 'error', error 'Cancelled'); 404 when none is active */
    cancel(paneId) {
      const entry = jobs.get(paneId);
      if (!isActive(entry)) throw httpError(404, 'No Handoff + Reset runs in this pane');
      entry.ctl.cancelled = true;
      entry.job.phase = 'error';
      entry.job.error = 'Cancelled';
      entry.job.updatedAt = now();
      return snapshot(entry);
    },
  };
}
