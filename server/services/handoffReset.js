/**
 * Handoff + Reset of an agent pane: the agent writes a handoff file (skill `handoff-reset` of
 * hape-skills), the pane is reset (`/clear`, omp `/new`) and the new session continues from the
 * file. The skill's script `handoff.py mark` puts a marker `~/.claude/handoffs/.pending/<K>`
 * (line 1: the handoff file path, line 2: the reset id the job passed) and the new session's start
 * hook takes (deletes) it: marker with this job's reset id = handoff written, marker gone after the
 * reset = taken. K is the pane key (`orkumo-pane-<paneId>`; every agent pane PTY has env
 * `ORKUMO_PANE_ID`), or, for a pane started before that env existed, the cwd key. This service
 * types the three steps into the pane PTY and watches both signals; one in-memory job per pane.
 *
 * Everything outside (clock, PTY, pane lookup, pending dir) is injected, so tests run with fakes.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
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

/** File name of a pane's marker: `orkumo-pane-` + the pane id, every character outside [A-Za-z0-9] as `-` */
export const paneKey = (paneId) => 'orkumo-pane-' + paneId.replace(/[^A-Za-z0-9]/g, '-');

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

export const paneIdOf = (ptyId) => /^agent-(.+)-\d+$/.exec(ptyId)?.[1] ?? null;

const defaultCommandOf = (pid) =>
  new Promise((resolve) => {
    execFile('ps', ['-p', String(pid), '-o', 'args='], { timeout: 3000 }, (error, stdout) =>
      resolve(error ? '' : String(stdout).trim().split(/\s+/)[0])
    );
  });

/** Environment of a process (macOS `ps -E`; empty where it is not readable) */
const defaultEnvOf = (pid) =>
  new Promise((resolve) => {
    execFile(
      '/bin/ps',
      ['-E', '-ww', '-o', 'command=', '-p', String(pid)],
      { timeout: 3000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => resolve(error ? '' : String(stdout))
    );
  });

const TURN_ACTIVE = new Set(['busy', 'waiting']);
const TURN_ACTIVE_DISPLAY = new Set(['working', 'needs-input']);
/** A pane without a row (pi) counts as working while its terminal printed this recently */
const PTY_QUIET_MS = 3000;

/**
 * `lookupPane(paneId)` for the job service: `{ harness, cwd, sessionId, working, paneEnv }` of the
 * agent in a pane, null when no agent PTY runs there. `paneEnv`: its process has
 * `ORKUMO_PANE_ID=<paneId>` (panes started before that env existed do not; unreadable = false). Claude and omp panes come from the agent rows (the
 * row of the pane names harness, cwd and session); any other pane (pi) from its process.
 * @param {{ listRows: () => Promise<object[]>, ptySessions: () => object[], commandOf?: (pid: number) => Promise<string>, envOf?: (pid: number) => Promise<string>, now?: () => number }} deps
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
    if (!pty) return null;
    const paneEnv = pty.pid
      ? new RegExp(`(?:^|\\s)ORKUMO_PANE_ID=${paneId.replace(/\W/g, '\\$&')}(?:\\s|$)`).test(
          await envOf(pty.pid)
        )
      : false;
    const rows = await listRows().catch(() => []);
    const row = rows.find((r) => r.paneId === paneId && r.kind === 'interactive');
    if (row) {
      return {
        harness: row.ptyCommand === 'omp' ? 'omp' : 'claude',
        cwd: row.cwd || pty.cwd,
        sessionId: row.sessionId ?? null,
        working: TURN_ACTIVE.has(row.status) || TURN_ACTIVE_DISPLAY.has(row.displayState),
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

  async function run(entry, file) {
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

    // Only a marker carrying this job's reset id is this handoff; older ones (any age) never count
    typeStep(
      job.keyMode === 'pane'
        ? `${steps.skill} --key ${job.markerKey} --reset-id ${job.resetId}`
        : `${steps.skill} --reset-id ${job.resetId}`
    );
    const marked = await until(t.markerMs, () => {
      const marker = readMarker(file);
      return marker?.handoffFile && marker.resetId === job.resetId ? marker.handoffFile : null;
    });
    if (!marked) {
      throw new Error(
        `Timed out after ${Math.round(t.markerMs / 60_000)} min waiting for the handoff (no marker at ${file})`
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
      starting.add(paneId);
      let entry;
      try {
        const pane = await lookupPane(paneId);
        if (!pane) throw httpError(400, `No agent runs in pane ${paneId}`);
        const steps = HARNESS_STEPS[pane.harness];
        if (!steps) {
          throw httpError(400, `Handoff + Reset is not supported for ${pane.harness}`);
        }
        if (steps.observeReset && !pane.sessionId) {
          throw httpError(400, 'The session of this pane is not known yet; try again in a moment');
        }
        const started = now();
        entry = {
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
            keyMode: pane.paneEnv ? 'pane' : 'cwd',
            markerKey: pane.paneEnv ? paneKey(paneId) : markerKey(pane.cwd),
            error: null,
          },
        };
        jobs.set(paneId, entry);
      } finally {
        starting.delete(paneId);
      }
      const file = path.join(pendingDir, entry.job.markerKey);
      run(entry, file).catch((error) => {
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
