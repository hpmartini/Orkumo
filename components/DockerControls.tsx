import React, { useState, useEffect, useCallback } from 'react';
import {
  Play,
  Square,
  RefreshCw,
  Download,
  Hammer,
  Trash2,
  ChevronDown,
  ChevronRight,
  Server,
  AlertCircle,
  CheckCircle2,
  Clock,
  Pause,
  FileText,
} from 'lucide-react';
import {
  fetchDockerStatus,
  fetchDockerServices,
  startDockerContainers,
  stopDockerContainers,
  restartDockerContainers,
  pullDockerImages,
  buildDockerImages,
  removeDockerContainers,
  fetchDockerLogs,
  DockerContainerStatus,
  DockerServiceInfo,
} from '../services/api';

interface DockerControlsProps {
  appId: string;
  dockerComposeFile?: string;
}

type ContainerStatusType = 'running' | 'exited' | 'paused' | 'created' | 'unknown';

const StatusIcon: React.FC<{ status: ContainerStatusType }> = ({ status }) => {
  switch (status) {
    case 'running':
      return <CheckCircle2 size={14} className="text-emerald-400" />;
    case 'exited':
      return <Square size={14} className="text-red-400" />;
    case 'paused':
      return <Pause size={14} className="text-yellow-400" />;
    case 'created':
      return <Clock size={14} className="text-blue-400" />;
    default:
      return <AlertCircle size={14} className="text-gray-400" />;
  }
};

const StatusBadge: React.FC<{ status: ContainerStatusType }> = ({ status }) => {
  const colors: Record<ContainerStatusType, string> = {
    running: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    exited: 'bg-red-500/20 text-red-400 border-red-500/30',
    paused: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    created: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    unknown: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };

  return (
    <span className={`px-2 py-0.5 text-xs rounded-full border ${colors[status] || colors.unknown}`}>
      {status}
    </span>
  );
};

