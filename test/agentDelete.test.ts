import { describe, it, expect, vi } from 'vitest';
import { confirmDelete } from '../utils/agentDelete';

describe('confirmDelete', () => {
  it('does not remove when the user cancels', async () => {
    const remove = vi.fn(async () => {});
    expect(await confirmDelete('worker', remove, () => false)).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it('removes exactly once after confirmation and names the session', async () => {
    const remove = vi.fn(async () => {});
    const ask = vi.fn((_message: string) => true);
    expect(await confirmDelete('worker', remove, ask)).toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toContain('"worker"');
  });
});
