import React, { useEffect, useState } from 'react';
import { X, History, RefreshCw } from 'lucide-react';
import type { AgentPastSession } from '../../types';
import { fetchPastSessions } from '../../services/agentsApi';
import { formatAge, shortenPath } from '../../utils/agentSessions';

interface ResumePickerProps {
  open: boolean;
  initialQuery: string;
  cwd: string | null;
  onClose: () => void;
  onResume: (session: AgentPastSession) => void;
}

/**
 * `/resume` picker: past sessions newest first, Enter resumes as a background session.
 */
export const ResumePicker: React.FC<ResumePickerProps> = ({
  open,
  initialQuery,
  cwd,
  onClose,
  onResume,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [sessions, setSessions] = useState<AgentPastSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState(0);
  const [scoped, setScoped] = useState(!!cwd);

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
    setIndex(0);
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      fetchPastSessions({ cwd: scoped ? cwd : null, q: query })
        .then((data) => {
          if (!cancelled) {
            setSessions(data);
            setIndex(0);
          }
        })
        .catch(() => {
          if (!cancelled) setSessions([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, cwd, scoped]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(sessions.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (sessions[index]) onResume(sessions[index]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-24"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
          <History size={16} className="text-blue-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search past sessions (name, prompt, id)"
            className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-600 outline-none"
            aria-label="Search past sessions"
          />
          <label
            className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer"
            title="Only sessions from the current directory"
          >
            <input
              type="checkbox"
              checked={scoped}
              disabled={!cwd}
              onChange={(e) => setScoped(e.target.checked)}
            />
            this directory
          </label>
          {loading && <RefreshCw size={12} className="animate-spin text-gray-500" />}
          <button
            onClick={onClose}
            className="p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {sessions.length === 0 && !loading && (
            <div className="px-4 py-6 text-sm text-gray-500 text-center">
              No past sessions found.
            </div>
          )}
          {sessions.map((session, i) => (
            <button
              key={session.sessionId}
              onClick={() => onResume(session)}
              onMouseEnter={() => setIndex(i)}
              className={`w-full text-left px-4 py-2 flex items-center gap-3 border-l-2 ${
                i === index
                  ? 'bg-gray-800 border-blue-500'
                  : 'border-transparent hover:bg-gray-800/60'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-100 truncate">{session.name}</div>
                <div className="text-[11px] text-gray-500 font-mono truncate">
                  {session.id ? `${session.id} · ` : ''}
                  {session.sessionId.slice(0, 8)} ·{' '}
                  {session.cwd ? shortenPath(session.cwd, 36) : session.projectSlug}
                  {session.state ? ` · ${session.state}` : ''}
                </div>
              </div>
              <span className="text-xs text-gray-600 font-mono">
                {formatAge(Date.now() - session.lastActivity)} ago
              </span>
            </button>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-gray-800 text-[11px] text-gray-500">
          ↑↓ select · enter resume as background session · esc close
        </div>
      </div>
    </div>
  );
};
