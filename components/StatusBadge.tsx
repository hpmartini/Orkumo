import React from 'react';
import { AppStatus } from '../types';

interface StatusBadgeProps {
  status: AppStatus;
}

const statusColors: Record<AppStatus, string> = {
  [AppStatus.RUNNING]: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  [AppStatus.STOPPED]: 'bg-gray-700/50 text-gray-400 border-gray-600/30',
  [AppStatus.ERROR]: 'bg-red-500/20 text-red-400 border-red-500/30',
  [AppStatus.STARTING]: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  [AppStatus.ANALYZING]: 'bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse',
  [AppStatus.CANCELLED]: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  [AppStatus.WAITING]: 'bg-purple-500/20 text-purple-400 border-purple-500/30 animate-pulse',
  [AppStatus.RESTARTING]: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30 animate-pulse',
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${statusColors[status]}`}>
      {status}
    </span>
  );
};
