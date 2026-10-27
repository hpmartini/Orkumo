import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  toggleCollapsed,
  collapseAll,
  expandAll,
  moveGroup,
  groupNeighbour,
  toggleFavoriteGroup,
  toggleFavoriteSession,
  applyGroupOrder,
  withFavoriteSessions,
  findGroupKeyOf,
  isFoldedAway,
  FAVORITES_GROUP_KEY,
  useRailPreferences,
  keepKnown,
} from '../hooks/useRailPreferences';
import type { SessionGroup } from '../utils/agentSessions';
import type { AgentSession } from '../types';

const session = (id: string) => ({ id }) as AgentSession;
const group = (key: string, ids: string[] = [], hidden: string[] = []) =>
  ({
    key,
    title: key,
    sessions: ids.map(session),
    hidden: hidden.map(session),
  }) as unknown as SessionGroup;

describe('railPreferences reducers', () => {
  it('toggles collapsed and favorites without mutating', () => {
    const list = ['a'];
    expect(toggleCollapsed(list, 'b')).toEqual(['a', 'b']);
    expect(toggleCollapsed(list, 'a')).toEqual([]);
    expect(list).toEqual(['a']);
    expect(toggleFavoriteGroup(['x'], 'x')).toEqual([]);
    expect(toggleFavoriteSession([], 's1')).toEqual(['s1']);
  });

  it('collapseAll keeps unlisted collapsed groups, expandAll scopes to keys', () => {
    expect(collapseAll(['z', 'a'], ['a', 'b'])).toEqual(['z', 'a', 'b']);
    expect(expandAll(['z', 'a', 'b'], ['a', 'b'])).toEqual(['z']);
    expect(expandAll(['z', 'a'])).toEqual([]);
  });

  it('applyGroupOrder follows the order, keeps new groups at the end, favorites first', () => {
    const groups = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }];
    expect(applyGroupOrder(groups, []).map((g) => g.key)).toEqual(['a', 'b', 'c', 'd']);
    expect(applyGroupOrder(groups, ['c', 'a']).map((g) => g.key)).toEqual(['c', 'a', 'b', 'd']);
    // stale keys in the order are ignored
    expect(applyGroupOrder(groups, ['gone', 'b']).map((g) => g.key)).toEqual(['b', 'a', 'c', 'd']);
    expect(applyGroupOrder(groups, ['c', 'a'], ['d', 'a']).map((g) => g.key)).toEqual([
      'a',
      'd',
      'c',
      'b',
    ]);
  });

  it('moveGroup moves to the target position in both directions', () => {
    const keys = ['a', 'b', 'c', 'd'];
    expect(moveGroup([], keys, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveGroup([], keys, 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    // one step = swap with the neighbour
    expect(moveGroup(['a', 'b', 'c', 'd'], keys, 'b', 'a')).toEqual(['b', 'a', 'c', 'd']);
  });

  it('moveGroup uses the effective order and keeps hidden keys', () => {
    expect(moveGroup(['c', 'x', 'a'], ['a', 'b', 'c'], 'b', 'c')).toEqual(['b', 'c', 'a', 'x']);
  });

  it('groupNeighbour stays inside the favorite / other block', () => {
    const keys = ['f1', 'f2', 'a', 'b'];
    const favs = ['f1', 'f2'];
    expect(groupNeighbour(keys, favs, 'f1', 1)).toBe('f2');
    expect(groupNeighbour(keys, favs, 'f2', 1)).toBeUndefined(); // would cross into the others
    expect(groupNeighbour(keys, favs, 'a', -1)).toBeUndefined();
    expect(groupNeighbour(keys, favs, 'a', 1)).toBe('b');
    expect(groupNeighbour(keys, favs, 'f1', -1)).toBeUndefined();
    expect(groupNeighbour(keys, favs, 'zzz', 1)).toBeUndefined();
  });

  it('moveGroup is a no-op for unknown or identical keys', () => {
    const order = ['a'];
    expect(moveGroup(order, ['a', 'b'], 'a', 'a')).toBe(order);
    expect(moveGroup(order, ['a', 'b'], 'a', 'zzz')).toBe(order);
  });

  it('withFavoriteSessions pulls favorites into a leading group without duplicates', () => {
    const groups = [group('g1', ['s1', 's2']), group('g2', ['s3'], ['s4'])];
    const result = withFavoriteSessions(groups, ['s2', 's4', 'missing']);
    expect(result.map((g) => g.key)).toEqual([FAVORITES_GROUP_KEY, 'g1', 'g2']);
    expect(result[0].sessions.map((s) => s.id)).toEqual(['s2', 's4']);
    expect(result[1].sessions.map((s) => s.id)).toEqual(['s1']);
    expect(result[2].hidden).toEqual([]);
    expect(withFavoriteSessions(groups, ['nope'])).toBe(groups);
    expect(withFavoriteSessions(groups, [])).toBe(groups);
  });

  it('findGroupKeyOf also finds sessions folded behind "more"', () => {
    const groups = [group('g1', ['s1']), group('g2', [], ['s9'])];
    expect(findGroupKeyOf(groups, 's9')).toBe('g2');
    expect(findGroupKeyOf(groups, 'nope')).toBeNull();
  });

  it('isFoldedAway is true only for sessions behind "more"', () => {
    const groups = [group('g1', ['s1']), group('g2', [], ['s9'])];
    expect(isFoldedAway(groups, 's9')).toBe(true);
    expect(isFoldedAway(groups, 's1')).toBe(false);
    expect(isFoldedAway(groups, 'nope')).toBe(false);
  });
});

describe('useRailPreferences expanded rows', () => {
  it('revealSession expands the collapsed group holding the active session', () => {
    localStorage.removeItem('devOrbitAgentRail.v1');
    const { result } = renderHook(() => useRailPreferences('project'));
    const groups = [group('g1', ['s1']), group('g2', ['s2'])];
    act(() => result.current.collapseAll(['g1', 'g2']));
    act(() => result.current.revealSession(groups, 's2'));
    expect(result.current.collapsed.has('g2')).toBe(false);
    expect(result.current.collapsed.has('g1')).toBe(true);
  });

  it('persists open agent-row details across remounts and groupings', () => {
    localStorage.removeItem('devOrbitAgentRail.v1');
    const first = renderHook(() => useRailPreferences('project'));
    act(() => first.result.current.toggleExpandedSession('a1'));
    expect(first.result.current.expandedSessions.has('a1')).toBe(true);
    first.unmount();

    const second = renderHook(() => useRailPreferences('status'));
    expect(second.result.current.expandedSessions.has('a1')).toBe(true);
    act(() => second.result.current.toggleExpandedSession('a1'));
    expect(second.result.current.expandedSessions.has('a1')).toBe(false);
  });

  it('prunes open details of sessions that no longer exist', () => {
    localStorage.removeItem('devOrbitAgentRail.v1');
    const { result, unmount } = renderHook(() => useRailPreferences('project'));
    act(() => result.current.toggleExpandedSession('gone'));
    act(() => result.current.toggleExpandedSession('alive'));
    act(() => result.current.pruneExpandedSessions(['alive', 'other']));
    expect([...result.current.expandedSessions]).toEqual(['alive']);
    unmount();
    expect(JSON.parse(localStorage.getItem('devOrbitAgentRail.v1')!).expandedSessions).toEqual([
      'alive',
    ]);
  });

  it('keepKnown returns the same array when nothing is dropped', () => {
    const list = ['a', 'b'];
    expect(keepKnown(list, new Set(['a', 'b', 'c']))).toBe(list);
    expect(keepKnown(list, new Set(['b']))).toEqual(['b']);
  });
});
