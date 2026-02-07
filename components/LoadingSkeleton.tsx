import React from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * Skeleton placeholder component for loading states
 */
const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse bg-gray-700/50 rounded ${className}`} />
);

/**
 * Loading skeleton that mimics the main app layout
 */
export const LoadingSkeleton: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex">
      {/* Sidebar Skeleton */}
      <div className="w-64 bg-gray-800 border-r border-gray-700 p-4 flex flex-col gap-4">
        {/* Logo */}
        <div className="flex items-center gap-3 px-2 py-3">
          <Skeleton className="w-8 h-8 rounded-lg" />
          <Skeleton className="h-6 w-32" />
        </div>

        {/* Dashboard button */}
        <Skeleton className="h-10 w-full rounded-lg" />

        {/* Section header */}
        <div className="mt-4">
          <Skeleton className="h-4 w-20 mb-3" />
          {/* App items */}
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 mb-1">
              <Skeleton className="w-2 h-2 rounded-full" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>

        {/* Another section */}
        <div className="mt-4">
          <Skeleton className="h-4 w-24 mb-3" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 mb-1">
              <Skeleton className="w-2 h-2 rounded-full" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
      </div>

      {/* Main Content Skeleton */}
      <div className="flex-1 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>

        {/* Loading indicator */}
        <div className="flex flex-col items-center justify-center py-12">
          <RefreshCw className="animate-spin text-blue-500 mb-4" size={32} />
          <p className="text-gray-400 font-mono">Scanning directory structure...</p>
          <p className="text-gray-500 text-sm mt-2">Discovering projects and configurations</p>
        </div>

        {/* App List Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <div className="flex items-center gap-3 mb-3">
                <Skeleton className="w-10 h-10 rounded-lg" />
                <div className="flex-1">
                  <Skeleton className="h-5 w-32 mb-1" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-4 w-full mb-2" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
