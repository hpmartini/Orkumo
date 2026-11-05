import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowDown,
  ArrowUp,
  Bot,
  ExternalLink,
  Pencil,
  RotateCw,
  Square,
  Trash2,
} from 'lucide-react';
import type { AgentSession } from '../types';
import { useAgentSessions } from '../hooks/useAgentSessions';
import { useAgentContexts } from '../hooks/useAgentContexts';
import { ALIVE, summarizeAgents } from '../utils/agentOverview';
import { formatCountdown } from '../utils/agentCache';
import { formatAge, shortenPath } from '../utils/agentSessions';
import { inProjectScope } from '../utils/projectScope';
import {
  BUCKETS,
  buildRows,
  filterRows,
  groupRows,
  removeRetryOptions,
  sortRows,
  type AgentBucket,
  type AgentGrouping,
} from '../utils/agentTable';
import { removeAgent, renameAgent, respawnAgent, stopAgent } from '../services/agentsApi';
import { useDialogA11y } from './CommandPalette/useDialogA11y';

type Pending =
  | {
      kind: 'stop' | 'delete';
      session: AgentSession;
      message?: string;
      options?: NonNullable<ReturnType<typeof removeRetryOptions>>;
    }
  | { kind: 'rename'; session: AgentSession };

const errorText = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400';

