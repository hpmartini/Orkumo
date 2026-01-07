import { X } from 'lucide-react';
import { XTerminal } from '../XTerminal';

interface TerminalsPanelProps {
  directory: string;
  logs?: string[];
  isRunning?: boolean;
  onHide?: () => void;
}

export const TerminalsPanel = ({
  directory,
  logs,
  isRunning,
  onHide,
}: TerminalsPanelProps) => {
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
      <div className="flex-1 overflow-hidden min-h-0">
        <XTerminal cwd={directory} logs={logs || []} isRunning={isRunning || false} />
      </div>
    </div>
  );
};
