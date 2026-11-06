import React, { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Server, Square, X } from 'lucide-react';
import type { AgentOrphanServer, AgentServerStats } from '../../types';
import { fetchOrphanServers, stopOrphanServer } from '../../services/agentsApi';
import type { AgentServer } from '../../utils/agentSessions';
import {
  MAX_STALE_FAILURES,
  useServerStats,
  type ServerStatsState,
} from '../../hooks/useServerStats';
import { usePopover } from './PullRequestsPanel';

export interface ServerRow {
  server: AgentServer;
  agentId: string;
  agentName: string;
}

interface ServersPanelProps {
  rows: ServerRow[];
  onSelectAgent: (id: string) => void;
  onClose: () => void;
}

const formatCpu = (s?: AgentServerStats) => (s ? `${s.cpu.toFixed(1)}%` : '–');
const formatMem = (s?: AgentServerStats) =>
  s ? (s.memMb >= 1024 ? `${(s.memMb / 1024).toFixed(1)} GB` : `${s.memMb} MB`) : '–';

/** What a row shows for its load: the values (if any), whether they are stale, and why. */
export function serverLoad(
  state: ServerStatsState,
  pid?: number
): { stats?: AgentServerStats; stale: boolean; note?: string } {
  if (!pid) return { stale: false, note: 'No PID known' };
  if (state.failures >= MAX_STALE_FAILURES) return { stale: false, note: 'Load unavailable' };
  const stats = state.stats[pid];
  const stale = state.failures > 0 && !!stats;
  if (stale) {
    const at = new Date(state.updatedAt ?? 0).toLocaleTimeString();
    return { stats, stale, note: `As of ${at}, refresh failed` };
  }
  if (!stats && state.checked.has(pid)) return { stale: false, note: 'Process exited' };
  return { stats, stale: false };
}

