import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Cpu,
  HardDrive,
  MemoryStick,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Terminal,
  Package,
  GitBranch,
  Container,
} from 'lucide-react';
import {
  fetchSystemHealth,
  SystemHealthReport,
  SystemRecommendation,
} from '../services/api';
import toast from 'react-hot-toast';

interface SystemHealthProps {
  className?: string;
  onRestartApp?: (appId: string) => Promise<void>;
  onInstallDeps?: (appId: string) => Promise<void>;
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

const SeverityIcon: React.FC<{ severity: string }> = ({ severity }) => {
  switch (severity) {
    case 'error':
      return <AlertCircle size={16} className="text-red-400" />;
    case 'warning':
      return <AlertTriangle size={16} className="text-yellow-400" />;
    case 'info':
      return <Info size={16} className="text-blue-400" />;
    default:
      return <CheckCircle2 size={16} className="text-emerald-400" />;
  }
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

const ProgressBar: React.FC<{ value: number; className?: string }> = ({ value, className = '' }) => {
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

export const SystemHealth: React.FC<SystemHealthProps> = ({
  className = '',
  onRestartApp,
  onInstallDeps,
}) => {
  const [health, setHealth] = useState<SystemHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [showVersions, setShowVersions] = useState(false);

  const loadHealth = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchSystemHealth();
      setHealth(data);
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
          <button
            onClick={loadHealth}
            className="ml-auto text-gray-400 hover:text-white"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
    );
  }

  if (!health) return null;

  const { system, recommendations } = health;

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
          {recommendations.length > 0 && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
              {recommendations.length} {recommendations.length === 1 ? 'issue' : 'issues'}
            </span>
          )}
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
          {expanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
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
              <div className="text-xs text-gray-500 mt-1">
                {system.cpu.cores} cores
              </div>
            </div>

            {/* Memory */}
            <div className="bg-gray-900 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <MemoryStick size={14} className="text-purple-400" />
                <span className="text-xs text-gray-400">Memory</span>
              </div>
              <div className="text-lg font-semibold text-white">
                {system.memory.usedPercent}%
              </div>
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
                <div className="text-lg font-semibold text-white">
                  {system.disk.usedPercent}%
                </div>
                <ProgressBar value={system.disk.usedPercent} className="mt-1" />
                <div className="text-xs text-gray-500 mt-1">
                  {formatBytes(system.disk.available)} free
                </div>
              </div>
            )}
          </div>

          {/* Tool Versions */}
          <div className="bg-gray-900 rounded-lg overflow-hidden">
            <button
              onClick={() => setShowVersions(!showVersions)}
              className="w-full flex items-center justify-between p-3 hover:bg-gray-850 transition-colors"
            >
              <span className="text-sm text-gray-300">Tool Versions</span>
              {showVersions ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
            </button>
            {showVersions && (
              <div className="px-3 pb-3 grid grid-cols-2 gap-2">
                {/* Node */}
                <div className="flex items-center gap-2 text-sm">
                  <VersionIcon tool="node" />
                  <span className="text-gray-400">Node:</span>
                  <span className="text-white font-mono">
                    {system.versions.node.installed ? `v${system.versions.node.version}` : 'Not installed'}
                  </span>
                </div>
                {/* npm */}
                <div className="flex items-center gap-2 text-sm">
                  <VersionIcon tool="npm" />
                  <span className="text-gray-400">npm:</span>
                  <span className="text-white font-mono">
                    {system.versions.npm.installed ? `v${system.versions.npm.version}` : 'Not installed'}
                  </span>
                </div>
                {/* Git */}
                <div className="flex items-center gap-2 text-sm">
                  <VersionIcon tool="git" />
                  <span className="text-gray-400">Git:</span>
                  <span className="text-white font-mono">
                    {system.versions.git.installed ? `v${system.versions.git.version}` : 'Not installed'}
                  </span>
                </div>
                {/* Docker */}
                <div className="flex items-center gap-2 text-sm">
                  <VersionIcon tool="docker" />
                  <span className="text-gray-400">Docker:</span>
                  <span className={`font-mono ${system.versions.docker.running ? 'text-white' : 'text-yellow-400'}`}>
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

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-gray-400">Recommendations</h4>
              {recommendations.map((rec, index) => (
                <RecommendationCard
                  key={index}
                  recommendation={rec}
                  onRestartApp={onRestartApp}
                  onInstallDeps={onInstallDeps}
                />
              ))}
            </div>
          )}

          {/* System Info Footer */}
          <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-700">
            <span>{system.platform} ({system.arch})</span>
            <span>Uptime: {formatUptime(system.uptime)}</span>
          </div>
        </div>
      )}
    </div>
  );
};

