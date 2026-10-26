import React, { useEffect, useRef } from 'react';
import { MoreHorizontal, Monitor, RefreshCw, SquareTerminal } from 'lucide-react';
import type { AgentSession, RemoteAgentsResponse, RemoteDevice } from '../../types';
import { stateGlyph, sessionAgeMs, formatAge } from '../../utils/agentSessions';
import { selectedClass } from './AgentList';

interface RemoteAgentsProps {
  data: RemoteAgentsResponse | null;
  error: string | null;
  loading: boolean;
  now: number;
  peekId: string | null;
  /** `host:id` of the keyboard-selected remote row */
  selectedKey: string | null;
  railFocused: boolean;
  onSelect: (session: AgentSession) => void;
  onAttach: (session: AgentSession) => void;
  onPeek: (session: AgentSession) => void;
}

const STATE_LABEL: Record<RemoteDevice['state'], string> = {
  ok: '',
  offline: 'offline',
  'ssh-denied': 'SSH refused',
  'claude-missing': 'claude missing',
  error: 'error',
};

function setupHint(device: RemoteDevice): string | null {
  switch (device.state) {
    case 'ssh-denied':
      return device.os === 'macOS'
        ? `On ${device.name}: System Settings → General → Sharing → Remote Login on, add your public key to ~/.ssh/authorized_keys. Run "ssh ${device.host}" once here to accept the host key.`
        : `On ${device.name}: add your public key to ~/.ssh/authorized_keys. Run "ssh ${device.host}" once here to accept the host key.`;
    case 'claude-missing':
      return `claude is not in PATH for non-interactive ssh on ${device.name} (e.g. ~/.zshenv or ~/.profile).`;
    default:
      return null;
  }
}

/** Sessions of the other Tailscale devices, one card per device below the local sessions. */
export const RemoteAgents: React.FC<RemoteAgentsProps> = ({
  data,
  error,
  loading,
  now,
  peekId,
  selectedKey,
  railFocused,
  onSelect,
  onAttach,
  onPeek,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);

  // Keep the selected row in view, like the local list
  useEffect(() => {
    if (!selectedKey) return;
    Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-remote-key]') ?? [])
      .find((el) => el.dataset.remoteKey === selectedKey)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);

  const notice = loading ? (
    <span className="flex items-center gap-2">
      <RefreshCw size={12} className="animate-spin motion-reduce:animate-none" /> Querying devices…
    </span>
  ) : error ? (
    error
  ) : data && !data.tailscale ? (
    'Tailscale nicht gefunden'
  ) : data?.error ? (
    data.error
  ) : data && data.devices.length === 0 ? (
    'No other macOS/Linux devices in the tailnet.'
  ) : null;

  return (
    <div
      ref={rootRef}
      className="px-2 pb-2 space-y-2"
      role="listbox"
      aria-label="Remote agents"
    >
      <div className="px-1 pt-1 text-[11px] uppercase tracking-wide text-gray-500">
        Remote-Agents
      </div>
      {notice && <div className="px-1 text-xs text-gray-400">{notice}</div>}
      {data?.devices.map((device) => {
        const hint = setupHint(device);
        const reachable = device.state === 'ok';
        return (
          <div
            key={device.host}
            className={`rounded-lg border border-gray-700 bg-gray-850 overflow-hidden ${reachable ? '' : 'opacity-60'}`}
          >
            <div
              className="flex items-center gap-2 px-3 py-2 text-xs font-semibold bg-gray-800 text-gray-300"
              title={device.host}
            >
              <Monitor size={12} className="shrink-0 text-gray-400" aria-hidden />
              <span className="truncate min-w-0">{device.name}</span>
              <span className="text-[10px] font-normal text-gray-500">{device.os}</span>
              {reachable ? (
                <span className="shrink-0 rounded-full bg-gray-900/60 px-1.5 text-[11px] font-normal tabular-nums text-gray-300">
                  {device.sessions.length}
                </span>
              ) : (
                <span className="ml-auto shrink-0 text-[11px] font-normal text-amber-300">
                  {STATE_LABEL[device.state]}
                </span>
              )}
            </div>
            {!reachable && (device.reason || hint) && (
              <div className="px-3 py-2 text-[11px] text-gray-400 space-y-1">
                {device.reason && (
                  <div className="font-mono truncate" title={device.reason}>
                    {device.reason}
                  </div>
                )}
                {hint && <div>{hint}</div>}
              </div>
            )}
            {reachable && device.sessions.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-500">No active sessions.</div>
            )}
            {device.sessions.map((session) => {
              const glyph = stateGlyph(session.displayState);
              const attachable = session.kind === 'background';
              const key = `${session.host}:${session.id}`;
              const selected = selectedKey === key;
              return (
                <div
                  key={session.id}
                  data-remote-key={key}
                  role="option"
                  aria-selected={selected}
                  onClick={() => onSelect(session)}
                  onDoubleClick={() => attachable && onAttach(session)}
                  className={`group flex items-start gap-2 px-3 py-2 text-sm cursor-pointer border-t border-gray-700/60 first:border-t-0 ${
                    selected ? selectedClass(railFocused) : 'text-gray-300 hover:bg-gray-800'
                  } ${
                    peekId === key
                      ? 'ring-1 ring-inset ring-blue-300/50'
                      : ''
                  }`}
                  title={`${session.id} · ${device.name}:${session.cwd}${attachable ? '\nDouble-click to attach' : ''}`}
                >
                  <span
                    className={`w-4 text-center shrink-0 leading-5 ${glyph.className} ${glyph.animate ? 'animate-pulse motion-reduce:animate-none' : ''}`}
                    aria-hidden="true"
                    title={glyph.label}
                  >
                    {glyph.glyph}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0 leading-5">
                      <span className="sr-only">{glyph.label}: </span>
                      <span className="truncate font-medium">{session.name}</span>
                      <span className="shrink-0 rounded border border-gray-600 px-1 text-[10px] text-sky-300">
                        {device.name}
                      </span>
                      <span className="flex-1" />
                      <span className="text-xs text-gray-500 font-mono shrink-0" title="Age">
                        {formatAge(sessionAgeMs(session, now))}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500 font-mono truncate">
                      {session.cwd}
                    </div>
                  </div>
                  {attachable && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAttach(session);
                      }}
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
                      title={`Attach (ssh -t ${device.host} claude attach ${session.id})`}
                      aria-label="Attach"
                    >
                      <SquareTerminal size={12} />
                    </button>
                  )}
                  {/* `claude logs` only knows background sessions, not `interactive-<pid>` */}
                  {attachable && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onPeek(session);
                      }}
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
                      title="Peek"
                      aria-label="Peek"
                    >
                      <MoreHorizontal size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
