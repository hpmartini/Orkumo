import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, ChevronRight, Clock, Layers } from 'lucide-react';
import type { AgentSession } from '../types';
import { useAgentSessions } from '../hooks/useAgentSessions';
import { useAgentContexts } from '../hooks/useAgentContexts';
import { summarizeAgents } from '../utils/agentOverview';
import { formatCountdown } from '../utils/agentCache';

/** Dashboard card: how many agents run, who waits, whose cache or context runs out */
export const AgentOverview: React.FC<{ active: boolean }> = ({ active }) => {
  const navigate = useNavigate();
  const { sessions, loading } = useAgentSessions({ active });
  const contexts = useAgentContexts(active);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const overview = useMemo(
    () => summarizeAgents(sessions, contexts, now),
    [sessions, contexts, now]
  );
  const open = (session?: AgentSession) =>
    navigate(session ? `/agents?attach=${encodeURIComponent(session.id)}` : '/agents');
  const waiting = sessions.filter((s) => s.displayState === 'needs-input');

  const stats = [
    { label: 'Running', value: overview.running, tone: 'text-white' },
    { label: 'Needs input', value: overview.needsInput, tone: 'text-yellow-400' },
    { label: 'Working', value: overview.working, tone: 'text-blue-400' },
    { label: 'Done', value: overview.done, tone: 'text-emerald-400' },
  ];

  return (
    <section className="bg-gray-800 rounded-xl border border-gray-700" aria-label="Agents">
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <Bot className="text-blue-400" size={20} />
          <h3 className="font-semibold text-white">Agents</h3>
        </div>
        <button
          onClick={() => open()}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor rounded"
        >
          Open agents <ChevronRight size={12} />
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4">
        {stats.map((stat) => (
          <button
            key={stat.label}
            onClick={() => open()}
            className="rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-left hover:border-gray-500 transition-colors"
          >
            <div className={`text-2xl font-semibold tabular-nums ${stat.tone}`}>
              {loading ? '–' : stat.value}
            </div>
            <div className="text-xs text-gray-400">{stat.label}</div>
          </button>
        ))}
      </div>
      <div className="grid gap-4 px-4 pb-4 md:grid-cols-3">
        <AttentionList
          title="Needs input"
          icon={<Bot size={14} className="text-yellow-400" />}
          empty="Nobody is waiting"
          items={waiting.map((session) => ({ session, hint: session.waitingFor ?? '' }))}
          onOpen={open}
        />
        <AttentionList
          title="Cache expires < 10 min"
          icon={<Clock size={14} className="text-orange-400" />}
          empty="No cache about to expire"
          items={overview.cacheExpiring.map(({ session, remainingMs }) => ({
            session,
            hint: formatCountdown(remainingMs),
          }))}
          onOpen={open}
        />
        <AttentionList
          title="Compaction needed"
          icon={<Layers size={14} className="text-red-400" />}
          empty="All contexts below 80 %"
          items={overview.needsCompaction.map(({ session, fill }) => ({
            session,
            hint: `${Math.round(fill * 100)} %`,
          }))}
          onOpen={open}
        />
      </div>
    </section>
  );
};

const AttentionList: React.FC<{
  title: string;
  icon: React.ReactNode;
  empty: string;
  items: { session: AgentSession; hint: string }[];
  onOpen: (session: AgentSession) => void;
}> = ({ title, icon, empty, items, onOpen }) => (
  <div>
    <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
      {icon}
      {title}
      <span className="font-normal">{items.length}</span>
    </h4>
    {items.length === 0 ? (
      <p className="text-sm text-gray-500">{empty}</p>
    ) : (
      <ul className="space-y-1">
        {items.map(({ session, hint }) => (
          <li key={session.id}>
            <button
              onClick={() => onOpen(session)}
              className="w-full flex items-center gap-2 rounded px-2 py-1 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
              title={`Open ${session.name}\n${session.cwd}`}
            >
              <span className="flex-1 min-w-0 truncate">{session.name}</span>
              <span className="text-xs text-gray-400 tabular-nums truncate max-w-[40%]">
                {hint}
              </span>
            </button>
          </li>
        ))}
      </ul>
    )}
  </div>
);