export const DockerControls: React.FC<DockerControlsProps> = ({
  appId,
  dockerComposeFile,
}) => {
  const [containers, setContainers] = useState<DockerContainerStatus[]>([]);
  const [services, setServices] = useState<DockerServiceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [serviceLogs, setServiceLogs] = useState<Record<string, string>>({});
  const [showLogs, setShowLogs] = useState<string | null>(null);

  // Fetch status and services
  const fetchStatus = useCallback(async () => {
    try {
      const [statusRes, servicesRes] = await Promise.all([
        fetchDockerStatus(appId),
        fetchDockerServices(appId),
      ]);

      if (statusRes.error) {
        setError(statusRes.error);
      } else {
        setContainers(statusRes.containers);
        setError(null);
      }

      if (servicesRes.services) {
        // Merge service info with container status
        const mergedServices = servicesRes.services.map(service => {
          const container = statusRes.containers.find(
            c => c.service === service.name || c.name?.includes(service.name)
          );
          return {
            ...service,
            status: container?.status || 'unknown',
          };
        });
        setServices(mergedServices);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch Docker status');
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    fetchStatus();
    // Poll for status updates every 10 seconds
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Action handlers
  const handleStart = async (serviceName?: string) => {
    setActionLoading(serviceName || 'all-start');
    try {
      const result = await startDockerContainers(appId, serviceName);
      if (!result.success) {
        setError(result.error || 'Failed to start containers');
      } else {
        await fetchStatus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start containers');
    } finally {
      setActionLoading(null);
    }
  };

  const handleStop = async (serviceName?: string) => {
    setActionLoading(serviceName || 'all-stop');
    try {
      const result = await stopDockerContainers(appId, serviceName);
      if (!result.success) {
        setError(result.error || 'Failed to stop containers');
      } else {
        await fetchStatus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop containers');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRestart = async (serviceName?: string) => {
    setActionLoading(serviceName || 'all-restart');
    try {
      const result = await restartDockerContainers(appId, serviceName);
      if (!result.success) {
        setError(result.error || 'Failed to restart containers');
      } else {
        await fetchStatus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restart containers');
    } finally {
      setActionLoading(null);
    }
  };

  const handlePull = async () => {
    setActionLoading('pull');
    try {
      const result = await pullDockerImages(appId);
      if (!result.success) {
        setError(result.error || 'Failed to pull images');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pull images');
    } finally {
      setActionLoading(null);
    }
  };

  const handleBuild = async (serviceName?: string) => {
    setActionLoading(serviceName ? `build-${serviceName}` : 'build');
    try {
      const result = await buildDockerImages(appId, serviceName);
      if (!result.success) {
        setError(result.error || 'Failed to build images');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to build images');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDown = async (removeVolumes = false) => {
    setActionLoading('down');
    try {
      const result = await removeDockerContainers(appId, removeVolumes);
      if (!result.success) {
        setError(result.error || 'Failed to remove containers');
      } else {
        await fetchStatus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove containers');
    } finally {
      setActionLoading(null);
    }
  };

  const handleViewLogs = async (serviceName: string) => {
    if (showLogs === serviceName) {
      setShowLogs(null);
      return;
    }

    setShowLogs(serviceName);
    if (!serviceLogs[serviceName]) {
      try {
        const result = await fetchDockerLogs(appId, serviceName, 50);
        if (result.success && result.logs) {
          setServiceLogs(prev => ({ ...prev, [serviceName]: result.logs || '' }));
        }
      } catch (err) {
        console.error('Failed to fetch logs:', err);
      }
    }
  };

  // Compute overall status
  const runningCount = containers.filter(c => c.status === 'running').length;
  const totalCount = services.length || containers.length;
  const allStopped = runningCount === 0;

  if (loading) {
    return (
      <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
        <div className="flex items-center gap-3">
          <RefreshCw className="animate-spin text-blue-400" size={20} />
          <span className="text-gray-400">Loading Docker status...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Server className="text-blue-400" size={20} />
          <h3 className="text-lg font-semibold text-white">Docker Compose</h3>
          {dockerComposeFile && (
            <span className="text-xs text-gray-500 font-mono bg-gray-900 px-2 py-0.5 rounded">
              {dockerComposeFile}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className={runningCount > 0 ? 'text-emerald-400' : 'text-gray-400'}>
            {runningCount}/{totalCount} running
          </span>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400/60 hover:text-red-400"
          >
            ×
          </button>
        </div>
      )}

      {/* Global Actions */}
      <div className="flex flex-wrap gap-2">
        {allStopped || runningCount < totalCount ? (
          <button
            onClick={() => handleStart()}
            disabled={actionLoading !== null}
            className="flex items-center gap-2 px-3 py-2 bg-emerald-500 text-white hover:bg-emerald-600 rounded-lg transition-all disabled:opacity-50"
          >
            {actionLoading === 'all-start' ? (
              <RefreshCw className="animate-spin" size={16} />
            ) : (
              <Play size={16} fill="currentColor" />
            )}
            Start All
          </button>
        ) : (
          <button
            onClick={() => handleStop()}
            disabled={actionLoading !== null}
            className="flex items-center gap-2 px-3 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 rounded-lg transition-all disabled:opacity-50"
          >
            {actionLoading === 'all-stop' ? (
              <RefreshCw className="animate-spin" size={16} />
            ) : (
              <Square size={16} fill="currentColor" />
            )}
            Stop All
          </button>
        )}

        <button
          onClick={() => handleRestart()}
          disabled={actionLoading !== null || allStopped}
          className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 rounded-lg transition-all disabled:opacity-50"
        >
          {actionLoading === 'all-restart' ? (
            <RefreshCw className="animate-spin" size={16} />
          ) : (
            <RefreshCw size={16} />
          )}
          Restart
        </button>

        <button
          onClick={handlePull}
          disabled={actionLoading !== null}
          className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 rounded-lg transition-all disabled:opacity-50"
        >
          {actionLoading === 'pull' ? (
            <RefreshCw className="animate-spin" size={16} />
          ) : (
            <Download size={16} />
          )}
          Pull
        </button>

        <button
          onClick={() => handleBuild()}
          disabled={actionLoading !== null}
          className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 rounded-lg transition-all disabled:opacity-50"
        >
          {actionLoading === 'build' ? (
            <RefreshCw className="animate-spin" size={16} />
          ) : (
            <Hammer size={16} />
          )}
          Build
        </button>

        <button
          onClick={() => handleDown(false)}
          disabled={actionLoading !== null}
          className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-gray-200 hover:bg-gray-600 border border-gray-600 rounded-lg transition-all disabled:opacity-50"
          title="Remove containers (docker compose down)"
        >
          {actionLoading === 'down' ? (
            <RefreshCw className="animate-spin" size={16} />
          ) : (
            <Trash2 size={16} />
          )}
          Down
        </button>
      </div>

      {/* Services List */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-gray-400">Services</h4>
        <div className="space-y-1">
          {services.map((service) => {
            const container = containers.find(
              c => c.service === service.name || c.name?.includes(service.name)
            );
            const isRunning = container?.status === 'running';
            const isExpanded = expandedService === service.name;
            const status = (container?.status || 'unknown') as ContainerStatusType;

            return (
              <div key={service.name} className="bg-gray-900 rounded-lg overflow-hidden">
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-850 transition-colors"
                  onClick={() => setExpandedService(isExpanded ? null : service.name)}
                >
                  {isExpanded ? (
                    <ChevronDown size={16} className="text-gray-500" />
                  ) : (
                    <ChevronRight size={16} className="text-gray-500" />
                  )}
                  <StatusIcon status={status} />
                  <span className="font-mono text-sm text-white flex-1">{service.name}</span>
                  <StatusBadge status={status} />
                </div>

                {isExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-gray-800 space-y-3">
                    {/* Service details */}
                    <div className="text-xs text-gray-400 space-y-1">
                      {service.image && (
                        <div>
                          <span className="text-gray-500">Image:</span>{' '}
                          <span className="font-mono">{service.image}</span>
                        </div>
                      )}
                      {container?.ports && (
                        <div>
                          <span className="text-gray-500">Ports:</span>{' '}
                          <span className="font-mono">{container.ports}</span>
                        </div>
                      )}
                    </div>

                    {/* Service actions */}
                    <div className="flex flex-wrap gap-2">
                      {isRunning ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStop(service.name);
                          }}
                          disabled={actionLoading !== null}
                          className="flex items-center gap-1.5 px-2 py-1 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 rounded transition-all disabled:opacity-50"
                        >
                          {actionLoading === service.name ? (
                            <RefreshCw className="animate-spin" size={12} />
                          ) : (
                            <Square size={12} fill="currentColor" />
                          )}
                          Stop
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStart(service.name);
                          }}
                          disabled={actionLoading !== null}
                          className="flex items-center gap-1.5 px-2 py-1 text-xs bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30 rounded transition-all disabled:opacity-50"
                        >
                          {actionLoading === service.name ? (
                            <RefreshCw className="animate-spin" size={12} />
                          ) : (
                            <Play size={12} fill="currentColor" />
                          )}
                          Start
                        </button>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRestart(service.name);
                        }}
                        disabled={actionLoading !== null || !isRunning}
                        className="flex items-center gap-1.5 px-2 py-1 text-xs bg-gray-700 text-gray-300 hover:bg-gray-600 rounded transition-all disabled:opacity-50"
                      >
                        <RefreshCw size={12} />
                        Restart
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewLogs(service.name);
                        }}
                        className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-all ${
                          showLogs === service.name
                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                      >
                        <FileText size={12} />
                        Logs
                      </button>
                    </div>

                    {/* Logs display */}
                    {showLogs === service.name && (
                      <div className="mt-2 p-2 bg-gray-950 rounded font-mono text-xs text-gray-300 max-h-48 overflow-auto whitespace-pre-wrap">
                        {serviceLogs[service.name] || 'No logs available'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {services.length === 0 && (
            <div className="text-sm text-gray-500 italic p-3">
              No services found in compose file
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
