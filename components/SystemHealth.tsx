import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Cpu,
  HardDrive,
  MemoryStick,
  AlertCircle,
  Info,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Terminal,
  Package,
  GitBranch,
  Container,
  Layers,
} from 'lucide-react';
import { fetchSystemHealth, SystemHealthReport } from '../services/api';

interface SystemHealthProps {
  className?: string;
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const formatUptime = (seconds: number): string => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
};

const VersionIcon: React.FC<{ tool: string }> = ({ tool }) => {
  switch (tool) {
    case 'node':
      return <Terminal size={14} className="text-green-400" />;
    case 'npm':
      return <Package size={14} className="text-red-400" />;
    case 'git':
      return <GitBranch size={14} className="text-orange-400" />;
    case 'docker':
      return <Container size={14} className="text-blue-400" />;
    default:
      return <Activity size={14} className="text-gray-400" />;
  }
};

const ProgressBar: React.FC<{ value: number; className?: string }> = ({
  value,
  className = '',
}) => {
  const getColor = () => {
    if (value > 90) return 'bg-red-500';
    if (value > 75) return 'bg-yellow-500';
    return 'bg-emerald-500';
  };

  return (
    <div className={`h-2 bg-gray-700 rounded-full overflow-hidden ${className}`}>
      <div
        className={`h-full transition-all duration-300 ${getColor()}`}
        style={{ width: `${Math.min(value, 100)}%` }}
      />
    </div>
  );
};

interface ProcessRow {
  key: string | number;
  name: string;
  detail: string;
  title: string;
  cpuPercent: number;
  rssBytes: number;
}

const ProcessList: React.FC<{
  title: string;
  icon: React.ReactNode;
  rows: ProcessRow[];
  highlight: 'cpu' | 'rss';
}> = ({ title, icon, rows, highlight }) => (
  <div className="bg-gray-900 rounded-lg p-3 min-w-0">
    <div className="flex items-center gap-2 mb-2">
      {icon}
      <span className="text-xs text-gray-400">{title}</span>
    </div>
    {rows.length === 0 ? (
      <div className="text-xs text-gray-500">No data</div>
    ) : (
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.key} className="flex items-baseline gap-2 text-xs" title={row.title}>
            <span className="truncate text-gray-200 flex-1 min-w-0">{row.name}</span>
            <span className="text-gray-500 font-mono shrink-0">{row.detail}</span>
            <span
              className={`font-mono shrink-0 w-12 text-right ${highlight === 'cpu' ? 'text-white' : 'text-gray-400'}`}
            >
              {row.cpuPercent.toFixed(1)}%
            </span>
            <span
              className={`font-mono shrink-0 w-16 text-right ${highlight === 'rss' ? 'text-white' : 'text-gray-400'}`}
            >
              {formatBytes(row.rssBytes)}
            </span>
          </li>
        ))}
      </ul>
    )}
  </div>
);

