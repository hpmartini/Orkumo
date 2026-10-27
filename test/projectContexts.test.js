import { describe, it, expect } from 'vitest';
import {
  activateContext,
  createContext,
  deleteContext,
  listContexts,
  reorderContexts,
  updateContext,
} from '../server/services/projectContexts.js';

// Settings as written before #97: no contexts at all
const legacy = {
  favorites: ['a', 'b'],
  favoritesSortMode: 'alpha-asc',
  archived: [],
  board: {
    source: { owner: 'o', number: 4 },
    favorites: ['repo:x'],
    order: [],
    hidden: ['label:y'],
  },
};

const withEpic = () => createContext(legacy, { name: 'Epic', appIds: ['a'] }, 'epic').settings;

describe('project contexts', () => {
  it('migrates old settings into the default context without touching values', () => {
    expect(listContexts(legacy)).toEqual({
      contexts: [{ id: 'all', name: 'Alle', appIds: null, boardFilter: [] }],
      activeContextId: 'all',
    });
  });

  it('starts a new context empty and keeps the old one parked', () => {
    const ui = { 'devOrbitAgentWorkspace.v2': '{"tabs":[1]}' };
    const { settings, ui: loaded } = activateContext(withEpic(), 'epic', ui);
    expect(loaded).toBeNull();
    expect(settings.activeContextId).toBe('epic');
    expect(settings.favorites).toEqual([]);
    expect(settings.favoritesSortMode).toBe('manual');
    expect(settings.board).toEqual({
      source: { owner: 'o', number: 4 },
      favorites: [],
      order: [],
      hidden: [],
    });
    expect(settings.contextState.all).toEqual({
      favorites: ['a', 'b'],
      favoritesSortMode: 'alpha-asc',
      board: { favorites: ['repo:x'], order: [], hidden: ['label:y'] },
      ui,
    });
  });

  it('round-trips favorites, board slices and ui', () => {
    const ui = { 'devOrbitAgentRail.v1': 'rail' };
    let { settings } = activateContext(withEpic(), 'epic', ui);
    settings = { ...settings, favorites: ['a'] };
    const back = activateContext(settings, 'all', { k: 'epic-ui' });
    expect(back.ui).toEqual(ui);
    expect(back.settings.favorites).toEqual(['a', 'b']);
    expect(back.settings.board.hidden).toEqual(['label:y']);
    const again = activateContext(back.settings, 'epic', null);
    expect(again.settings.favorites).toEqual(['a']);
    expect(again.ui).toEqual({ k: 'epic-ui' });
  });

  it('drops favorites archived while the context was parked', () => {
    let { settings } = activateContext(withEpic(), 'epic', null);
    settings = { ...settings, archived: ['b'] };
    expect(activateContext(settings, 'all', null).settings.favorites).toEqual(['a']);
  });

  it('parks a stale device ui with the context it belongs to', () => {
    // Device 1 switched to epic; device 2 still holds ui of "all"
    const { settings } = activateContext(withEpic(), 'epic', { k: 'dev1-all' });
    const synced = activateContext(settings, 'epic', { k: 'dev2-all' }, 'all');
    expect(synced.settings.activeContextId).toBe('epic');
    expect(synced.settings.contextState.all.ui).toEqual({ k: 'dev2-all' });
    expect(synced.settings.contextState.all.favorites).toEqual(['a', 'b']);
  });

  it('refuses to delete the last context and activates a neighbour when deleting the active one', () => {
    expect(() => deleteContext(legacy, 'all')).toThrow(/last context/);
    const { settings } = activateContext(withEpic(), 'epic', null);
    const next = deleteContext(settings, 'epic');
    expect(listContexts(next).activeContextId).toBe('all');
    expect(next.favorites).toEqual(['a', 'b']);
    expect(next.contextState.epic).toBeUndefined();
  });

  it('updates and reorders, rejecting incomplete orders', () => {
    const renamed = updateContext(withEpic(), 'epic', { name: 'Epic B' }).settings;
    expect(renamed.contexts[1]).toMatchObject({ id: 'epic', name: 'Epic B', appIds: ['a'] });
    expect(reorderContexts(renamed, ['epic', 'all']).contexts.map((c) => c.id)).toEqual([
      'epic',
      'all',
    ]);
    expect(() => reorderContexts(renamed, ['epic'])).toThrow();
    expect(() => updateContext(renamed, 'nope', {})).toThrow(/Unknown context/);
  });
});
