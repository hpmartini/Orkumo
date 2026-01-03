import React, { useRef, useEffect } from 'react';
import { Terminal as TerminalIcon } from 'lucide-react';

interface TerminalProps {
  logs: string[];
  isRunning: boolean;
}

export const Terminal: React.FC<TerminalProps> = ({ logs, isRunning }) => {
  const terminalRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="bg-gray-950 rounded-xl border border-gray-800 shadow-inner overflow-hidden flex flex-col h-[400px]">
      <div className="bg-gray-900 px-4 py-2 border-b border-gray-800 flex justify-between items-center">
        <span className="text-xs font-mono text-gray-400 flex items-center gap-2">
          <TerminalIcon size={14} /> stdout / stderr
        </span>
        <div className="flex gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-gray-700"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-gray-700"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-gray-700"></div>
        </div>
      </div>
      <div
        ref={terminalRef}
        className="flex-1 p-4 font-mono text-xs md:text-sm overflow-y-auto scrollbar-hide space-y-1"
      >
        {logs.length === 0 && (
          <div className="text-gray-600 italic">
            No output yet... start the application to see logs.
          </div>
        )}
        {logs.map((log, i) => (
          <div key={i} className="text-gray-300 break-all">
            <span className="text-gray-600 mr-2">$</span>
            {log}
          </div>
        ))}
        {isRunning && (
          <div className="w-2 h-4 bg-gray-500 animate-pulse inline-block align-middle ml-1"></div>
        )}
      </div>
    </div>
  );
};