interface RecommendationCardProps {
  recommendation: SystemRecommendation;
  onRestartApp?: (appId: string) => Promise<void>;
  onInstallDeps?: (appId: string) => Promise<void>;
}

const RecommendationCard: React.FC<RecommendationCardProps> = ({
  recommendation,
  onRestartApp,
  onInstallDeps,
}) => {
  const [showAction, setShowAction] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  const severityColors = {
    error: 'border-red-500/30 bg-red-500/10',
    warning: 'border-yellow-500/30 bg-yellow-500/10',
    info: 'border-blue-500/30 bg-blue-500/10',
  };

  // Extract appId from recommendation message if present (e.g., "App 'my-app' (id123) has...")
  const extractAppId = (): string | null => {
    const match = recommendation.message.match(/\(([a-f0-9]+)\)/);
    return match ? match[1] : null;
  };

  // Determine if this recommendation has a one-click action
  const getQuickAction = (): { label: string; handler: () => Promise<void> } | null => {
    const appId = extractAppId();

    // Project-related recommendations with actionable fixes
    if (recommendation.type === 'project' && appId) {
      if (recommendation.title.toLowerCase().includes('crashed') ||
          recommendation.title.toLowerCase().includes('failed') ||
          recommendation.title.toLowerCase().includes('error')) {
        if (onRestartApp) {
          return {
            label: 'Restart App',
            handler: async () => {
              await onRestartApp(appId);
            },
          };
        }
      }

      if (recommendation.title.toLowerCase().includes('dependencies') ||
          recommendation.title.toLowerCase().includes('node_modules')) {
        if (onInstallDeps) {
          return {
            label: 'Install Dependencies',
            handler: async () => {
              await onInstallDeps(appId);
            },
          };
        }
      }
    }

    return null;
  };

  const quickAction = getQuickAction();

  const handleQuickAction = async () => {
    if (!quickAction) return;

    setIsExecuting(true);
    try {
      await quickAction.handler();
      toast.success(`${quickAction.label} completed`);
    } catch (err) {
      toast.error(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className={`p-3 rounded-lg border ${severityColors[recommendation.severity] || severityColors.info}`}>
      <div className="flex items-start gap-2">
        <SeverityIcon severity={recommendation.severity} />
        <div className="flex-1">
          <div className="font-medium text-white text-sm">{recommendation.title}</div>
          <div className="text-xs text-gray-400 mt-0.5">{recommendation.message}</div>
          <div className="flex items-center gap-2 mt-2">
            {quickAction && (
              <button
                onClick={handleQuickAction}
                disabled={isExecuting}
                className="px-2 py-1 text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30 rounded transition-colors disabled:opacity-50"
              >
                {isExecuting ? (
                  <span className="flex items-center gap-1">
                    <RefreshCw size={12} className="animate-spin" />
                    Running...
                  </span>
                ) : (
                  quickAction.label
                )}
              </button>
            )}
            {recommendation.action && (
              <button
                onClick={() => setShowAction(!showAction)}
                className="text-xs text-gray-400 hover:text-gray-300"
              >
                {showAction ? 'Hide command' : 'Show command'}
              </button>
            )}
          </div>
          {showAction && recommendation.action && (
            <code className="block mt-2 text-xs bg-gray-900 text-emerald-400 p-2 rounded font-mono">
              {recommendation.action}
            </code>
          )}
        </div>
      </div>
    </div>
  );
};
