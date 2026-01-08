import type { ReactNode } from 'react';

interface TerminalsPanelProps {
  /** Terminal container element - XTerminal is portaled here from AppDetail */
  children: ReactNode;
}

/**
 * TerminalsPanel - Container for the terminal area in Coding view.
 * Accepts a container as children where XTerminal will be portaled.
 * The terminal instance is managed by AppDetail to preserve sessions
 * when switching between Details and Coding views.
 */
export const TerminalsPanel = ({ children }: TerminalsPanelProps) => {
  return (
    <div className="h-full flex flex-col bg-gray-900 border-r border-gray-700">
      <div className="px-3 py-2 bg-gray-850 border-b border-gray-700 font-semibold text-sm shrink-0">
        Terminals
      </div>
      <div className="flex-1 overflow-hidden min-h-0 h-full">
        {children}
      </div>
    </div>
  );
};
