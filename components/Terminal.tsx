import React, { useRef, useEffect } from 'react';
import { Terminal as TerminalIcon } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';

interface TerminalProps {
  logs: string[];
  isRunning: boolean;
}

// Estimated row height for virtualization
const ESTIMATED_ROW_HEIGHT = 24;

export const Terminal: React.FC<TerminalProps> = ({ logs, isRunning }) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const lastLogCountRef = useRef(0);

  // Virtualize the log list for performance with large outputs
  const virtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 10, // Render extra items above/below visible area
  });

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (logs.length > lastLogCountRef.current && parentRef.current) {
      // New logs added, scroll to bottom
      virtualizer.scrollToIndex(logs.length - 1, { align: 'end' });
    }
    lastLogCountRef.current = logs.length;
  }, [logs.length, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="bg-gray-950 rounded-xl border border-gray-800 shadow-inner overflow-hidden flex flex-col h-[400px]">
      {/* Terminal header */}
      <div className="bg-gray-900 px-4 py-2 border-b border-gray-800 flex justify-between items-center shrink-0">
        <span className="text-xs font-mono text-gray-400 flex items-center gap-2">
          <TerminalIcon size={14} /> stdout / stderr
          {logs.length > 0 && (
            <span className="text-gray-600">({logs.length} lines)</span>
          )}
        </span>
        <div className="flex gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-gray-700"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-gray-700"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-gray-700"></div>
        </div>
      </div>

      {/* Virtualized log content */}
      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto scrollbar-hide font-mono text-xs md:text-sm"
      >
        {logs.length === 0 ? (
          <div className="p-4 text-gray-600 italic">
            No output yet... start the application to see logs.
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualItems.map((virtualItem) => {
              const log = logs[virtualItem.index];
              const isError = log.toLowerCase().includes('[error]') ||
                              log.toLowerCase().includes('error:') ||
                              log.toLowerCase().includes('failed');
              const isWarning = log.toLowerCase().includes('[warn]') ||
                                log.toLowerCase().includes('warning:');
              const isSystem = log.startsWith('[SYSTEM]');

              return (
                <div
                  key={virtualItem.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualItem.size}px`,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  className={`px-4 py-0.5 break-all ${
                    isError ? 'text-red-400 bg-red-950/20' :
                    isWarning ? 'text-yellow-400' :
                    isSystem ? 'text-blue-400' :
                    'text-gray-300'
                  }`}
                >
                  <span className="text-gray-600 mr-2 select-none">$</span>
                  {log}
                </div>
              );
            })}
          </div>
        )}

        {/* Blinking cursor when running */}
        {isRunning && logs.length > 0 && (
          <div className="px-4 py-1">
            <span className="text-gray-600 mr-2">$</span>
            <span className="w-2 h-4 bg-gray-500 animate-pulse inline-block align-middle"></span>
          </div>
        )}
      </div>
    </div>
  );
};
