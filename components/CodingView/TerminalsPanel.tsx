import { ChevronLeft, ChevronRight } from 'lucide-react';
import { XTerminal } from '../XTerminal';

interface TerminalsPanelProps {
  // appId will be used for panel state persistence in Phase 2
  appId: string;
  directory: string;
  logs?: string[];
  isRunning?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const TerminalsPanel = ({
  appId,
  directory,
  logs,
  isRunning,
  isCollapsed,
  onToggleCollapse,
}: TerminalsPanelProps) => {
  // When collapsed, show minimal view with just expand button
  if (isCollapsed) {
    return (
      <div className="h-full flex flex-col bg-gray-900 border-r border-gray-700 items-center py-2">
        <button
          onClick={onToggleCollapse}
          className="p-2 hover:bg-gray-700 rounded transition-colors"
          title="Expand terminals"
        >
          <ChevronRight size={16} />
        </button>
        <span className="text-xs text-gray-500 mt-2 writing-mode-vertical" style={{ writingMode: 'vertical-rl' }}>
          Terminals
        </span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-900 border-r border-gray-700">
      <div className="px-3 py-2 bg-gray-850 border-b border-gray-700 font-semibold text-sm flex items-center justify-between shrink-0">
        <span>Terminals</span>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="p-1 hover:bg-gray-700 rounded transition-colors"
            title="Collapse terminals"
          >
            <ChevronLeft size={14} />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-hidden min-h-0">
        <XTerminal cwd={directory} logs={logs || []} isRunning={isRunning || false} />
      </div>
    </div>
  );
};
