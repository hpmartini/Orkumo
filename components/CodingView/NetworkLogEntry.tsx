import { Globe, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import type { NetworkLog } from '../../types';

interface NetworkLogEntryProps {
  log: NetworkLog;
}

export const NetworkLogEntry = ({ log }: NetworkLogEntryProps) => {
  const time = new Date(log.timestamp).toLocaleTimeString();
  const hasError = !!log.error;
  const statusColor = hasError
    ? 'text-red-400'
    : log.status && log.status >= 200 && log.status < 300
    ? 'text-green-400'
    : log.status && log.status >= 400
    ? 'text-red-400'
    : 'text-yellow-400';

  return (
    <div className="flex gap-2 py-1 px-2 hover:bg-gray-900 text-xs">
      <Globe className="w-4 h-4 flex-shrink-0 mt-0.5 text-blue-400" />
      <span className="text-gray-500 flex-shrink-0 w-20">{time}</span>
      <span className="text-gray-400 flex-shrink-0 w-16">{log.method}</span>
      <div className="flex-1 truncate" title={log.url}>
        {log.url}
      </div>
      {hasError ? (
        <span className="flex items-center gap-1 text-red-400 flex-shrink-0">
          <AlertCircle className="w-3 h-3" />
          {log.error}
        </span>
      ) : (
        <>
          <span className={`${statusColor} flex-shrink-0 w-12`}>
            {log.status || '-'}
          </span>
          {log.duration !== undefined && (
            <span className="flex items-center gap-1 text-gray-500 flex-shrink-0">
              <Clock className="w-3 h-3" />
              {log.duration}ms
            </span>
          )}
        </>
      )}
    </div>
  );
};
