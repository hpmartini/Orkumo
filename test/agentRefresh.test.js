import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import {
  isRelevantChange,
  createRefreshScheduler,
  watchSources,
  agentWatchSources,
} from '../server/services/agentRefresh.js';

describe('agentRefresh - isRelevantChange', () => {
  it('jobs: state.json, order, pins.json and job folders count; scratch files do not', () => {
    expect(isRelevantChange('jobs', '0046b592/state.json')).toBe(true);
    expect(isRelevantChange('jobs', '0046b592/state.json.tmp-123')).toBe(true);
    expect(isRelevantChange('jobs', '0046b592/order')).toBe(true);
    expect(isRelevantChange('jobs', 'pins.json')).toBe(true);
    expect(isRelevantChange('jobs', 'pins.json.4711.1700000000000.tmp')).toBe(true);
    expect(isRelevantChange('jobs', '0046b592')).toBe(true);
    expect(isRelevantChange('jobs', '0046b592/timeline.jsonl')).toBe(false);
    expect(isRelevantChange('jobs', '0046b592/tmp')).toBe(false);
    expect(isRelevantChange('jobs', '0046b592/tmp/node_modules/x/state.json')).toBe(false);
    expect(isRelevantChange('jobs', '.DS_Store')).toBe(false);
  });

  it('sessions: only <pid>.json', () => {
    expect(isRelevantChange('sessions', '52829.json')).toBe(true);
    expect(isRelevantChange('sessions', '52829.395734d2.key')).toBe(false);
    expect(isRelevantChange('sessions', 'notes.txt')).toBe(false);
  });

  it('omp: session files and cwd folders, not artifacts below a session', () => {
    expect(isRelevantChange('omp', '-Users-hape-x/2026_abc.jsonl')).toBe(true);
    expect(isRelevantChange('omp', '-Users-hape-x')).toBe(true);
    expect(isRelevantChange('omp', '-Users-hape-x/2026_abc/artifact.txt')).toBe(false);
    expect(isRelevantChange('ompTerminals', 'ttys002')).toBe(true);
  });

  it('a change without a filename counts (the platform did not say which)', () => {
    expect(isRelevantChange('jobs', null)).toBe(true);
    expect(isRelevantChange('sessions', undefined)).toBe(true);
  });

  it('agentWatchSources: jobs and omp sessions recursive, the flat stores not', () => {
    const sources = agentWatchSources({ claudeHome: '/h/.claude', ompAgentDir: '/h/.omp/agent' });
    expect(sources).toEqual([
      { kind: 'jobs', dir: '/h/.claude/jobs', recursive: true },
      { kind: 'sessions', dir: '/h/.claude/sessions', recursive: false },
      { kind: 'omp', dir: '/h/.omp/agent/sessions', recursive: true },
      { kind: 'ompTerminals', dir: '/h/.omp/agent/terminal-sessions', recursive: false },
    ]);
  });
});

