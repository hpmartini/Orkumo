import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import type { BoardData, BoardItem, BoardSettings } from '../../types';
import {
  fetchBoard,
  fetchBoardSettings,
  setBoardItemStatus,
  updateBoardSettings,
} from '../../services/boardApi';
import { itemKey } from '../../utils/board';

const POLL_MS = 60_000;

/** Toast with a "Rückgängig" button (react-hot-toast, Toaster lives in App.tsx) */
export function undoToast(message: string, onUndo: () => void) {
  toast(
    (t) => (
      <span className="text-xs">
        {message}
        <button
          onClick={() => {
            toast.dismiss(t.id);
            onUndo();
          }}
          className="ml-3 text-cursor hover:underline underline-offset-2"
        >
          Rückgängig
        </button>
      </span>
    ),
    { duration: 10000 }
  );
}

/**
 * Board data (polled every 60 s while active), board settings, and optimistic status writes.
 */
export function useBoard(active: boolean) {
  const [data, setData] = useState<BoardData | null>(null);
  const [settings, setSettings] = useState<BoardSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Status writes in flight: a poll answering meanwhile must not flip the card back
  // seq: only the latest move of an item may clear or revert it
  const pending = useRef(new Map<string, { optionId: string; seq: number }>());
  const moveSeq = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const patchItem = useCallback((itemId: string, patch: Partial<BoardItem>) => {
    setData((d) =>
      d ? { ...d, items: d.items.map((i) => (i.itemId === itemId ? { ...i, ...patch } : i)) } : d
    );
  }, []);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const next = await fetchBoard(refresh);
      const overrides = pending.current;
      setData(
        overrides.size
          ? {
              ...next,
              items: next.items.map((i) =>
                overrides.has(i.itemId)
                  ? { ...i, statusOptionId: overrides.get(i.itemId)!.optionId }
                  : i
              ),
            }
          : next
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Board konnte nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    load();
    const interval = setInterval(() => load(), POLL_MS);
    return () => clearInterval(interval);
  }, [active, load]);

  useEffect(() => {
    fetchBoardSettings()
      .then(setSettings)
      .catch(() => setSettings({ source: { owner: '', number: 0 }, favorites: [], order: [], hidden: [] }));
  }, []);

  const updateSettings = useCallback(async (patch: Partial<BoardSettings>) => {
    const previous = settingsRef.current;
    if (!previous) return;
    setSettings({ ...previous, ...patch });
    try {
      setSettings(await updateBoardSettings(patch));
    } catch (err) {
      setSettings(previous);
      toast.error(err instanceof Error ? err.message : 'Board-Einstellungen nicht gespeichert');
    }
  }, []);

  const dataRef = useRef(data);
  dataRef.current = data;

  /** Optimistic status change; offers undo unless it is itself an undo */
  const moveItem = useCallback(
    async (itemId: string, optionId: string, undoable = true) => {
      const board = dataRef.current;
      const item = board?.items.find((i) => i.itemId === itemId);
      if (!board || !item || item.statusOptionId === optionId) return;
      const before = { statusOptionId: item.statusOptionId, updatedAt: item.updatedAt };
      const name = (id: string | null) =>
        board.statusField.options.find((o) => o.id === id)?.name ?? 'ohne Status';
      // Fresh updatedAt keeps the card inside the Done window right after the drop
      patchItem(itemId, { statusOptionId: optionId, updatedAt: new Date().toISOString() });
      const seq = ++moveSeq.current;
      const isLatest = () => pending.current.get(itemId)?.seq === seq;
      pending.current.set(itemId, { optionId, seq });
      try {
        await setBoardItemStatus(itemId, optionId);
        const label = `${itemKey(item)}: ${name(before.statusOptionId)} → ${name(optionId)}`;
        if (undoable && before.statusOptionId) {
          const back = before.statusOptionId;
          undoToast(label, () => moveItem(itemId, back, false));
        } else {
          toast.success(label);
        }
      } catch (err) {
        if (isLatest()) patchItem(itemId, before);
        toast.error(
          `${itemKey(item)}: Status nicht gesetzt (${err instanceof Error ? err.message : 'Fehler'})`
        );
      } finally {
        if (isLatest()) pending.current.delete(itemId);
      }
    },
    [patchItem]
  );

  return { data, settings, loading, error, refresh: () => load(true), updateSettings, moveItem };
}
