import { useEffect, useState } from 'react';
import { Toaster, ToastBar, toast, type ToasterProps } from 'react-hot-toast';
import { X } from 'lucide-react';
import { fadedToastId, type ToastBox } from '../utils/toastHit';

const BAR_SELECTOR = '[data-toast-close]';

function toastBoxes(): ToastBox[] {
  return Array.from(document.querySelectorAll<HTMLElement>(BAR_SELECTOR)).flatMap((close) => {
    const bar = close.parentElement; // the × is a direct child of ToastBar's root element
    if (!bar) return [];
    return [
      {
        id: close.dataset.toastClose ?? '',
        rect: bar.getBoundingClientRect(),
        buttons: Array.from(bar.querySelectorAll('button')).map((b) => b.getBoundingClientRect()),
      },
    ];
  });
}

/**
 * Toaster whose toasts never block the controls underneath (issue #183): the toast body
 * ignores the pointer, fades while the pointer is over it, and clicks reach what lies below.
 * Buttons in a toast (its "×", "Rückgängig" …) stay clickable.
 */
export function PassThroughToaster(props: Omit<ToasterProps, 'children'>) {
  const [faded, setFaded] = useState<string | null>(null);

  useEffect(() => {
    let frame = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setFaded(fadedToastId(e.clientX, e.clientY, toastBoxes()))
      );
    };
    const onLeave = () => setFaded(null);
    document.addEventListener('pointermove', onMove);
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    // pointer-events is inherited, so buttons inside the click-through toast body need it back
    <Toaster {...props} containerClassName="[&_button]:pointer-events-auto">
      {(t) => (
        <ToastBar
          toast={t}
          style={{
            pointerEvents: 'none',
            // filter, not opacity: the enter animation fills opacity and would override it
            transition: 'filter 120ms ease-out',
            ...(faded === t.id ? { filter: 'opacity(0.15)' } : {}),
          }}
        >
          {({ icon, message }) => (
            <>
              {icon}
              {message}
              <button
                type="button"
                data-toast-close={t.id}
                aria-label="Benachrichtigung schließen"
                onClick={() => toast.dismiss(t.id)}
                className="ml-1 p-0.5 rounded text-gray-400 hover:text-gray-100 hover:bg-white/10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-gray-300"
              >
                <X className="w-3.5 h-3.5" aria-hidden />
              </button>
            </>
          )}
        </ToastBar>
      )}
    </Toaster>
  );
}