export const SystemHealth: React.FC<SystemHealthProps> = ({ className = '' }) => {
  const [health, setHealth] = useState<SystemHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [showVersions, setShowVersions] = useState(false);

  const loadHealth = useCallback(async () => {
    try {
      setLoading(true);
      setHealth(await fetchSystemHealth());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load system health');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHealth();
    // Refresh every 2 minutes
    const interval = setInterval(loadHealth, 120000);
    return () => clearInterval(interval);
  }, [loadHealth]);

  if (loading && !health) {
    return (
      <div className={`bg-gray-800 rounded-xl border border-gray-700 p-4 ${className}`}>
        <div className="flex items-center gap-2 text-gray-400">
          <RefreshCw className="animate-spin" size={16} />
          <span>Loading system health...</span>
        </div>
      </div>
    );
  }

  if (error && !health) {
    return (
      <div className={`bg-gray-800 rounded-xl border border-gray-700 p-4 ${className}`}>
        <div className="flex items-center gap-2 text-red-400">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button onClick={loadHealth} className="ml-auto text-gray-400 hover:text-white">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
    );
  }

  if (!health) return null;

  const { system, topProcesses } = health;
  const toRow = (p: SystemHealthReport['topProcesses']['byCpu'][number]): ProcessRow => ({
    key: p.pid,
    name: p.name,
    detail: String(p.pid),
    title: p.command,
    cpuPercent: p.cpuPercent,
    rssBytes: p.rssBytes,
  });

  return (
    <div className={`bg-gray-800 rounded-xl border border-gray-700 ${className}`}>
      {/* Header */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-750 transition-colors rounded-t-xl"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <Activity className="text-blue-400" size={20} />
          <h3 className="font-semibold text-white">System Health</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              loadHealth();
            }}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          {expanded ? (
            <ChevronDown size={16} className="text-gray-400" />
          ) : (
            <ChevronRight size={16} className="text-gray-400" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="p-4 pt-0 space-y-4">
          {/* Resource Usage */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {/* CPU */}
            <div className="bg-gray-900 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <Cpu size={14} className="text-blue-400" />
                <span className="text-xs text-gray-400">CPU Load</span>
              </div>
              <div className="text-lg font-semibold text-white">
                {system.cpu.loadAverage['1min'].toFixed(2)}
              </div>
              <div className="text-xs text-gray-500 mt-1">{system.cpu.cores} cores</div>
            </div>

            {/* Memory */}
            <div className="bg-gray-900 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <MemoryStick size={14} className="text-purple-400" />
                <span className="text-xs text-gray-400">Memory</span>
              </div>
              <div className="text-lg font-semibold text-white">{system.memory.usedPercent}%</div>
              <ProgressBar value={system.memory.usedPercent} className="mt-1" />
              <div className="text-xs text-gray-500 mt-1">
                {formatBytes(system.memory.used)} / {formatBytes(system.memory.total)}
              </div>
            </div>

            {/* Disk */}
            {system.disk && (
              <div className="bg-gray-900 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <HardDrive size={14} className="text-emerald-400" />
                  <span className="text-xs text-gray-400">Disk</span>
                </div>
                <div className="text-lg font-semibold text-white">{system.disk.usedPercent}%</div>
                <ProgressBar value={system.disk.usedPercent} className="mt-1" />
                <div className="text-xs text-gray-500 mt-1">
                  {formatBytes(system.disk.available)} free
                </div>
              </div>
            )}
          </div>

          {/* Top processes */}
          {/* stacked: the card sits in a half-width dashboard column, so viewport breakpoints don't apply */}
          <div className="grid grid-cols-1 gap-3">
            <ProcessList
              title="Top CPU"
              icon={<Cpu size={14} className="text-blue-400" />}
              rows={topProcesses.byCpu.map(toRow)}
              highlight="cpu"
            />
            <ProcessList
              title="Top Speicher"
              icon={<MemoryStick size={14} className="text-purple-400" />}
              rows={topProcesses.byMemory.map(toRow)}
              highlight="rss"
            />
            <ProcessList
              title="Top Apps (Summe je Name)"
              icon={<Layers size={14} className="text-emerald-400" />}
              rows={topProcesses.byApp.map((a) => ({
                key: a.name,
                name: a.name,
                detail: `×${a.processCount}`,
                title: `${a.name}: ${a.processCount} Prozesse`,
                cpuPercent: a.cpuPercent,
                rssBytes: a.rssBytes,
              }))}
              highlight="rss"
            />
          </div>

          {/* Tool Versions */}
          <div className="bg-gray-900 rounded-lg overflow-hidden">
            <button
              onClick={() => setShowVersions(!showVersions)}
              className="w-full flex items-center justify-between p-3 hover:bg-gray-850 transition-colors"
            >
              <span className="text-sm text-gray-300">Tool Versions</span>
              {showVersions ? (
                <ChevronDown size={14} className="text-gray-500" />
              ) : (
                <ChevronRight size={14} className="text-gray-500" />
              )}
            </button>
            {showVersions && (
              <div className="px-3 pb-3 grid grid-cols-2 gap-2">
                {/* Node */}
                <div className="flex items-center gap-2 text-sm">
                  <VersionIcon tool="node" />
                  <span className="text-gray-400">Node:</span>
                  <span className="text-white font-mono">
                    {system.versions.node.installed
                      ? `v${system.versions.node.version}`
                      : 'Not installed'}
                  </span>
                </div>
                {/* npm */}
                <div className="flex items-center gap-2 text-sm">
                  <VersionIcon tool="npm" />
                  <span className="text-gray-400">npm:</span>
                  <span className="text-white font-mono">
                    {system.versions.npm.installed
                      ? `v${system.versions.npm.version}`
                      : 'Not installed'}
                  </span>
                </div>
                {/* Git */}
                <div className="flex items-center gap-2 text-sm">
                  <VersionIcon tool="git" />
                  <span className="text-gray-400">Git:</span>
                  <span className="text-white font-mono">
                    {system.versions.git.installed
                      ? `v${system.versions.git.version}`
                      : 'Not installed'}
                  </span>
                </div>
                {/* Docker */}
                <div className="flex items-center gap-2 text-sm">
                  <VersionIcon tool="docker" />
                  <span className="text-gray-400">Docker:</span>
                  <span
                    className={`font-mono ${system.versions.docker.running ? 'text-white' : 'text-yellow-400'}`}
                  >
                    {system.versions.docker.installed
                      ? `v${system.versions.docker.version}${system.versions.docker.running ? '' : ' (stopped)'}`
                      : 'Not installed'}
                  </span>
                </div>
                {/* Version Manager */}
                {system.versions.versionManager.manager !== 'system' && (
                  <div className="col-span-2 flex items-center gap-2 text-sm text-gray-500">
                    <Info size={12} />
                    Using {system.versions.versionManager.manager} for Node.js version management
                  </div>
                )}
              </div>
            )}
          </div>

          {/* System Info Footer */}
          <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-700">
            <span>
              {system.platform} ({system.arch})
            </span>
            <span>Uptime: {formatUptime(system.uptime)}</span>
          </div>
        </div>
      )}
    </div>
  );
};
