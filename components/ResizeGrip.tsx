import React from 'react';
import { ArrowDownToLine } from 'lucide-react';

/**
 * Grab bar on the top edge of a prompt field; props come from useAutoGrowTextarea. While the
 * height is pinned a small button sets it back to growing with the text.
 */
export const ResizeGrip = ({
  pinned,
  onReset,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { pinned?: boolean; onReset?: () => void }) => (
  <>
    <div
      {...props}
      className="group absolute -top-2 left-0 right-0 z-10 flex h-3 cursor-ns-resize touch-none justify-center outline-none"
    >
      <span
        className={`mt-1 h-1 w-10 rounded-full transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-focus-visible:bg-blue-400 ${
          pinned ? 'bg-blue-500/70 opacity-100' : 'bg-gray-600 opacity-0'
        }`}
      />
    </div>
    {pinned && onReset && (
      <button
        type="button"
        onClick={onReset}
        className="absolute -top-2.5 right-2 z-20 flex items-center gap-1 rounded border border-gray-700 bg-gray-900 px-1.5 text-[10px] leading-4 text-gray-400 hover:text-white hover:border-gray-500 focus-visible:outline-2 focus-visible:outline-blue-400"
        title="Height is fixed: back to growing with the text"
        data-grip-reset
      >
        <ArrowDownToLine size={10} aria-hidden /> Auto height
      </button>
    )}
  </>
);
