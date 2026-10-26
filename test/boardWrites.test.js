import { describe, it, expect } from 'vitest';
import { CREATE_GRACE_MS, keepWrite, mergeRecentWrites } from '../utils/boardWrites.js';

const item = (itemId, title) => ({ itemId, title });

describe('mergeRecentWrites', () => {
  const fetched = [item('a', 'old')];

  it('a write at or after the fetch start replaces the fetched item', () => {
    const out = mergeRecentWrites(fetched, [{ item: item('a', 'new'), at: 100 }], 100, 200);
    expect(out).toEqual([item('a', 'new')]);
  });

  it('a write older than the fetch start is ignored for a present item', () => {
    const out = mergeRecentWrites(fetched, [{ item: item('a', 'new'), at: 99 }], 100, 200);
    expect(out).toEqual([item('a', 'old')]);
  });

  it('a created item missing from the fetch is re-added within the grace window only', () => {
    const w = { item: item('b', 'created'), at: 0, created: true };
    expect(mergeRecentWrites(fetched, [w], 10, CREATE_GRACE_MS - 1)).toEqual([
      item('a', 'old'),
      item('b', 'created'),
    ]);
    expect(mergeRecentWrites(fetched, [w], 10, CREATE_GRACE_MS)).toEqual([item('a', 'old')]);
  });

  it('a missing non-created item is re-added only when newer than the fetch', () => {
    const w = { item: item('b', 'edited'), at: 50 };
    expect(mergeRecentWrites(fetched, [w], 100, 60)).toEqual([item('a', 'old')]);
    expect(mergeRecentWrites(fetched, [w], 50, 60)).toEqual([
      item('a', 'old'),
      item('b', 'edited'),
    ]);
  });

  it('graceMs 0 drops an older created item', () => {
    const w = { item: item('b', 'created'), at: 50, created: true };
    expect(mergeRecentWrites(fetched, [w], 100, 101, 0)).toEqual([item('a', 'old')]);
  });

  it('does not mutate the fetched array', () => {
    mergeRecentWrites(fetched, [{ item: item('b', 'x'), at: 200 }], 100, 200);
    expect(fetched).toEqual([item('a', 'old')]);
  });
});

describe('keepWrite', () => {
  it('keeps newer writes and created ones inside the grace window', () => {
    expect(keepWrite({ item: item('a'), at: 100 }, 100, 200)).toBe(true);
    expect(keepWrite({ item: item('a'), at: 99 }, 100, 200)).toBe(false);
    expect(keepWrite({ item: item('a'), at: 0, created: true }, 100, CREATE_GRACE_MS - 1)).toBe(
      true
    );
    expect(keepWrite({ item: item('a'), at: 0, created: true }, 100, CREATE_GRACE_MS)).toBe(false);
    expect(keepWrite({ item: item('a'), at: 50, created: true }, 100, 101, 0)).toBe(false);
  });
});
