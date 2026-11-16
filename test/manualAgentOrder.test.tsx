import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  applySessionOrder,
  moveSession,
  useRailPreferences,
  STORAGE_KEY,
  FAVORITES_GROUP_KEY,
} from '../hooks/useRailPreferences';
import { SORT_OPTIONS, sortSessionsBy } from '../utils/agentSessions';
import type { SessionGroup } from '../utils/agentSessions';
import type { AgentSession } from '../types';

const session = (id: string, startedAt = 0) => ({ id, name: id, startedAt }) as AgentSession;
const group = (key: string, ids: string[], hidden: string[] = []) =>
  ({
    key,
    title: key,
    sessions: ids.map((id) => session(id)),
    hidden: hidden.map((id) => session(id)),
  }) as unknown as SessionGroup;
const ids = (g: SessionGroup) => g.sessions.map((s) => s.id);

describe('manual agent order (#299)', () => {
  beforeEach(() => localStorage.clear());

  it('offers a Manual sort that keeps the default newest-first order until moved', () => {
    expect(SORT_OPTIONS.some((o) => o.key === 'manual')).toBe(true);
    const list = [session('old', 1), session('new', 3), session('mid', 2)];
    expect(sortSessionsBy(list, { key: 'manual', dir: 'desc' }).map((s) => s.id)).toEqual([
      'new',
      'mid',
      'old',
    ]);
  });

  it('applies the stored order, puts new agents on top and ignores vanished ones', () => {
    const [g] = applySessionOrder([group('all', ['n1', 'a', 'b', 'c', 'n2'])], {
      all: ['c', 'gone', 'a', 'b'],
    });
    expect(ids(g)).toEqual(['n1', 'n2', 'c', 'a', 'b']);
  });

  it('orders groups independently and leaves groups without stored order alone', () => {
    const out = applySessionOrder(
      [group(FAVORITES_GROUP_KEY, ['x', 'y']), group('all', ['p', 'q'])],
      {
        [FAVORITES_GROUP_KEY]: ['y', 'x'],
      }
    );
    expect(out.map(ids)).toEqual([
      ['y', 'x'],
      ['p', 'q'],
    ]);
  });

  it('moves an agent to the target slot and drops stored ids that are gone', () => {
    expect(moveSession(['stale'], ['a', 'b', 'c'], [], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(moveSession([], ['a', 'b', 'c'], [], 'a', 'c')).toEqual(['b', 'c', 'a']);
    // folded-away agents keep their entry
    expect(moveSession(['h', 'stale'], ['a', 'b'], ['h'], 'b', 'a')).toEqual(['b', 'a', 'h']);
    const same = ['a'];
    expect(moveSession(same, ['a', 'b'], [], 'a', 'a')).toBe(same);
  });

  it('persists the order per group across a restart and survives sort mode switches', () => {
    const first = renderHook(() => useRailPreferences('state'));
    const groups = () => [
      group(FAVORITES_GROUP_KEY, ['f1', 'f2']),
      group('working', ['a', 'b', 'c']),
    ];
    act(() => first.result.current.moveSession('working', 'c', 'a', ['a', 'b', 'c']));
    act(() => first.result.current.moveSession(FAVORITES_GROUP_KEY, 'f2', 'f1', ['f1', 'f2']));
    first.unmount();

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.sessionOrder).toEqual({ working: ['c', 'a', 'b'], favorites: ['f2', 'f1'] });

    const reloaded = renderHook(() => useRailPreferences('state'));
    // automatic sort: order not applied; back to manual: restored (AK-4)
    expect(reloaded.result.current.arrange(groups(), false).map(ids)).toEqual([
      ['f1', 'f2'],
      ['a', 'b', 'c'],
    ]);
    expect(reloaded.result.current.arrange(groups(), true).map(ids)).toEqual([
      ['f2', 'f1'],
      ['c', 'a', 'b'],
    ]);
  });

  it('ignores corrupt stored orders', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sessionOrder: { all: 'nope', ok: ['a', 7] }, modes: {} })
    );
    const { result } = renderHook(() => useRailPreferences('none'));
    expect(
      result.current.arrange([group('all', ['x', 'y']), group('ok', ['b', 'a'])], true).map(ids)
    ).toEqual([
      ['x', 'y'],
      ['b', 'a'],
    ]);
  });
});
