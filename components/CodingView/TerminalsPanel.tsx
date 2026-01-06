import { XTerminal } from '../XTerminal';

interface TerminalsPanelProps {
  // appId will be used for panel state persistence in Phase 2
  appId: string;
  directory: string;
  logs?: string[];
  isRunning?: boolean;
}

export const TerminalsPanel = ({ appId, directory, logs, isRunning }: TerminalsPanelProps) => {
  return (
    <div className="h-full flex flex-col bg-gray-900 border-r border-gray-700">
      <div className="px-3 py-2 bg-gray-850 border-b border-gray-700 font-semibold text-sm">
        Terminals
      </div>
      <div className="flex-1 overflow-hidden">
        <XTerminal cwd={directory} logs={logs || []} isRunning={isRunning || false} />
      </div>
    </div>
  );
};
