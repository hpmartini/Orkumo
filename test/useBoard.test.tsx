import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { BoardData, BoardItem } from '../types';

const api = vi.hoisted(() => ({
  fetchBoard: vi.fn(),
  fetchBoardSettings: vi.fn(),
  setBoardItemStatus: vi.fn(),
  updateBoardSettings: vi.fn(),
  updateBoardIssue: vi.fn(),
  // Mirrors services/boardApi.ts
  errorDetails: (err: unknown): Record<string, unknown> => {
    const details = (err as { details?: unknown })?.details;
    return details && typeof details === 'object' ? (details as Record<string, unknown>) : {};
  },
}));
vi.mock('../services/boardApi', () => api);

// Undo toasts are render functions; keep the last one so a test can click "Rückgängig"
const toasts = vi.hoisted(() => ({ last: null as null | ((t: { id: string }) => ReactElement) }));
vi.mock('react-hot-toast', () => {
  const toast = Object.assign(
    vi.fn((content: unknown) => {
      if (typeof content === 'function') toasts.last = content as typeof toasts.last;
    }),
    { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }
  );
  return { default: toast };
});

import { useBoard } from '../components/BoardView/useBoard';

const ITEM = 'PVTI_1';

function board(statusOptionId: string): BoardData {
  const item: BoardItem = {
    itemId: ITEM,
    type: 'Issue',
    issueId: null,
    number: 44,
    title: 'Board',
    url: 'https://github.com/o/r/issues/44',
    repo: 'o/r',
    state: 'OPEN',
    stateReason: null,
    statusOptionId,
    labels: [],
    milestone: null,
    assignees: [],
    parent: null,
    subIssues: { total: 0, completed: 0 },
    pullRequests: [],
    mwBoardSessions: [],
    mwMarkers: [],
    updatedAt: '2026-10-01T00:00:00Z',
    closedAt: null,
  };
  return {
    source: { owner: 'o', number: 1 },
    projectId: 'PVT_1',
    title: 'MACC',
    statusField: {
      id: 'F',
      options: ['A', 'B', 'C'].map((id) => ({ id, name: id, color: 'GRAY' })),
    },
    items: [item],
    fetchedAt: 0,
  };
}

/** setBoardItemStatus calls that resolve/reject when the test says so */
function deferredWrites() {
  const calls: { optionId: string; resolve: () => void; reject: (e: Error) => void }[] = [];
  api.setBoardItemStatus.mockImplementation(
    (itemId: string, optionId: string) =>
      new Promise((resolve, reject) =>
        calls.push({
          optionId,
          resolve: () => resolve({ itemId, statusOptionId: optionId }),
          reject,
        })
      )
  );
  return calls;
}

async function setup(initial = 'A') {
  api.fetchBoard.mockResolvedValue(board(initial));
  const hook = renderHook(() => useBoard(true));
  await waitFor(() => expect(hook.result.current.data).not.toBeNull());
  return hook;
}

const status = (hook: Awaited<ReturnType<typeof setup>>) =>
  hook.result.current.data!.items[0].statusOptionId;

/** Poll that answers with stale GitHub data */
async function poll(hook: Awaited<ReturnType<typeof setup>>, serverStatus: string) {
  api.fetchBoard.mockResolvedValueOnce(board(serverStatus));
  await act(() => hook.result.current.refresh());
}

