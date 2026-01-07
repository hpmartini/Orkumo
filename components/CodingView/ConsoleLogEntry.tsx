import { AlertCircle, Info, AlertTriangle, Bug, Copy } from 'lucide-react';
import type { ConsoleLog } from '../../types';

interface ConsoleLogEntryProps {
  log: ConsoleLog;
}

const ICON_MAP = {
  log: Info,
  info: Info,
  warn: AlertTriangle,
  error: AlertCircle,
  debug: Bug,
};

const COLOR_MAP = {
  log: 'text-gray-300',
  info: 'text-blue-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
  debug: 'text-purple-400',
};

export const ConsoleLogEntry = ({ log }: ConsoleLogEntryProps) => {
  const Icon = ICON_MAP[log.method];
  const colorClass = COLOR_MAP[log.method];
  const time = new Date(log.timestamp).toLocaleTimeString();

  const copyLog = () => {
    const text = `[${log.method.toUpperCase()}] ${log.args.join(' ')}`;
    navigator.clipboard.writeText(text);
  };

  return (
    <div
      className={`flex gap-2 py-1 px-2 hover:bg-gray-900 group ${
        log.uncaught ? 'bg-red-900/20' : ''
      }`}
    >
      <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${colorClass}`} />
      <span className="text-gray-500 text-xs flex-shrink-0 w-20">{time}</span>
      <div className="flex-1">
        {log.args.map((arg, i) => (
          <div key={i} className={colorClass}>
            {typeof arg === 'object' ? (
              <pre className="text-xs overflow-x-auto">{JSON.stringify(arg, null, 2)}</pre>
            ) : (
              String(arg)
            )}
          </div>
        ))}
      </div>
      <button
        onClick={copyLog}
        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-800 rounded transition-opacity"
        title="Copy to clipboard"
      >
        <Copy className="w-3 h-3" />
      </button>
    </div>
  );
};