/** Dashboard agent table: overview stats as filters, search, grouping and per-row actions */
export const AgentOverview: React.FC<{ active: boolean; projectPaths?: string[] }> = ({
  active,
  projectPaths,
}) => {
  const navigate = useNavigate();
  const { sessions: allSessions, loading, refresh } = useAgentSessions({ active });
  const contexts = useAgentContexts(active);
  const [now, setNow] = useState(Date.now);
  const [bucket, setBucket] = useState<AgentBucket | null>(null);
  const [query, setQuery] = useState('');
  const [grouping, setGrouping] = useState<AgentGrouping>('none');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  const sessions = useMemo(
    () => allSessions.filter((s) => inProjectScope(s.cwd, projectPaths)),
    [allSessions, projectPaths]
  );
  const overview = useMemo(
    () => summarizeAgents(sessions, contexts, now),
    [sessions, contexts, now]
  );
  const rows = useMemo(() => buildRows(sessions, overview), [sessions, overview]);
  const groups = useMemo(
    () => groupRows(sortRows(filterRows(rows, bucket, query), sortDir), grouping),
    [rows, bucket, query, sortDir, grouping]
  );
  const counts = useMemo(() => {
    const result = Object.fromEntries(BUCKETS.map((b) => [b.key, 0])) as Record<
      AgentBucket,
      number
    >;
    for (const row of rows) for (const b of row.buckets) result[b] += 1;
    return result;
  }, [rows]);
  const visible = groups.reduce((n, g) => n + g.rows.length, 0);

  const open = (session: AgentSession) =>
    navigate(`/agents?attach=${encodeURIComponent(session.id)}`);

  const run = async (label: string, action: () => Promise<unknown>) => {
    try {
      await action();
      toast.success(label);
      refresh();
    } catch (err) {
      toast.error(errorText(err, `${label} failed`));
    }
  };

  const confirm = async (input?: string) => {
    if (!pending) return;
    const { session } = pending;
    setPending(null);
    if (pending.kind === 'rename') {
      const name = input?.trim();
      if (!name || name === session.name) return;
      return run(`Renamed to ${name}`, () => renameAgent(session.id, name));
    }
    if (pending.kind === 'stop') return run(`Stopped ${session.name}`, () => stopAgent(session.id));
    try {
      const result = await removeAgent(session.id, pending.options);
      if (result.removed) {
        toast.success(`Deleted ${session.name}`);
        refresh();
        return;
      }
      const options = removeRetryOptions(result);
      // Server refused (unpushed commits / dirty worktree): ask again with the override
      if (options && !pending.options) {
        setPending({ kind: 'delete', session, message: result.message, options });
      } else toast.error(result.message, { duration: 8000 });
    } catch (err) {
      toast.error(errorText(err, 'Delete failed'));
    }
  };

  return (
    <section className="bg-gray-800 rounded-xl border border-gray-700" aria-label="Agents">
      <div className="flex items-center gap-3 p-4 border-b border-gray-700">
        <Bot className="text-blue-400" size={20} />
        <h3 className="font-semibold text-white">Agents</h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 p-4">
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            onClick={() => setBucket(bucket === b.key ? null : b.key)}
            aria-pressed={bucket === b.key}
            className={`rounded-lg bg-gray-900 border px-3 py-2 text-left transition-colors ${FOCUS} ${
              bucket === b.key ? 'border-blue-400' : 'border-gray-700 hover:border-gray-500'
            }`}
          >
            <div className={`text-2xl font-semibold tabular-nums ${b.tone}`}>
              {loading ? '–' : counts[b.key]}
            </div>
            <div className="text-xs text-gray-400">{b.label}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 text-xs">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, path, project"
          aria-label="Search agents"
          className="flex-1 min-w-[12rem] rounded-md bg-gray-900 border border-gray-700 px-2 py-1.5 text-gray-200 placeholder-gray-500 focus:border-blue-400 focus:outline-none"
        />
        <label className="flex items-center gap-1 text-gray-400">
          Group
          <select
            value={grouping}
            onChange={(e) => setGrouping(e.target.value as AgentGrouping)}
            className="rounded-md bg-gray-900 border border-gray-700 px-2 py-1.5 text-gray-200"
          >
            <option value="none">None</option>
            <option value="status">Status</option>
            <option value="project">Project</option>
          </select>
        </label>
        {bucket && (
          <button
            onClick={() => setBucket(null)}
            className={`rounded-md px-2 py-1.5 text-blue-300 hover:bg-gray-700 ${FOCUS}`}
          >
            Clear filter
          </button>
        )}
      </div>

      <div className="overflow-x-auto px-4 pb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-gray-700">
              <th className="py-1.5 pr-3 font-medium">Name</th>
              <th className="py-1.5 pr-3 font-medium">Status</th>
              <th className="py-1.5 pr-3 font-medium">Project</th>
              <th
                className="py-1.5 pr-3 font-medium"
                aria-sort={sortDir === 'asc' ? 'ascending' : 'descending'}
              >
                <button
                  onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
                  className={`flex items-center gap-1 rounded hover:text-white ${FOCUS}`}
                >
                  Last activity{' '}
                  {sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                </button>
              </th>
              <th className="py-1.5 font-medium text-right">Actions</th>
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.key}>
              {group.label && (
                <tr>
                  <th
                    colSpan={5}
                    className="pt-3 pb-1 text-left text-xs font-semibold uppercase tracking-wide text-gray-400"
                  >
                    {group.label} <span className="font-normal">{group.rows.length}</span>
                  </th>
                </tr>
              )}
              {group.rows.map(({ session, project, lastActivity, cacheMs, fill }) => {
                const bg = session.kind === 'background';
                return (
                  <tr key={session.id} className="border-b border-gray-700/60 hover:bg-gray-750">
                    <td className="py-1.5 pr-3 max-w-[16rem]">
                      <div className="truncate text-gray-200" title={session.name}>
                        {session.name}
                      </div>
                      <div
                        className="truncate text-[11px] text-gray-500 font-mono"
                        title={session.cwd}
                      >
                        {shortenPath(session.cwd, 48)}
                      </div>
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-gray-300 whitespace-nowrap">
                      {session.displayState}
                      {cacheMs !== undefined && (
                        <span className="ml-2 text-orange-400">
                          cache {formatCountdown(cacheMs)}
                        </span>
                      )}
                      {fill !== undefined && (
                        <span className="ml-2 text-red-400">ctx {Math.round(fill * 100)} %</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-gray-300 truncate max-w-[10rem]">
                      {project}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-gray-400 tabular-nums whitespace-nowrap">
                      {lastActivity ? `${formatAge(now - lastActivity)} ago` : '–'}
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      <RowAction label={`Open ${session.name}`} onClick={() => open(session)}>
                        <ExternalLink size={14} />
                      </RowAction>
                      <RowAction
                        label={`Rename ${session.name}`}
                        disabled={!bg}
                        onClick={() => setPending({ kind: 'rename', session })}
                      >
                        <Pencil size={14} />
                      </RowAction>
                      <RowAction
                        label={`Stop ${session.name}`}
                        disabled={!bg || !ALIVE.has(session.displayState)}
                        onClick={() => setPending({ kind: 'stop', session })}
                      >
                        <Square size={14} />
                      </RowAction>
                      <RowAction
                        label={`Restart ${session.name}`}
                        disabled={!bg}
                        onClick={() =>
                          run(`Restarted ${session.name}`, () => respawnAgent(session.id))
                        }
                      >
                        <RotateCw size={14} />
                      </RowAction>
                      <RowAction
                        label={`Delete ${session.name}`}
                        disabled={!bg}
                        danger
                        onClick={() => setPending({ kind: 'delete', session })}
                      >
                        <Trash2 size={14} />
                      </RowAction>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
        {!loading && visible === 0 && (
          <p className="py-4 text-sm text-gray-500">
            {rows.length === 0 ? 'No agents' : 'No agents match the filter'}
          </p>
        )}
      </div>
      {pending && (
        <ActionDialog pending={pending} onConfirm={confirm} onClose={() => setPending(null)} />
      )}
    </section>
  );
};

const RowAction: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}> = ({ label, onClick, disabled, danger, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={disabled ? `${label} (background sessions only)` : label}
    className={`p-1.5 rounded text-gray-400 disabled:opacity-30 disabled:cursor-not-allowed ${FOCUS} ${
      danger
        ? 'enabled:hover:text-red-300 enabled:hover:bg-red-500/15'
        : 'enabled:hover:text-white enabled:hover:bg-gray-700'
    }`}
  >
    {children}
  </button>
);

/** Confirmation for stop/delete, name input for rename */
const ActionDialog: React.FC<{
  pending: Pending;
  onConfirm: (input?: string) => void;
  onClose: () => void;
}> = ({ pending, onConfirm, onClose }) => {
  const dialogRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const trapTab = useDialogA11y(true, dialogRef, () => inputRef.current ?? cancelRef.current);
  const [name, setName] = useState(pending.session.name);
  const { kind, session } = pending;
  const title =
    kind === 'rename' ? 'Rename session' : kind === 'stop' ? 'Stop session?' : 'Delete session?';
  const retry = kind === 'delete' && pending.options;

  return (
    <div
      className="fixed inset-0 z-[90] bg-gray-950/70 flex items-start justify-center px-4 pt-[15vh]"
      onMouseDown={onClose}
    >
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-action-title"
        tabIndex={-1}
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(name);
        }}
        onKeyDown={(e) => {
          trapTab(e);
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] bg-gray-800 border border-gray-600 rounded-xl shadow-2xl p-4 text-sm"
      >
        <h2 id="agent-action-title" className="font-semibold text-gray-50 mb-2">
          {title}
        </h2>
        {kind === 'rename' ? (
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            aria-label="Session name"
            className="w-full rounded-md bg-gray-900 border border-gray-700 px-2 py-1.5 text-gray-200 focus:border-blue-400 focus:outline-none"
          />
        ) : (
          <p className="text-gray-300 break-words">
            {retry
              ? pending.message
              : kind === 'stop'
                ? `Stop "${session.name}"? The session keeps its transcript and can be restarted.`
                : `Delete "${session.name}"? This removes the session and its worktree.`}
          </p>
        )}
        <div className="flex justify-end gap-2 mt-4 text-xs">
          <button
            type="button"
            ref={cancelRef}
            onClick={onClose}
            className={`px-3 py-1.5 rounded-md text-gray-200 hover:bg-gray-700 ${FOCUS}`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={kind === 'rename' && !name.trim()}
            className={`px-3 py-1.5 rounded-md font-medium text-white disabled:opacity-50 ${FOCUS} ${
              kind === 'rename' ? 'bg-blue-600 hover:bg-blue-500' : 'bg-red-600 hover:bg-red-500'
            }`}
          >
            {kind === 'rename'
              ? 'Rename'
              : kind === 'stop'
                ? 'Stop'
                : retry
                  ? 'Delete anyway'
                  : 'Delete'}
          </button>
        </div>
      </form>
    </div>
  );
};
