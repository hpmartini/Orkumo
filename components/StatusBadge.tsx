import React from 'react';
import { Play, Square, RefreshCw } from 'lucide-react';
import { AppStatus } from '../types';

interface StatusBadgeProps {
  status: AppStatus;
  onClick?: () => void;
  isLoading?: boolean;
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

const clickableStatusColors: Record<AppStatus, string> = {
  [AppStatus.RUNNING]: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30',
  [AppStatus.STOPPED]: 'bg-gray-700/50 text-gray-400 border-gray-600/30 hover:bg-emerald-500/20 hover:text-emerald-400 hover:border-emerald-500/30',
  [AppStatus.ERROR]: 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-emerald-500/20 hover:text-emerald-400 hover:border-emerald-500/30',
  [AppStatus.STARTING]: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  [AppStatus.ANALYZING]: 'bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse',
  [AppStatus.CANCELLED]: 'bg-orange-500/20 text-orange-400 border-orange-500/30 hover:bg-emerald-500/20 hover:text-emerald-400 hover:border-emerald-500/30',
  [AppStatus.WAITING]: 'bg-purple-500/20 text-purple-400 border-purple-500/30 animate-pulse',
  [AppStatus.RESTARTING]: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30 animate-pulse',
};

const isActionableStatus = (status: AppStatus): boolean => {
  return status === AppStatus.RUNNING ||
         status === AppStatus.STOPPED ||
         status === AppStatus.ERROR ||
         status === AppStatus.CANCELLED;
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, onClick, isLoading }) => {
  const isClickable = onClick && isActionableStatus(status);
  const isRunning = status === AppStatus.RUNNING;
  const canStart = status === AppStatus.STOPPED || status === AppStatus.ERROR || status === AppStatus.CANCELLED;

  const getTitle = () => {
    if (!isClickable) return status;
    if (isRunning) return 'Click to stop';
    if (canStart) return 'Click to start';
    return status;
  };

  const getIcon = () => {
    if (isLoading) {
      return <RefreshCw size={10} className="animate-spin" />;
    }
    if (isRunning) {
      return <Square size={10} fill="currentColor" className="opacity-0 group-hover/badge:opacity-100 transition-opacity" />;
    }
    if (canStart) {
      return <Play size={10} fill="currentColor" className="opacity-0 group-hover/badge:opacity-100 transition-opacity" />;
    }
    return null;
  };

  if (isClickable) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        disabled={isLoading}
        className={`group/badge px-2 py-0.5 rounded text-xs font-medium border cursor-pointer transition-all flex items-center gap-1.5 disabled:opacity-50 ${clickableStatusColors[status]}`}
        title={getTitle()}
      >
        {getIcon()}
        <span>{status}</span>
      </button>
    );
  }

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${statusColors[status]}`}>
      {status}
    </span>
  );
};