export const ServersPanel: React.FC<ServersPanelProps> = ({ rows, onSelectAgent, onClose }) => {
  const ref = usePopover(onClose);
  const [copied, setCopied] = useState<number | null>(null);
  const [orphans, setOrphans] = useState<AgentOrphanServer[]>([]);
  const [confirmPid, setConfirmPid] = useState<number | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);
  const loadOrphans = () =>
    fetchOrphanServers()
      .then(setOrphans)
      .catch(() => {});
  useEffect(() => {
    loadOrphans();
  }, []);
  // The panel is only mounted while open, so polling stops when it closes
  const stats = useServerStats(
    [
      ...rows.flatMap(({ server }) => (server.pid ? [server.pid] : [])),
      ...orphans.map((o) => o.pid),
    ],
    true
  );
  const stop = (pid: number) => {
    setStopError(null);
    stopOrphanServer(pid)
      .then(() => setOrphans((list) => list.filter((o) => o.pid !== pid)))
      .catch((error: Error) => setStopError(error.message))
      .finally(() => {
        setConfirmPid(null);
        loadOrphans();
      });
  };

  const copy = (port: number) => {
    navigator.clipboard
      ?.writeText(`http://localhost:${port}`)
      .then(() => {
        setCopied(port);
        setTimeout(() => setCopied((p) => (p === port ? null : p)), 1500);
      })
      .catch(() => {});
  };

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label="Running servers"
      className="absolute right-4 top-full mt-1 z-40 w-[min(640px,calc(100vw-2rem))] max-h-[70vh] flex flex-col bg-gray-900 border border-gray-700 rounded-lg shadow-2xl outline-none"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 shrink-0 text-sm">
        <Server size={14} className="text-gray-400" />
        <span className="font-medium">Running servers</span>
        <span className="text-gray-500 tabular-nums text-xs">{rows.length}</span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          aria-label="Close"
          className="p-2 rounded text-gray-400 hover:text-white hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
        >
          <X size={14} />
        </button>
      </div>
      <div className="overflow-y-auto min-h-0">
        {rows.length === 0 ? (
          <p className="px-3 py-4 text-xs text-gray-500">
            No server is listening in an agent directory.
          </p>
        ) : (
          <ul className="divide-y divide-gray-800">
            {rows.map(({ server, agentId, agentName }) => {
              const load = serverLoad(stats, server.pid);
              const loadTitle = (base: string) => (load.note ? `${base} – ${load.note}` : base);
              const loadClass = load.stale ? 'text-gray-500' : 'text-gray-300';
              return (
                <li
                  key={`${agentId}:${server.port}`}
                  className="flex items-center gap-3 px-3 py-1.5 text-xs"
                >
                  <span className="font-mono text-emerald-400 w-14 shrink-0">:{server.port}</span>
                  <span
                    className="font-mono text-gray-300 truncate min-w-0 flex-1"
                    title={server.pid ? `pid ${server.pid}` : undefined}
                  >
                    {server.command || server.name}
                  </span>
                  <span
                    className={`w-12 shrink-0 text-right tabular-nums ${loadClass}`}
                    title={loadTitle('CPU (share of one core, incl. child processes)')}
                  >
                    {formatCpu(load.stats)}
                  </span>
                  <span
                    className={`w-16 shrink-0 text-right tabular-nums ${loadClass}`}
                    title={loadTitle('Memory (RSS, incl. child processes)')}
                  >
                    {formatMem(load.stats)}
                  </span>
                  <button
                    onClick={() => {
                      onSelectAgent(agentId);
                      onClose();
                    }}
                    className="truncate max-w-[10rem] text-blue-300 hover:text-white hover:underline"
                    title="Select this agent"
                  >
                    {agentName}
                  </button>
                  <a
                    href={`http://localhost:${server.port}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 rounded text-gray-400 hover:text-white hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
                    aria-label={`Open localhost:${server.port}`}
                    title="Open"
                  >
                    <ExternalLink size={12} />
                  </a>
                  <button
                    onClick={() => copy(server.port)}
                    className="p-2 rounded text-gray-400 hover:text-white hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
                    aria-label={`Copy URL of port ${server.port}`}
                    title="Copy URL"
                  >
                    {copied === server.port ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {orphans.length > 0 && (
          <section aria-label="Orphaned servers" className="border-t border-gray-700">
            <h3 className="px-3 pt-2 pb-1 text-xs font-medium text-amber-300">
              Verwaist <span className="text-gray-500 tabular-nums">{orphans.length}</span>
              <span className="ml-2 font-normal text-gray-500">
                no running session owns these (finished worktree or job)
              </span>
            </h3>
            {stopError && <p className="px-3 pb-1 text-xs text-red-400">{stopError}</p>}
            <ul className="divide-y divide-gray-800">
              {orphans.map((orphan) => {
                const load = serverLoad(stats, orphan.pid);
                return (
                  <li
                    key={orphan.pid + ':' + orphan.port}
                    className="flex items-center gap-3 px-3 py-1.5 text-xs"
                  >
                    <span className="font-mono text-amber-400 w-14 shrink-0">:{orphan.port}</span>
                    <span className="min-w-0 flex-1">
                      <span
                        className="block font-mono text-gray-300 truncate"
                        title={`pid ${orphan.pid}`}
                      >
                        {orphan.command}
                      </span>
                      <span className="block font-mono text-gray-500 truncate" title={orphan.cwd}>
                        {orphan.cwd}
                      </span>
                    </span>
                    <span className="w-12 shrink-0 text-right tabular-nums text-gray-300">
                      {formatCpu(load.stats)}
                    </span>
                    <span className="w-16 shrink-0 text-right tabular-nums text-gray-300">
                      {formatMem(load.stats)}
                    </span>
                    {confirmPid === orphan.pid ? (
                      <span className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => stop(orphan.pid)}
                          className="px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
                        >
                          Stop pid {orphan.pid}
                        </button>
                        <button
                          onClick={() => setConfirmPid(null)}
                          className="px-2 py-1 rounded text-gray-300 hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmPid(orphan.pid)}
                        className="p-2 rounded text-gray-400 hover:text-red-300 hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
                        aria-label={`Stop orphaned server on port ${orphan.port}`}
                        title="Stop (SIGTERM)"
                      >
                        <Square size={12} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
};
