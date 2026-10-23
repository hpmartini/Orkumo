import React, { useEffect, useRef } from 'react';
import { Bot, ExternalLink, Funnel, GitPullRequest, ListChecks, Terminal, X } from 'lucide-react';
import type { AgentSession, BoardItem, BoardStatusOption } from '../../types';
import { issueKey, itemKey, type AgentIssueLink } from '../../utils/board';
import { AgentGlyph, CheckIcon, ItemIcon, LabelChip } from './BoardCard';

const VIA: Record<AgentIssueLink['via'], string> = {
  'mw-board': 'mw-board-Kommentar',
  pr: 'verlinkten PR',
};

interface BoardItemPanelProps {
  item: BoardItem;
  items: BoardItem[];
  options: BoardStatusOption[];
  links: AgentIssueLink[];
  sessionsById: Map<string, AgentSession>;
  onClose: () => void;
  onStatus: (optionId: string) => void;
  onOpenKey: (key: string) => void;
  onAttach: (jobId: string) => void;
  onAgentIssues: (jobId: string) => void;
}

const Muted: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-gray-400">{children}</span>
);

export const BoardItemPanel: React.FC<BoardItemPanelProps> = ({
  item,
  items,
  options,
  links,
  sessionsById,
  onClose,
  onStatus,
  onOpenKey,
  onAttach,
  onAgentIssues,
}) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const key = itemKey(item);
  const subs = items.filter(
    (i) => i.parent && issueKey(i.parent.repo, i.parent.number) === key
  );
  const statusName = (id: string | null) => options.find((o) => o.id === id)?.name ?? '–';
  const parentKey = item.parent ? issueKey(item.parent.repo, item.parent.number) : null;
  const parentOnBoard = !!parentKey && items.some((i) => itemKey(i) === parentKey);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, key]);

  return (
    <aside
      className="absolute top-0 right-0 z-20 h-full w-[420px] max-w-full flex flex-col bg-gray-900 border-l border-gray-700 shadow-[0_0_40px_-8px_rgba(0,0,0,.6)]"
      aria-label="Issue-Details"
    >
      <div className="flex items-center gap-2 px-4 h-12 border-b border-gray-700 shrink-0">
        <ItemIcon item={item} size={16} />
        <span className="font-mono text-xs text-gray-400 truncate">
          {item.number != null ? `${item.repo}#${item.number}` : 'Entwurf'}
        </span>
        <div className="flex-1" />
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-300 hover:text-white hover:bg-gray-800"
          >
            <ExternalLink size={14} />
            GitHub
          </a>
        )}
        <button
          ref={closeRef}
          onClick={onClose}
          className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
          aria-label="Schließen (Esc)"
          title="Schließen (Esc)"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto thin-scrollbar px-4 py-4 space-y-5">
        <h2 className="text-base font-semibold text-white leading-snug text-balance">{item.title}</h2>
        <dl className="grid grid-cols-[96px_1fr] gap-y-2 text-xs items-center">
          <dt className="text-gray-400">Status</dt>
          <dd>
            <select
              value={item.statusOptionId ?? ''}
              onChange={(e) => e.target.value && onStatus(e.target.value)}
              className="bg-gray-850 border border-gray-700 rounded px-2 py-1 text-gray-100"
              aria-label="Status"
            >
              {!item.statusOptionId && <option value="">Ohne Status</option>}
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </dd>
          <dt className="text-gray-400">Projekt</dt>
          <dd className="text-gray-200">{item.repo ?? <Muted>–</Muted>}</dd>
          <dt className="text-gray-400">Labels</dt>
          <dd className="flex flex-wrap gap-1">
            {item.labels.length ? (
              item.labels.map((l) => <LabelChip key={l.name} label={l} />)
            ) : (
              <Muted>keine</Muted>
            )}
          </dd>
          <dt className="text-gray-400">Parent</dt>
          <dd className="text-gray-200 min-w-0">
            {item.parent ? (
              <button
                onClick={() => parentKey && onOpenKey(parentKey)}
                disabled={!parentOnBoard}
                className="text-left enabled:hover:text-white"
                title={parentOnBoard ? 'Parent öffnen' : 'Parent ist nicht auf dem Board'}
              >
                <span className="font-mono text-gray-400">#{item.parent.number}</span>{' '}
                {item.parent.title}
              </button>
            ) : (
              <Muted>keiner</Muted>
            )}
          </dd>
          {item.milestone && (
            <>
              <dt className="text-gray-400">Milestone</dt>
              <dd className="text-gray-200">{item.milestone}</dd>
            </>
          )}
          {item.assignees.length > 0 && (
            <>
              <dt className="text-gray-400">Assignees</dt>
              <dd className="text-gray-200">{item.assignees.join(', ')}</dd>
            </>
          )}
          <dt className="text-gray-400">Aktualisiert</dt>
          <dd className="text-gray-200 tabular-nums">
            {new Date(item.updatedAt).toLocaleString('de-DE', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </dd>
        </dl>

        <section>
          <h3 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1.5">
            <Bot size={14} />
            Agents an diesem Issue <span className="font-normal text-gray-400">{links.length}</span>
          </h3>
          {links.length ? (
            <ul className="space-y-1.5">
              {links.map((link) => {
                const session = sessionsById.get(link.jobId);
                return (
                  <li
                    key={link.jobId}
                    className="rounded-md border border-gray-700 bg-gray-850 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <AgentGlyph session={session} />
                      <span className="flex-1 min-w-0 truncate text-gray-100">
                        {session?.name ?? link.jobId}
                      </span>
                      <span className="font-mono text-[11px] text-gray-400">{link.jobId}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-gray-400">
                      verknüpft über {VIA[link.via]}
                      {!session && ' · keine laufende Session'}
                    </div>
                    <div className="mt-2 flex gap-1.5">
                      <button
                        onClick={() => onAttach(link.jobId)}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-sel text-white text-xs hover:bg-gray-750"
                      >
                        <Terminal size={14} />
                        Öffnen
                      </button>
                      <button
                        onClick={() => onAgentIssues(link.jobId)}
                        className="flex items-center gap-1 px-2 py-1 rounded text-gray-300 text-xs hover:text-white hover:bg-gray-800"
                      >
                        <Funnel size={14} />
                        Seine Issues
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-md border border-dashed border-gray-700 px-3 py-3 text-xs text-gray-400">
              Kein Agent verknüpft.
            </p>
          )}
        </section>

        <section>
          <h3 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1.5">
            <GitPullRequest size={14} />
            Pull Requests{' '}
            <span className="font-normal text-gray-400">{item.pullRequests.length}</span>
          </h3>
          {item.pullRequests.length ? (
            <ul className="space-y-1 text-xs">
              {item.pullRequests.map((pr) => (
                <li key={pr.url} className="flex items-center gap-2 text-gray-200">
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 min-w-0 flex items-center gap-2 hover:text-white"
                  >
                    <span className="font-mono text-gray-400">#{pr.number}</span>
                    <span className="truncate">{pr.title ?? pr.repo}</span>
                  </a>
                  <span className="text-[11px] text-gray-400">{pr.state.toLowerCase()}</span>
                  <CheckIcon state={pr.checks} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-400">Noch kein PR.</p>
          )}
        </section>

        {subs.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1.5">
              <ListChecks size={14} />
              Sub-Issues{' '}
              <span className="font-normal text-gray-400">
                {item.subIssues.completed}/{item.subIssues.total || subs.length}
              </span>
            </h3>
            <ul className="space-y-1 text-xs">
              {subs.map((s) => (
                <li key={s.itemId}>
                  <button
                    onClick={() => onOpenKey(itemKey(s))}
                    className="w-full flex items-center gap-2 text-left text-gray-200 hover:text-white"
                  >
                    <span className="font-mono text-gray-400">#{s.number}</span>
                    <span className="flex-1 truncate">{s.title}</span>
                    <span className="text-gray-400">{statusName(s.statusOptionId)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
};
