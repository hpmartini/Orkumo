import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import { PassThroughToaster } from '../components/PassThroughToaster';
import { undoToast } from '../components/BoardView/useBoard';
import { fadedToastId } from '../utils/toastHit';

const box = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
});

describe('fadedToastId', () => {
  const toasts = [{ id: 'a', rect: box(100, 0, 300, 40), buttons: [box(280, 10, 295, 30)] }];

  it('fades the toast under the pointer', () => {
    expect(fadedToastId(150, 20, toasts)).toBe('a');
  });
  it('keeps the toast opaque over one of its buttons', () => {
    expect(fadedToastId(285, 20, toasts)).toBeNull();
  });
  it('fades nothing outside every toast', () => {
    expect(fadedToastId(50, 20, toasts)).toBeNull();
  });
});

// jsdom has no layout: give the toast body and its buttons fixed rectangles
function layout() {
  const close = document.querySelector<HTMLElement>('[data-toast-close]')!;
  const bar = close.parentElement!;
  const rect = (r: ReturnType<typeof box>) =>
    ({
      ...r,
      x: r.left,
      y: r.top,
      width: r.right - r.left,
      height: r.bottom - r.top,
      toJSON: () => r,
    }) as ReturnType<HTMLElement['getBoundingClientRect']>;
  bar.getBoundingClientRect = () => rect(box(100, 0, 300, 40));
  bar.querySelectorAll('button').forEach((b) => {
    b.getBoundingClientRect = () =>
      rect(b === close ? box(280, 10, 295, 30) : box(200, 10, 260, 30));
  });
  return bar;
}

async function move(x: number, y: number) {
  await act(async () => {
    fireEvent.pointerMove(document, { clientX: x, clientY: y });
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

describe('PassThroughToaster', () => {
  afterEach(() => act(() => toast.remove()));

  it('lets the pointer through the toast body and fades it while hovered (AC-1, AC-2)', async () => {
    render(<PassThroughToaster position="top-right" />);
    act(() => void toast('Hallo'));
    await screen.findByText('Hallo');
    const bar = layout();

    expect(bar.style.pointerEvents).toBe('none');
    await move(150, 20);
    expect(bar.style.filter).toBe('opacity(0.15)');
    await move(50, 20);
    expect(bar.style.filter).toBe('');
  });

  it('closes a toast with its × button (AC-3)', async () => {
    render(<PassThroughToaster position="top-right" />);
    act(() => void toast('Weg damit'));
    fireEvent.click(await screen.findByRole('button', { name: 'Benachrichtigung schließen' }));
    await waitFor(() => expect(screen.queryByText('Weg damit')).toBeNull(), { timeout: 3000 }); // exit animation + removeDelay
  });

  it('keeps an action button clickable and opaque (AC-4)', async () => {
    const onUndo = vi.fn();
    render(<PassThroughToaster position="top-right" />);
    act(() => undoToast('Verschoben', onUndo));
    const undo = await screen.findByRole('button', { name: 'Rückgängig' });
    const bar = layout();

    await move(230, 20);
    expect(bar.style.filter).toBe('');
    fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalledOnce();
  });
});
