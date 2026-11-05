export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ToastBox {
  id: string;
  rect: Box;
  /** Buttons inside the toast ("×", "Rückgängig" …) stay clickable, so the toast stays opaque there */
  buttons: Box[];
}

const inside = (x: number, y: number, b: Box) =>
  x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;

/** Id of the toast that should fade and let clicks through at (x, y), or null */
export function fadedToastId(x: number, y: number, toasts: ToastBox[]): string | null {
  const hit = toasts.find((t) => inside(x, y, t.rect));
  if (!hit || hit.buttons.some((b) => inside(x, y, b))) return null;
  return hit.id;
}
