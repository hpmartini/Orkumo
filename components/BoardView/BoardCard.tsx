import React from 'react';
import {
  Bot,
  CheckCircle2,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  GitPullRequest,
  ListChecks,
} from 'lucide-react';
import type { AgentSession, BoardCheckState, BoardItem, BoardLabel } from '../../types';
import { shortRepo } from '../../utils/board';
import { stateGlyph } from '../../utils/agentSessions';

export const DRAG_TYPE = 'application/x-board-item';

/** Label in GitHub's own colour, text picked for contrast */
export const LabelChip: React.FC<{ label: BoardLabel }> = ({ label }) => {
  const c = /^[0-9a-f]{6}$/i.test(label.color) ? label.color : '8b949e';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
  const light = 0.299 * r + 0.587 * g + 0.114 * b > 150;
  return (
    <span
      className="inline-flex items-center px-1.5 rounded-full text-[10.5px] leading-[18px] font-medium border"
      style={{
        background: `#${c}33`,
        borderColor: `#${c}88`,
        color: light ? `#${c}` : '#eaeff9',
      }}
    >
      {label.name}
    </span>
  );
};

const CHECKS: Record<'success' | 'failure' | 'pending', { icon: React.ReactNode; label: string }> = {
  success: { icon: <CheckCircle2 size={12} className="text-emerald-400" />, label: 'CI grün' },
  failure: { icon: <CircleX size={12} className="text-red-300" />, label: 'CI rot' },
  pending: { icon: <CircleDashed size={12} className="text-yellow-400" />, label: 'CI läuft' },
};

export const CheckIcon: React.FC<{ state: BoardCheckState }> = ({ state }) =>
  state ? (
    <span title={CHECKS[state].label} aria-label={CHECKS[state].label} className="inline-flex">
      {CHECKS[state].icon}
    </span>
  ) : null;

export const ItemIcon: React.FC<{ item: BoardItem; size?: number }> = ({ item, size = 12 }) => {
  const closed = item.state === 'CLOSED' || item.state === 'MERGED';
  const tone = closed ? 'text-violet-300' : 'text-emerald-300';
  if (item.type === 'DraftIssue') return <CircleDashed size={size} className="text-gray-400" />;
  if (item.type === 'PullRequest') return <GitPullRequest size={size} className={tone} />;
  return closed ? (
    <CircleCheck size={size} className={tone} />
  ) : (
    <CircleDot size={size} className={tone} />
  );
};

/** Agent state glyph as in /agents; unknown when the job has no live session */
export const AgentGlyph: React.FC<{ session?: AgentSession }> = ({ session }) => {
  const g = session ? stateGlyph(session.displayState) : null;
  return (
    <span
      className={`w-3 text-center leading-none ${g ? g.className : 'text-gray-500'} ${g?.animate ? 'motion-safe:animate-pulse' : ''}`}
      title={g?.label ?? 'Keine laufende Session'}
      aria-hidden="true"
    >
      {g?.glyph ?? '∙'}
    </span>
  );
};

interface BoardCardProps {
  item: BoardItem;
  /** Hide the repo name when the board is already sliced to that repo */
  hideRepo: boolean;
  selected: boolean;
  agentIds: string[];
  sessionsById: Map<string, AgentSession>;
  onOpen: () => void;
  onAgent: (jobId: string) => void;
}

export const BoardCard: React.FC<BoardCardProps> = ({
  item,
  hideRepo,
  selected,
  agentIds,
  sessionsById,
  onOpen,
  onAgent,
}) => {
  const prs = item.pullRequests.filter((pr) => pr.url !== item.url);
  const self = item.type === 'PullRequest' ? item.pullRequests.find((pr) => pr.url === item.url) : null;
  return (
    <article
      draggable
      tabIndex={0}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, item.itemId);
        e.dataTransfer.effectAllowed = 'move';
        e.currentTarget.classList.add('opacity-40');
      }}
      onDragEnd={(e) => e.currentTarget.classList.remove('opacity-40')}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onOpen();
      }}
      className={`group cursor-grab rounded-md border border-gray-700 bg-gray-850 hover:border-gray-600 hover:bg-gray-800 px-2.5 py-2 shadow-[0_1px_2px_rgba(0,0,0,.25)] transition-colors ${selected ? 'ring-1 ring-cursor' : ''}`}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
        <ItemIcon item={item} />
        <span className="font-mono truncate">
          {item.number != null ? `${hideRepo ? '' : shortRepo(item.repo)}#${item.number}` : 'Entwurf'}
        </span>
        {self && <CheckIcon state={self.checks} />}
        {item.subIssues.total > 0 && (
          <span className="ml-auto flex items-center gap-1 tabular-nums" title="Sub-Issues erledigt">
            <ListChecks size={12} />
            {item.subIssues.completed}/{item.subIssues.total}
          </span>
        )}
      </div>
      <h3 className="mt-1 text-[13px] leading-snug text-gray-100 line-clamp-2">{item.title}</h3>
      {item.labels.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.labels.slice(0, 3).map((l) => (
            <LabelChip key={l.name} label={l} />
          ))}
        </div>
      )}
      {(agentIds.length > 0 || prs.length > 0) && (
        <div className="mt-2 pt-1.5 border-t border-gray-700/70 flex flex-wrap items-center gap-1.5">
          {agentIds.map((id) => (
            <button
              key={id}
              onClick={(e) => {
                e.stopPropagation();
                onAgent(id);
              }}
              className="flex items-center gap-1 text-[11px] px-1.5 py-px rounded bg-gray-950/50 border border-gray-700 text-gray-200 hover:border-cursor hover:text-white"
              title={`${sessionsById.get(id)?.name ?? id}: Board auf seine Issues filtern`}
            >
              <AgentGlyph session={sessionsById.get(id)} />
              <Bot size={12} />
              <span className="font-mono">{id}</span>
            </button>
          ))}
          {prs.map((pr) => (
            <span
              key={pr.url}
              className="flex items-center gap-1 text-[11px] text-gray-300"
              title={`${pr.repo}#${pr.number} ${pr.title ?? ''}`.trim()}
            >
              <GitPullRequest size={12} />#{pr.number}
              <CheckIcon state={pr.checks} />
            </span>
          ))}
        </div>
      )}
    </article>
  );
};
