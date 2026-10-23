import React, { useState } from 'react';
import { Check, Copy, ExternalLink, Server, X } from 'lucide-react';
import type { AgentServerStats } from '../../types';
import type { AgentServer } from '../../utils/agentSessions';
import { useServerStats } from '../../hooks/useServerStats';
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

export const ServersPanel: React.FC<ServersPanelProps> = ({ rows, onSelectAgent, onClose }) => {
  const ref = usePopover(onClose);
  const [copied, setCopied] = useState<number | null>(null);
  // The panel is only mounted while open, so polling stops when it closes
  const stats = useServerStats(
    rows.flatMap(({ server }) => (server.pid ? [server.pid] : [])),
    true
  );

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
            {rows.map(({ server, agentId, agentName }) => (
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
                  className="w-12 shrink-0 text-right tabular-nums text-gray-300"
                  title="CPU (share of one core, incl. child processes)"
                >
                  {formatCpu(server.pid ? stats[server.pid] : undefined)}
                </span>
                <span
                  className="w-16 shrink-0 text-right tabular-nums text-gray-300"
                  title="Memory (RSS, incl. child processes)"
                >
                  {formatMem(server.pid ? stats[server.pid] : undefined)}
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
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
