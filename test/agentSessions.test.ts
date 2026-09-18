import { describe, it, expect } from 'vitest';
import {
  groupSessions,
  flattenGroups,
  summarizeSessions,
  sessionAgeMs,
  formatAge,
  prLabel,
  documentTitle,
  COMPLETED_VISIBLE_LIMIT,
} from '../utils/agentSessions';
import type { AgentSession } from '../types';

function session(partial: Partial<AgentSession>): AgentSession {
  return {
    id: Math.random().toString(36).slice(2, 10),
    sessionId: null,
    kind: 'background',
    cwd: '/home/dev/app',
    startedAt: 1000,
    name: 'session',
    state: 'done',
    pinned: false,
    order: null,
    links: [],
    displayState: 'completed',
    ...partial,
  };
}

const openPr = {
  id: 'pr',
  href: 'https://github.com/o/r/pull/1',
  title: null,
  number: 1,
  provider: 'github' as const,
  state: null,
};

describe('groupSessions (state)', () => {
  it('places sessions into pinned / review / needs input / working / completed', () => {
    const sessions = [
      session({ id: 'pinned', pinned: true, state: 'working' }),
      session({ id: 'review', links: [openPr] }),
      session({ id: 'blocked', state: 'blocked' }),
      session({ id: 'working', state: 'working' }),
      session({ id: 'done', state: 'done' }),
      session({ id: 'tty', kind: 'interactive', state: null }),
    ];
    const groups = groupSessions(sessions, 'state');
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.sessions.map((s) => s.id)]));
    expect(byKey.pinned).toEqual(['pinned']);
    expect(byKey.review).toEqual(['review']);
    expect(byKey['needs-input']).toEqual(['blocked']);
    expect(byKey.working).toEqual(['working']);
    expect(byKey.completed).toEqual(['done']);
    expect(byKey.interactive).toEqual(['tty']);
  });

  it('folds completed sessions but keeps failures and open PRs visible', () => {
    const sessions = [
      ...Array.from({ length: COMPLETED_VISIBLE_LIMIT + 4 }, (_, i) =>
        session({ id: `done-${i}`, startedAt: i })
      ),
      session({ id: 'failed', state: 'failed', startedAt: -1 }),
    ];
    const completed = groupSessions(sessions, 'state').find((g) => g.key === 'completed')!;
    expect(completed.sessions).toHaveLength(COMPLETED_VISIBLE_LIMIT);
    expect(completed.sessions.some((s) => s.id === 'failed')).toBe(true);
    expect(completed.hidden).toHaveLength(5);

    const expanded = groupSessions(sessions, 'state', { expandedCompleted: true }).find(
      (g) => g.key === 'completed'
    )!;
    expect(expanded.hidden).toHaveLength(0);
  });

  it('respects manual order before recency', () => {
    const sessions = [
      session({ id: 'newest', state: 'working', startedAt: 300 }),
      session({ id: 'ordered-second', state: 'working', startedAt: 100, order: 1 }),
      session({ id: 'ordered-first', state: 'working', startedAt: 50, order: 0 }),
    ];
    const working = groupSessions(sessions, 'state').find((g) => g.key === 'working')!;
    expect(working.sessions.map((s) => s.id)).toEqual([
      'ordered-first',
      'ordered-second',
      'newest',
    ]);
  });
});

describe('groupSessions (directory)', () => {
  it('groups by cwd and exposes the directory as dispatch target', () => {
    const sessions = [
      session({ id: 'a', cwd: '/x' }),
      session({ id: 'b', cwd: '/y' }),
      session({ id: 'c', cwd: '/x' }),
    ];
    const groups = groupSessions(sessions, 'directory');
    expect(groups.map((g) => g.cwd)).toEqual(['/x', '/y']);
    expect(groups[0].sessions.map((s) => s.id).sort()).toEqual(['a', 'c']);
  });
});

describe('flattenGroups', () => {
  it('skips collapsed groups and adds a "more" row', () => {
    const sessions = Array.from({ length: COMPLETED_VISIBLE_LIMIT + 2 }, (_, i) =>
      session({ id: `s${i}` })
    );
    const groups = groupSessions([...sessions, session({ id: 'w', state: 'working' })], 'state');
    const items = flattenGroups(groups, new Set(['working']));
    expect(items.filter((i) => i.type === 'more')).toHaveLength(1);
    const workingIndex = items.findIndex((i) => i.type === 'group' && i.group.key === 'working');
    expect(items[workingIndex + 1].type).toBe('group');
  });
});

describe('summaries and formatting', () => {
  it('counts awaiting input / working / completed / failed', () => {
    const counts = summarizeSessions([
      session({ state: 'blocked' }),
      session({ state: 'working' }),
      session({ state: 'done' }),
      session({ state: 'failed' }),
      session({ kind: 'interactive', state: null }),
    ]);
    expect(counts).toEqual({ awaitingInput: 1, working: 1, completed: 1, failed: 1 });
  });

  it('freezes the age of finished sessions', () => {
    const finished = session({ state: 'done', startedAt: 1000, updatedAt: 6000 });
    expect(sessionAgeMs(finished, 100000)).toBe(5000);
    const running = session({ state: 'working', startedAt: 1000 });
    expect(sessionAgeMs(running, 4000)).toBe(3000);
  });

  it('formats ages compactly', () => {
    expect(formatAge(15 * 1000)).toBe('15s');
    expect(formatAge(3 * 60 * 1000)).toBe('3m');
    expect(formatAge(5 * 3600 * 1000)).toBe('5h');
    expect(formatAge(3 * 86400 * 1000)).toBe('3d');
  });

  it('renders PR labels with provider prefixes and counts', () => {
    expect(prLabel([openPr])).toMatchObject({ text: '#1', href: openPr.href });
    expect(prLabel([{ ...openPr, provider: 'gitlab', number: 9 }])?.text).toBe('!9');
    expect(prLabel([openPr, { ...openPr, id: 'pr2', number: 2 }])?.text).toBe('2 PRs');
    expect(prLabel([])).toBeNull();
  });

  it('builds the document title', () => {
    expect(documentTitle(0)).toBe('claude agents');
    expect(documentTitle(2)).toBe('2 awaiting input · claude agents');
  });
});