describe('useBoard status writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toasts.last = null;
    api.fetchBoardSettings.mockResolvedValue({
      source: { owner: 'o', number: 1 },
      favorites: [],
      order: [],
      hidden: [],
    });
  });

  it('fast A→B→C: the earlier write settling does not clear the latest move', async () => {
    const writes = deferredWrites();
    const hook = await setup('A');

    act(() => void hook.result.current.moveItem(ITEM, 'B'));
    act(() => void hook.result.current.moveItem(ITEM, 'C'));
    expect(status(hook)).toBe('C');

    await act(async () => writes[0].resolve());
    // B's write is done but C is still in flight: a stale poll must not show A or B
    await poll(hook, 'A');
    expect(status(hook)).toBe('C');

    await act(async () => writes[1].resolve());
    await poll(hook, 'C');
    expect(status(hook)).toBe('C');
  });

  it('fast A→B→C: a failing earlier write does not revert the latest move', async () => {
    const writes = deferredWrites();
    const hook = await setup('A');

    act(() => void hook.result.current.moveItem(ITEM, 'B'));
    act(() => void hook.result.current.moveItem(ITEM, 'C'));

    await act(async () => writes[0].reject(new Error('boom')));
    expect(status(hook)).toBe('C');

    // The latest move failing reverts to its own "before" (B), not to A
    await act(async () => writes[1].reject(new Error('boom')));
    expect(status(hook)).toBe('B');
  });

  it('undo while its write is in flight survives a stale poll', async () => {
    const writes = deferredWrites();
    const hook = await setup('A');

    act(() => void hook.result.current.moveItem(ITEM, 'B'));
    await act(async () => writes[0].resolve());
    expect(toasts.last).not.toBeNull();

    render(toasts.last!({ id: 't' }));
    act(() => screen.getByRole('button', { name: 'Rückgängig' }).click());
    expect(writes[1].optionId).toBe('A');
    expect(status(hook)).toBe('A');

    // GitHub still says B while the undo write runs
    await poll(hook, 'B');
    expect(status(hook)).toBe('A');

    await act(async () => writes[1].resolve());
    await poll(hook, 'A');
    expect(status(hook)).toBe('A');
  });

  it('a new move during an in-flight undo wins over the undo', async () => {
    const writes = deferredWrites();
    const hook = await setup('A');

    act(() => void hook.result.current.moveItem(ITEM, 'B'));
    await act(async () => writes[0].resolve());
    render(toasts.last!({ id: 't' }));
    act(() => screen.getByRole('button', { name: 'Rückgängig' }).click()); // B→A in flight
    act(() => void hook.result.current.moveItem(ITEM, 'C')); // A→C

    await act(async () => writes[1].reject(new Error('boom'))); // undo fails
    expect(status(hook)).toBe('C');
    await poll(hook, 'B');
    expect(status(hook)).toBe('C');
  });
});

/** Poll whose request is sent now and answered when the test calls the returned function */
function sentPoll(hook: Awaited<ReturnType<typeof setup>>) {
  let resolve!: (b: BoardData) => void;
  api.fetchBoard.mockImplementationOnce(() => new Promise<BoardData>((r) => (resolve = r)));
  let done!: Promise<void>;
  act(() => void (done = hook.result.current.refresh()));
  return (answer: BoardData) =>
    act(async () => {
      resolve(answer);
      await done;
    });
}

const items = (hook: Awaited<ReturnType<typeof setup>>) => hook.result.current.data!.items;

describe('useBoard local writes vs. polls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    // Strictly increasing clock: "sent before" / "sent after" a write never share a millisecond
    let t = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => t++);
    api.fetchBoardSettings.mockResolvedValue({
      source: { owner: 'o', number: 1 },
      favorites: [],
      order: [],
      hidden: [],
    });
  });

  const base = () => board('A').items[0];

  it('a new item survives a poll sent before it was created; a later poll is authoritative', async () => {
    const hook = await setup('A');
    const answerStale = sentPoll(hook);
    act(() => hook.result.current.upsertItem({ ...base(), itemId: 'PVTI_2', number: 45 }));
    await answerStale(board('A'));
    expect(items(hook).map((i) => i.itemId)).toEqual([ITEM, 'PVTI_2']);

    const answerFresh = sentPoll(hook);
    await answerFresh(board('A'));
    expect(items(hook).map((i) => i.itemId)).toEqual([ITEM]);
  });

  it('an edited title survives a poll sent before the edit; a later poll is authoritative', async () => {
    const hook = await setup('A');
    const answerStale = sentPoll(hook);
    act(() => hook.result.current.upsertItem({ ...base(), title: 'Bearbeitet' }));
    await answerStale(board('A'));
    expect(items(hook)[0].title).toBe('Bearbeitet');

    const answerFresh = sentPoll(hook);
    await answerFresh(board('A'));
    expect(items(hook)[0].title).toBe('Board');
  });

  it('a successful move survives a poll sent before the write resolved', async () => {
    const writes = deferredWrites();
    const hook = await setup('A');
    act(() => void hook.result.current.moveItem(ITEM, 'B'));
    const answerStale = sentPoll(hook);
    await act(async () => writes[0].resolve());
    await answerStale(board('A'));
    expect(status(hook)).toBe('B');
  });

  it("a failed edit with details.item shows GitHub's state instead of the pre-edit item", async () => {
    const hook = await setup('A');
    api.updateBoardIssue.mockRejectedValueOnce(
      Object.assign(new Error('boom'), { details: { item: { ...base(), title: 'Teilweise' } } })
    );
    let ok: boolean | undefined;
    await act(async () => {
      ok = await hook.result.current.editIssue(ITEM, { title: 'Ganz neu' }, { title: 'Ganz neu' });
    });
    expect(ok).toBe(false);
    expect(items(hook)[0].title).toBe('Teilweise');
  });

  it('a failed edit without details reverts to the pre-edit item', async () => {
    const hook = await setup('A');
    api.updateBoardIssue.mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      await hook.result.current.editIssue(ITEM, { title: 'Ganz neu' }, { title: 'Ganz neu' });
    });
    expect(items(hook)[0].title).toBe('Board');
  });
});