describe('agentRefresh - createRefreshScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (options = {}) => {
    const run = vi.fn(async () => {});
    const scheduler = createRefreshScheduler({
      run,
      debounceMs: 300,
      minGapMs: 3000,
      reconcileMs: 60_000,
      soonMs: 400,
      ...options,
    });
    return { run, scheduler };
  };

  it('runs once on start, then nothing without changes until the reconcile', async () => {
    const { run, scheduler } = setup();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_010);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('a change runs after the debounce; a burst of changes is one run', async () => {
    const { run, scheduler } = setup();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(5_000);
    run.mockClear();
    for (let i = 0; i < 50; i++) scheduler.notify();
    await vi.advanceTimersByTimeAsync(299);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('continuous changes run at most once per minGap and are not starved', async () => {
    const { run, scheduler } = setup();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    run.mockClear();
    // a session writing every 100 ms for 10 s
    for (let t = 0; t < 10_000; t += 100) {
      scheduler.notify();
      await vi.advanceTimersByTimeAsync(100);
    }
    // runs at 3 s, 6 s, 9 s (each minGap after the previous start)
    expect(run).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });

  it('refreshSoon ignores minGap (after a mutating command)', async () => {
    const { run, scheduler } = setup();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    run.mockClear();
    scheduler.refreshSoon();
    await vi.advanceTimersByTimeAsync(400);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('a change during a run runs once more afterwards', async () => {
    let release;
    const run = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const scheduler = createRefreshScheduler({ run, debounceMs: 300, minGapMs: 3000 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.notify();
    await vi.advanceTimersByTimeAsync(5_000); // timer fires while the run is still in flight
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(2);
    release();
    scheduler.stop();
  });

  it('notifyAfter: one trailing run after the last call', async () => {
    const { run, scheduler } = setup();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(5_000);
    run.mockClear();
    scheduler.notifyAfter(16_000);
    await vi.advanceTimersByTimeAsync(10_000);
    scheduler.notifyAfter(16_000); // re-armed
    await vi.advanceTimersByTimeAsync(15_999 + 300);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('stop cancels pending runs and the reconcile; changes after stop do nothing', async () => {
    const { run, scheduler } = setup();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.notify();
    scheduler.notifyAfter(1_000);
    scheduler.stop();
    scheduler.notify();
    scheduler.refreshSoon();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('a failing run keeps the scheduler going', async () => {
    const run = vi.fn(async () => {
      throw new Error('claude missing');
    });
    const scheduler = createRefreshScheduler({ run, reconcileMs: 1_000 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(2_500);
    expect(run).toHaveBeenCalledTimes(3); // start, reconcile at 1 s and 2 s
    scheduler.stop();
  });
});

describe('agentRefresh - watchSources', () => {
  const fakeWatch = () => {
    const watchers = [];
    const watch = vi.fn((dir, options, listener) => {
      const watcher = Object.assign(new EventEmitter(), { dir, options, listener, close: vi.fn() });
      watchers.push(watcher);
      return watcher;
    });
    return { watch, watchers };
  };

  it('one watch per existing store, relevant changes only, retries missing stores', () => {
    const { watch, watchers } = fakeWatch();
    const existing = new Set(['/h/.claude/jobs']);
    const onChange = vi.fn();
    const sources = agentWatchSources({ claudeHome: '/h/.claude', ompAgentDir: '/h/.omp/agent' });
    const handle = watchSources(sources, onChange, { watch, exists: (d) => existing.has(d) });
    expect(handle.dirs).toEqual(['/h/.claude/jobs']);
    expect(watchers[0].options).toEqual({ recursive: true });

    watchers[0].listener('change', 'abc12345/timeline.jsonl');
    expect(onChange).not.toHaveBeenCalled();
    watchers[0].listener('rename', 'abc12345/state.json');
    expect(onChange).toHaveBeenCalledWith('jobs', 'abc12345/state.json');

    existing.add('/h/.claude/sessions');
    handle.ensure();
    handle.ensure();
    expect(handle.dirs).toEqual(['/h/.claude/jobs', '/h/.claude/sessions']);
    expect(watch).toHaveBeenCalledTimes(2);

    handle.close();
    expect(watchers.every((w) => w.close.mock.calls.length === 1)).toBe(true);
    expect(handle.dirs).toEqual([]);
  });

  it('a watch that errors is dropped and re-established by ensure', () => {
    const { watch, watchers } = fakeWatch();
    const handle = watchSources([{ kind: 'sessions', dir: '/s', recursive: false }], () => {}, {
      watch,
      exists: () => true,
    });
    watchers[0].emit('error', new Error('EMFILE'));
    expect(handle.dirs).toEqual([]);
    handle.ensure();
    expect(handle.dirs).toEqual(['/s']);
    expect(watch).toHaveBeenCalledTimes(2);
  });

  it('a platform without fs.watch support leaves the reconcile to do the work', () => {
    const watch = vi.fn(() => {
      throw new Error('ERR_FEATURE_UNAVAILABLE_ON_PLATFORM');
    });
    const handle = watchSources([{ kind: 'jobs', dir: '/j', recursive: true }], () => {}, {
      watch,
      exists: () => true,
    });
    expect(handle.dirs).toEqual([]);
  });
});
