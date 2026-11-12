/**
 * Event-driven refresh of the agents list: file watches on the stores the session state lives in
 * trigger `claude agents --json` instead of a fixed poll (each call starts the claude binary, which
 * itself spawns `ps` and `security`).
 *
 *   ~/.claude/jobs/<id>/state.json, order, pins.json   background jobs (state, detail, name, PRs)
 *   ~/.claude/sessions/<pid>.json                       running sessions (busy / idle, waitingFor)
 *   ~/.omp/agent/sessions/<cwd>/<id>.jsonl              Oh My Pi sessions (written on every message)
 *   ~/.omp/agent/terminal-sessions/<tty>                which omp session a terminal runs
 *
 * Transcripts under ~/.claude/projects are not watched: nothing in the list comes from them that the
 * files above do not also change, and every running agent appends to them constantly.
 */
import fs from 'fs';
import path from 'path';

/**
 * Whether a change reported by `fs.watch` for a watched store can change the agents list.
 * `filename` is relative to the watched directory; null (the platform did not say) counts.
 * @param {'jobs'|'sessions'|'omp'|'ompTerminals'} kind
 * @param {string|null|undefined} filename
 * @returns {boolean}
 */
export function isRelevantChange(kind, filename) {
  if (!filename) return true;
  const parts = String(filename).split(/[\\/]/).filter(Boolean);
  switch (kind) {
    case 'jobs':
      // the job folder itself (created / removed), pins.json (also its atomic-write rename), and per
      // job state.json + order; not timeline.jsonl or the agent's scratch files under tmp/
      if (parts.length === 1) return parts[0].startsWith('pins.json') || !parts[0].includes('.');
      return parts.length === 2 && (parts[1].startsWith('state.json') || parts[1] === 'order');
    case 'sessions':
      return parts.length === 1 && /^\d+\.json/.test(parts[0]);
    case 'omp':
      // <cwd folder>/<session>.jsonl; artifact folders below a session are not the session
      return parts.length === 1 || (parts.length === 2 && parts[1].endsWith('.jsonl'));
    case 'ompTerminals':
      return true;
    default:
      return false;
  }
}

/**
 * Runs `run` on demand, debounced and rate-limited, plus a slow reconcile for anything the
 * triggers missed (a crashed process leaves no file change behind).
 *
 * - `notify()`: a change happened; runs after `debounceMs`, but never sooner than `minGapMs` after
 *   the previous run started. Further changes before that run join it (no starvation by a session
 *   that writes continuously).
 * - `notifyAfter(ms)`: one trailing run `ms` after the last call (state that turns over by time,
 *   like an omp session that counts as busy for a while after its last write).
 * - `refreshSoon()`: after a mutating command; runs within `soonMs` regardless of `minGapMs`.
 * - A run requested while one is in flight runs once more after it.
 * - Every run re-arms the reconcile timer (`reconcileMs`).
 *
 * @param {{ run: () => Promise<void> | void, debounceMs?: number, minGapMs?: number,
 *   reconcileMs?: number, soonMs?: number }} options
 */
export function createRefreshScheduler({
  run,
  debounceMs = 300,
  minGapMs = 2500,
  reconcileMs = 60_000,
  soonMs = 400,
}) {
  let active = false;
  let timer = null;
  let dueAt = Infinity;
  let reconcileTimer = null;
  let settleTimer = null;
  let running = false;
  let again = false;
  let againSoon = false;
  let lastRunAt = -Infinity;

  const clearAll = () => {
    clearTimeout(timer);
    clearTimeout(reconcileTimer);
    clearTimeout(settleTimer);
    timer = reconcileTimer = settleTimer = null;
    dueAt = Infinity;
  };

  /** Arm the run timer for `delay` from now, unless one is already due sooner */
  const arm = (delay) => {
    if (!active) return;
    const due = Date.now() + Math.max(0, delay);
    if (timer && dueAt <= due) return;
    clearTimeout(timer);
    dueAt = due;
    timer = setTimeout(fire, due - Date.now());
  };

  const fire = async () => {
    timer = null;
    dueAt = Infinity;
    if (!active) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    lastRunAt = Date.now();
    clearTimeout(reconcileTimer);
    reconcileTimer = null;
    try {
      await run();
    } catch {
      // run reports its own errors
    } finally {
      running = false;
      if (active) {
        reconcileTimer = setTimeout(() => {
          reconcileTimer = null;
          arm(0);
        }, reconcileMs);
        if (againSoon) arm(soonMs);
        else if (again) notify();
      }
      again = againSoon = false;
    }
  };

  const notify = () => arm(Math.max(debounceMs, lastRunAt + minGapMs - Date.now()));

  return {
    /** Start and run once right away (initial snapshot) */
    start() {
      if (active) return;
      active = true;
      arm(0);
    },
    stop() {
      active = false;
      again = againSoon = false;
      clearAll();
    },
    notify,
    notifyAfter(ms) {
      if (!active) return;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        notify();
      }, ms);
    },
    refreshSoon() {
      if (running) againSoon = true;
      else arm(soonMs);
    },
  };
}

/**
 * One `fs.watch` per store (recursive where the store nests). A store that does not exist yet or
 * whose watch failed is retried by `ensure()`, which the caller runs on every refresh.
 * @param {{ kind: string, dir: string, recursive: boolean }[]} sources
 * @param {(kind: string, filename: string|null) => void} onChange relevant changes only
 * @param {{ watch?: typeof fs.watch, exists?: (dir: string) => boolean }} [deps]
 */
export function watchSources(sources, onChange, deps = {}) {
  const watch = deps.watch ?? fs.watch;
  const exists = deps.exists ?? ((dir) => fs.existsSync(dir));
  const watchers = new Map();

  const ensure = () => {
    for (const source of sources) {
      if (watchers.has(source.dir) || !exists(source.dir)) continue;
      try {
        const watcher = watch(source.dir, { recursive: source.recursive }, (_event, filename) => {
          const name = filename == null ? null : String(filename);
          if (isRelevantChange(source.kind, name)) onChange(source.kind, name);
        });
        watcher.on('error', () => {
          watcher.close();
          watchers.delete(source.dir);
        });
        watchers.set(source.dir, watcher);
      } catch {
        // unsupported here (e.g. a container without the host's dirs): the reconcile covers it
      }
    }
  };

  ensure();
  return {
    ensure,
    close() {
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
    /** Watched directories (tests, diagnostics) */
    get dirs() {
      return [...watchers.keys()];
    },
  };
}

/** The stores the agents list is read from (see the module comment) */
export function agentWatchSources({ claudeHome, ompAgentDir }) {
  return [
    { kind: 'jobs', dir: path.join(claudeHome, 'jobs'), recursive: true },
    { kind: 'sessions', dir: path.join(claudeHome, 'sessions'), recursive: false },
    { kind: 'omp', dir: path.join(ompAgentDir, 'sessions'), recursive: true },
    { kind: 'ompTerminals', dir: path.join(ompAgentDir, 'terminal-sessions'), recursive: false },
  ];
}
