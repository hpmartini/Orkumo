import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// node-pty is a native module - keep it out of the unit test
vi.mock('node-pty', () => ({ spawn: vi.fn() }));

const {
  createHandoffReset,
  createPaneLookup,
  createSessionTracker,
  markerKey,
  paneKey,
  HARNESS_STEPS,
} = await import('../server/services/handoffReset.js');
const { TRANSCRIPT_READERS } = await import('../server/services/chatTranscripts.js');

const PANE = 'work-1234';
const OLD = '11111111-1111-4111-8111-111111111111';
const NEW = '22222222-2222-4222-8222-222222222222';

let root;
let pendingDir;
let cwd;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-reset-')));
  pendingDir = path.join(root, 'pending');
  fs.mkdirSync(pendingDir);
  cwd = path.join(root, 'proj');
  fs.mkdirSync(cwd);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/**
 * A pane with a scripted agent on a fake clock: `sleep` advances the clock and fires the events
 * the typed commands scheduled (marker written, session switched, marker taken).
 */
function makeWorld({ harness = 'claude', timeouts = {}, react = {}, paneEnv = true } = {}) {
  const world = {
    clock: 1_000_000,
    typed: [],
    phases: [],
    events: [],
    sessionId: OLD,
    working: false,
    running: true,
    svc: null,
    resetIds: [],
  };
  const marker = path.join(pendingDir, paneEnv ? paneKey(PANE) : markerKey(cwd));
  world.marker = marker;
  // what the typed skill command carries, as handoff.py mark would read it
  world.args = () => {
    const skill = world.typed[0] ?? '';
    return {
      key: /--key (\S+)/.exec(skill)?.[1] ?? null,
      resetId: /--reset-id (\S+)/.exec(skill)?.[1] ?? '',
    };
  };
  world.writeMarker = (
    file = marker,
    resetId = world.args().resetId,
    handoff = `${root}/handoff.md`
  ) => fs.writeFileSync(file, `${handoff}\n${resetId}\n`);
  const at = (delayMs, fn) => world.events.push({ at: world.clock + delayMs, fn });
  const behave = {
    skill: () => at(5000, () => world.writeMarker()),
    reset: () => at(2000, () => (world.sessionId = NEW)),
    weiter: () => at(3000, () => fs.rmSync(marker, { force: true })),
    ...react,
  };
  const steps = HARNESS_STEPS[harness];
  world.type = (paneId, text) => {
    world.typed.push(text);
    if (text.startsWith(`${steps.skill} `)) behave.skill(world);
    else if (text === steps.reset) behave.reset(world);
    else if (text === 'weiter') behave.weiter(world);
    return world.running;
  };
  world.sleep = async (ms) => {
    world.clock += ms;
    for (const event of world.events.filter((e) => e.at <= world.clock)) event.fn();
    world.events = world.events.filter((e) => e.at > world.clock);
    const phase = world.svc.get(PANE)?.phase;
    if (phase && world.phases.at(-1) !== phase) world.phases.push(phase);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  world.svc = createHandoffReset({
    lookupPane: async () => ({
      harness,
      cwd,
      sessionId: world.sessionId,
      working: world.working,
      paneEnv,
    }),
    paneRunning: () => world.running,
    type: world.type,
    newResetId: () => {
      world.resetIds.push(`reset-${world.resetIds.length + 1}`);
      return world.resetIds.at(-1);
    },
    pendingDir,
    now: () => world.clock,
    sleep: world.sleep,
    // the tracker reads the world's session like chatTranscripts' locate would
    locate: () => () => world.sessionId,
    timeouts: { markerMs: 60_000, turnEndMs: 20_000, resetMs: 10_000, takeMs: 10_000, ...timeouts },
  });
  return world;
}

const finished = async (world) => {
  await vi.waitFor(() => expect(['done', 'error']).toContain(world.svc.get(PANE).phase), {
    timeout: 5000,
  });
  // `sleep` samples the phase; the last one is set after the last sleep
  if (world.phases.at(-1) !== world.svc.get(PANE).phase)
    world.phases.push(world.svc.get(PANE).phase);
};

describe('Handoff + Reset job', () => {
  for (const harness of ['claude', 'omp']) {
    it(`${harness}: types skill, reset, weiter in order and walks the phases`, async () => {
      const world = makeWorld({ harness });
      const job = await world.svc.start(PANE);
      expect(job).toMatchObject({
        paneId: PANE,
        harness,
        cwd,
        phase: 'writing',
        oldSessionId: OLD,
        error: null,
      });
      await finished(world);
      const done = world.svc.get(PANE);
      expect(done.phase).toBe('done');
      expect(done.error).toBeNull();
      expect(done.handoffFile).toBe(`${root}/handoff.md`);
      expect(done.newSessionId).toBe(NEW);
      expect(done).toMatchObject({
        resetId: 'reset-1',
        markerKey: paneKey(PANE),
        keyMode: 'pane',
      });
      expect(world.typed).toEqual([
        `${harness === 'claude' ? '/hape-skills:handoff-reset' : '/skill:handoff-reset'} --key ${paneKey(PANE)} --reset-id reset-1`,
        harness === 'claude' ? '/clear' : '/new',
        'weiter',
      ]);
      expect(world.phases).toEqual(['writing', 'resetting', 'continuing', 'done']);
    });
  }

  it('pi: reset is not observable, it waits and continues', async () => {
    const world = makeWorld({ harness: 'pi' });
    world.svc = createHandoffReset({
      lookupPane: async () => ({
        harness: 'pi',
        cwd,
        sessionId: null,
        working: false,
        paneEnv: true,
      }),
      paneRunning: () => true,
      type: world.type,
      newResetId: () => 'reset-1',
      pendingDir,
      now: () => world.clock,
      sleep: world.sleep,
      timeouts: { markerMs: 60_000, takeMs: 10_000 },
    });
    await world.svc.start(PANE);
    await finished(world);
    expect(world.svc.get(PANE)).toMatchObject({ phase: 'done', newSessionId: null });
    expect(world.typed).toEqual([
      `/skill:handoff-reset --key ${paneKey(PANE)} --reset-id reset-1`,
      '/new',
      'weiter',
    ]);
  });

  it('ignores markers of an older job and of other panes: only the own reset id counts', async () => {
    const world = makeWorld();
    const otherPane = path.join(pendingDir, paneKey('orch-other'));
    fs.writeFileSync(otherPane, `${root}/other-handoff.md\nsomeone-elses-reset\n`);
    // same key, old reset id (e.g. a handoff of an earlier job, even a fresh one) and no id at all
    fs.writeFileSync(world.marker, '/stale/handoff.md\nold-reset\n');
    world.events.push({
      at: world.clock + 2000,
      fn: () => fs.writeFileSync(world.marker, '/stale/other.md\nanother-reset\n'),
    });
    world.events.push({
      at: world.clock + 3000,
      fn: () => fs.writeFileSync(world.marker, '/stale/no-id.md\n'),
    });
    await world.svc.start(PANE);
    await finished(world);
    const done = world.svc.get(PANE);
    expect(done.phase).toBe('done');
    expect(done.handoffFile).toBe(`${root}/handoff.md`);
    expect(world.typed).toHaveLength(3);
    // the other pane's marker was never touched
    expect(fs.readFileSync(otherPane, 'utf8')).toBe(
      `${root}/other-handoff.md\nsomeone-elses-reset\n`
    );
  });

  it("a marker that never gets this job's reset id times out", async () => {
    const world = makeWorld({
      react: {
        skill: (w) =>
          w.events.push({ at: w.clock + 2000, fn: () => w.writeMarker(undefined, 'old-reset') }),
      },
      timeouts: { markerMs: 10_000 },
    });
    await world.svc.start(PANE);
    await finished(world);
    expect(world.svc.get(PANE).error).toMatch(/Timed out/);
    expect(world.typed).toHaveLength(1);
  });

  it('two panes in one cwd: the clicked pane completes with its own reset id', async () => {
    const other = 'orch-other';
    const world = makeWorld();
    // the other pane (same cwd) had a handoff written for its own job meanwhile
    const otherFile = path.join(pendingDir, paneKey(other));
    fs.writeFileSync(otherFile, `${root}/other.md\nreset-of-other-pane\n`);
    await world.svc.start(PANE);
    await finished(world);
    expect(world.svc.get(PANE)).toMatchObject({ phase: 'done', handoffFile: `${root}/handoff.md` });
    expect(fs.existsSync(otherFile)).toBe(true);
    expect(fs.existsSync(world.marker)).toBe(false);
  });

  it('a marker with another reset id after the reset counts as taken', async () => {
    const world = makeWorld({
      react: {
        weiter: (w) =>
          w.events.push({ at: w.clock + 2000, fn: () => w.writeMarker(undefined, 'next-job') }),
      },
    });
    await world.svc.start(PANE);
    await finished(world);
    expect(world.svc.get(PANE).phase).toBe('done');
  });

  it('cwd key mode when the pane has no ORKUMO_PANE_ID: only --reset-id, marker under the cwd key', async () => {
    const world = makeWorld({ paneEnv: false });
    await world.svc.start(PANE);
    await finished(world);
    const done = world.svc.get(PANE);
    expect(done).toMatchObject({
      phase: 'done',
      keyMode: 'cwd',
      markerKey: markerKey(cwd),
      resetId: 'reset-1',
    });
    expect(world.marker).toBe(path.join(pendingDir, markerKey(cwd)));
    expect(world.typed[0]).toBe('/hape-skills:handoff-reset --reset-id reset-1');
    expect(world.typed[0]).not.toContain('--key');
  });

  it('every job gets a fresh reset id', async () => {
    const world = makeWorld();
    await world.svc.start(PANE);
    await finished(world);
    world.typed.length = 0;
    await world.svc.start(PANE);
    await finished(world);
    expect(world.svc.get(PANE).resetId).toBe('reset-2');
    expect(world.typed[0]).toContain('--reset-id reset-2');
  });

  it('waits for the agent turn to end before typing the reset', async () => {
    const world = makeWorld({ timeouts: { turnEndMs: 60_000 } });
    world.working = true;
    world.events.push({ at: world.clock + 30_000, fn: () => (world.working = false) });
    await world.svc.start(PANE);
    await finished(world);
    expect(world.svc.get(PANE).phase).toBe('done');
    expect(world.typed[1]).toBe('/clear');
    expect(world.clock).toBeGreaterThanOrEqual(1_030_000);
  });

  it('errors when the turn does not end', async () => {
    const world = makeWorld();
    world.working = true;
    await world.svc.start(PANE);
    await finished(world);
    expect(world.svc.get(PANE)).toMatchObject({ phase: 'error' });
    expect(world.svc.get(PANE).error).toMatch(/did not finish its turn/);
    expect(world.typed).toEqual([
      `/hape-skills:handoff-reset --key ${paneKey(PANE)} --reset-id reset-1`,
    ]);
  });

  it('errors when no marker appears', async () => {
    const world = makeWorld({ react: { skill: () => {} }, timeouts: { markerMs: 10_000 } });
    await world.svc.start(PANE);
    await finished(world);
    const job = world.svc.get(PANE);
    expect(job.phase).toBe('error');
    expect(job.error).toMatch(/Timed out .*waiting for the handoff/);
    expect(world.typed).toEqual([
      `/hape-skills:handoff-reset --key ${paneKey(PANE)} --reset-id reset-1`,
    ]);
  });

  it('errors when the reset is not observed', async () => {
    const world = makeWorld({ react: { reset: () => {} } });
    await world.svc.start(PANE);
    await finished(world);
    const job = world.svc.get(PANE);
    expect(job.phase).toBe('error');
    expect(job.error).toMatch(/Reset not observed/);
    expect(world.typed).toEqual([
      `/hape-skills:handoff-reset --key ${paneKey(PANE)} --reset-id reset-1`,
      '/clear',
    ]);
  });

  it('errors when the new session does not take the marker', async () => {
    const world = makeWorld({ react: { weiter: () => {} } });
    await world.svc.start(PANE);
    await finished(world);
    const job = world.svc.get(PANE);
    expect(job.phase).toBe('error');
    expect(job.error).toBe(
      `The new session did not take the handoff (marker still pending: ${world.marker})`
    );
    expect(world.typed.at(-1)).toBe('weiter');
  });

  it('errors when the pane vanishes', async () => {
    const world = makeWorld({
      react: {
        skill: (w) => w.events.push({ at: w.clock + 2000, fn: () => (w.running = false) }),
      },
    });
    await world.svc.start(PANE);
    await finished(world);
    expect(world.svc.get(PANE)).toMatchObject({
      phase: 'error',
      error: 'The agent in this pane is gone',
    });
  });

  it('cancel ends the job with "Cancelled" and types nothing more', async () => {
    const world = makeWorld({ react: { skill: () => {} } });
    let cancelled;
    world.events.push({ at: world.clock + 3000, fn: () => (cancelled = world.svc.cancel(PANE)) });
    await world.svc.start(PANE);
    await vi.waitFor(() => expect(cancelled).toBeDefined());
    expect(cancelled).toMatchObject({ phase: 'error', error: 'Cancelled' });
    const typed = [...world.typed];
    world.writeMarker();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(world.svc.get(PANE)).toMatchObject({ phase: 'error', error: 'Cancelled' });
    expect(world.typed).toEqual(typed);
    expect(() => world.svc.cancel(PANE)).toThrow(/No Handoff \+ Reset runs/);
  });

  it('409 for a second start while a job is active, a new one is possible afterwards', async () => {
    const world = makeWorld();
    await world.svc.start(PANE);
    await expect(world.svc.start(PANE)).rejects.toMatchObject({ status: 409 });
    await finished(world);
    fs.rmSync(world.marker, { force: true });
    await expect(world.svc.start(PANE)).resolves.toMatchObject({ phase: 'writing' });
    await finished(world);
  });

  it('two starts at once: exactly one wins', async () => {
    const world = makeWorld();
    const results = await Promise.allSettled([world.svc.start(PANE), world.svc.start(PANE)]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(results.find((r) => r.status === 'rejected').reason.status).toBe(409);
    await finished(world);
  });

  it('400 for an unsupported harness and for an unknown pane', async () => {
    const make = (pane) =>
      createHandoffReset({
        lookupPane: async () => pane,
        paneRunning: () => true,
        type: () => true,
        pendingDir,
      });
    await expect(
      make({ harness: 'codex', cwd, sessionId: null }).start(PANE)
    ).rejects.toMatchObject({ status: 400, message: 'Handoff + Reset is not supported for codex' });
    await expect(make(null).start(PANE)).rejects.toMatchObject({ status: 400 });
    await expect(
      make({ harness: 'claude', cwd, sessionId: null }).start(PANE)
    ).rejects.toMatchObject({ status: 400 });
  });

  it('keeps the last job for 10 minutes after it ended', async () => {
    const world = makeWorld();
    expect(world.svc.get(PANE)).toBeNull();
    await world.svc.start(PANE);
    await finished(world);
    world.clock += 9 * 60_000;
    expect(world.svc.get(PANE)?.phase).toBe('done');
    world.clock += 2 * 60_000;
    expect(world.svc.get(PANE)).toBeNull();
  });
});

describe('paneKey', () => {
  it('prefixes the pane id and keeps only [A-Za-z0-9-]', () => {
    expect(paneKey('orch-3f2a')).toBe('orkumo-pane-orch-3f2a');
    expect(paneKey('work-1234')).toBe('orkumo-pane-work-1234');
    for (const id of ['a.b:c', 'x_y', 'ä ö/..', '--a--', 'q'.repeat(200)]) {
      expect(paneKey(id)).toMatch(/^orkumo-pane-[A-Za-z0-9-]*$/);
    }
    expect(paneKey('a.b:c')).toBe('orkumo-pane-a-b-c');
    expect(paneKey('x__y')).toBe('orkumo-pane-x--y');
    expect(paneKey('äö/..')).toBe('orkumo-pane------');
    expect(paneKey('..a..')).toBe('orkumo-pane---a--');
  });
});

describe('marker key parity with handoff.py', () => {
  const HANDOFF_PY = path.join(
    os.homedir(),
    'PROJECTS/hape-skills/plugins/hape-skills/skills/handoff-reset/scripts/handoff.py'
  );

  it.skipIf(!fs.existsSync(HANDOFF_PY))('matches schluessel() for awkward paths', () => {
    const real = path.join(root, 'Mein Projekt v2.0');
    const umlauts = path.join(root, 'Büro Äpfel_ö ß', 'x.y');
    const emoji = path.join(root, 'proj 🚀 2');
    for (const dir of [real, umlauts, emoji]) fs.mkdirSync(dir, { recursive: true });
    const link = path.join(root, 'link-to-projekt');
    fs.symlinkSync(real, link);
    const missing = path.join(root, 'does', 'not exist', '..', 'x');
    const paths = [
      real,
      `${real}/`,
      umlauts,
      emoji,
      link,
      `${link}/`,
      path.join(link, 'sub dir'),
      missing,
      cwd,
      '/',
      '/tmp',
      os.homedir(),
      path.join(root, 'a--b', '.hidden', '__x__'),
    ];
    const py = spawnSync(
      'python3',
      [
        '-c',
        [
          'import importlib.util, json, sys',
          `spec = importlib.util.spec_from_file_location("handoff", ${JSON.stringify(HANDOFF_PY)})`,
          'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
          'print(json.dumps([m.schluessel(p) for p in json.load(sys.stdin)]))',
        ].join('\n'),
      ],
      { input: JSON.stringify(paths), encoding: 'utf8' }
    );
    expect(py.status, py.stderr).toBe(0);
    const expected = JSON.parse(py.stdout);
    expect(paths.map(markerKey)).toEqual(expected);
    expect(markerKey('/')).toBe('root');
    expect(markerKey(`${link}/`)).toBe(markerKey(real));
  });
});

describe('createPaneLookup', () => {
  const pty = (id, extra = {}) => ({
    id,
    cwd: '/w',
    pid: 42,
    createdAt: 1,
    outputAt: null,
    ...extra,
  });

  it('takes harness, cwd, session and working from the pane row', async () => {
    const rows = [
      { paneId: 'other', kind: 'interactive', sessionId: 'x' },
      { paneId: PANE, kind: 'interactive', cwd: '/row', sessionId: OLD, status: 'busy' },
    ];
    const lookup = createPaneLookup({
      listRows: async () => rows,
      ptySessions: () => [pty(`agent-${PANE}-1700000000000`)],
      envOf: async () => `claude --foo HOME=/h ORKUMO_PANE_ID=${PANE} PATH=/bin`,
    });
    expect(await lookup(PANE)).toEqual({
      harness: 'claude',
      cwd: '/row',
      sessionId: OLD,
      working: true,
      paneEnv: true,
    });
    rows[1] = {
      paneId: PANE,
      kind: 'interactive',
      ptyCommand: 'omp',
      sessionId: NEW,
      status: 'idle',
      displayState: 'idle',
      cwd: '/o',
    };
    expect(await lookup(PANE)).toMatchObject({ harness: 'omp', sessionId: NEW, working: false });
    rows[1].displayState = 'needs-input';
    expect((await lookup(PANE)).working).toBe(true);
  });

  it("paneEnv only for the pane's own ORKUMO_PANE_ID", async () => {
    let env = '';
    const lookup = createPaneLookup({
      listRows: async () => [{ paneId: PANE, kind: 'interactive', sessionId: OLD }],
      ptySessions: () => [pty(`agent-${PANE}-1`)],
      envOf: async () => env,
    });
    expect((await lookup(PANE)).paneEnv).toBe(false);
    env = `x X_ORKUMO_PANE_ID=${PANE} y`;
    expect((await lookup(PANE)).paneEnv).toBe(false);
    env = `x ORKUMO_PANE_ID=other y`;
    expect((await lookup(PANE)).paneEnv).toBe(false);
    env = `x ORKUMO_PANE_ID=${PANE}`;
    expect((await lookup(PANE)).paneEnv).toBe(true);
  });

  it('falls back to the pane process (pi) and its terminal activity', async () => {
    let now = 10_000;
    const sessions = [pty(`agent-${PANE}-1`, { outputAt: 9_000 })];
    const lookup = createPaneLookup({
      listRows: async () => [],
      ptySessions: () => sessions,
      commandOf: async (pid) => (pid === 42 ? '/opt/bin/pi' : ''),
      envOf: async () => 'pi HOME=/h',
      now: () => now,
    });
    expect(await lookup(PANE)).toEqual({
      harness: 'pi',
      cwd: '/w',
      sessionId: null,
      working: true,
      paneEnv: false,
    });
    now = 20_000;
    expect((await lookup(PANE)).working).toBe(false);
  });

  it('null when no agent PTY runs in the pane', async () => {
    const lookup = createPaneLookup({
      listRows: async () => [{ paneId: PANE, kind: 'interactive', sessionId: OLD }],
      ptySessions: () => [pty('agent-other-1')],
    });
    expect(await lookup(PANE)).toBeNull();
  });
});

describe('createSessionTracker', () => {
  it('claude: follows ~/.claude/sessions/<pid>.json after /clear', async () => {
    const dir = path.join(root, 'claude-sessions');
    fs.mkdirSync(dir);
    const file = path.join(dir, '4242.json');
    fs.writeFileSync(file, JSON.stringify({ sessionId: OLD, procStart: 'p1' }));
    const track = createSessionTracker({
      harness: 'claude',
      sessionId: OLD,
      paneId: PANE,
      lookupPane: async () => null,
      locate: (h, id) => TRANSCRIPT_READERS[h].locate(id, { claudeSessionsDir: dir }),
    });
    expect(await track()).toBe(OLD);
    fs.writeFileSync(file, JSON.stringify({ sessionId: NEW, procStart: 'p1' }));
    expect(await track()).toBe(NEW);
  });

  it('omp: follows terminal-sessions/<tty> after /new', async () => {
    const dir = path.join(root, 'terminals');
    fs.mkdirSync(dir);
    const file = path.join(dir, 'ttys007');
    const sessionFile = (id) => `/x/sessions/-proj-/2026-11-26T10-00-00-000Z_${id}.jsonl`;
    fs.writeFileSync(file, `/proj\n${sessionFile(OLD)}\n`);
    const track = createSessionTracker({
      harness: 'omp',
      sessionId: OLD,
      paneId: PANE,
      lookupPane: async () => null,
      locate: (h, id) => TRANSCRIPT_READERS[h].locate(id, { ompTerminalsDir: dir }),
    });
    expect(await track()).toBe(OLD);
    fs.writeFileSync(file, `/proj\n${sessionFile(NEW)}\n`);
    expect(await track()).toBe(NEW);
  });

  it('falls back to the pane row where the harness has no registry', async () => {
    let id = OLD;
    const track = createSessionTracker({
      harness: 'omp',
      sessionId: OLD,
      paneId: PANE,
      lookupPane: async () => ({ sessionId: id }),
      locate: () => null,
    });
    expect(await track()).toBe(OLD);
    id = NEW;
    expect(await track()).toBe(NEW);
  });
});
