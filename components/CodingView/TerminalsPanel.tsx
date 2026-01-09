import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface TerminalsPanelProps {
  /** Terminal container element - XTerminal is portaled here from AppDetail */
  children: ReactNode;
  /** Callback when user clicks hide button */
  onHide?: () => void;
}

/**
 * TerminalsPanel - Container for the terminal area in Coding view.
 * Accepts a container as children where XTerminal will be portaled.
 * The terminal instance is managed by AppDetail to preserve sessions
 * when switching between Details and Coding views.
 */
export const TerminalsPanel = ({ children, onHide }: TerminalsPanelProps) => {
  return (
    <div className="h-full flex flex-col bg-gray-900 border-r border-gray-700">
      <div className="px-3 py-2 bg-gray-850 border-b border-gray-700 font-semibold text-sm flex items-center justify-between shrink-0">
        <span>Terminals</span>
        {onHide && (
          <button
            onClick={onHide}
            className="p-1 hover:bg-gray-700 rounded transition-colors"
            title="Hide terminals"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-hidden min-h-0 h-full">
        {children}
      </div>
    </div>
  );
};
