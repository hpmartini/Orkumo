import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot,
  Code2,
  ExternalLink,
  Funnel,
  KanbanSquare,
  GitPullRequest,
  ListChecks,
  Play,
  Terminal,
  X,
} from 'lucide-react';
import type { AgentSession, BoardIssueDetails, BoardItem, BoardStatusOption } from '../../types';
import { fetchIssueDetails } from '../../services/boardApi';
import { issueKey, itemKey, type AgentIssueLink } from '../../utils/board';
import { AgentGlyph, CheckIcon, ItemIcon, LabelChip } from './BoardCard';
import {
  FieldPicker,
  assigneeChoices,
  labelChoices,
  labelsFor,
  milestoneChoices,
  useRepoOptions,
} from './IssueFields';
import {
  AddSubIssue,
  EditableTitle,
  IssueBody,
  IssueStateSelect,
  ParentEditor,
  type IssueSave,
} from './IssueEditors';
import { FlowControls } from './FlowControls';
import { IssueComments } from './IssueComments';

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
  /** Opens the agent task composer prefilled with this issue */
  onStartAgent: (item: BoardItem) => void;
  /** Opens the Code mode in the folder of the first of these agents, else the issue's repo */
  onOpenCode: (jobIds: string[]) => void;
  /** Edits this item's issue (only issues, not PRs or drafts) */
  onSave: IssueSave;
  /** Modal: centered dialog (issue modal of the agents view) instead of the board sidebar */
  variant?: 'sidebar' | 'modal';
  /** Shown as "Board" button (modal only) */
  onOpenBoard?: () => void;
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
  onStartAgent,
  onOpenCode,
  onSave,
  variant = 'sidebar',
  onOpenBoard,
}) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const key = itemKey(item);
  const editable = !!item.issueId;
  const { options: repoOptions } = useRepoOptions(editable ? item.repo : null);
  const [details, setDetails] = useState<BoardIssueDetails | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const issueId = item.issueId;
  const loadDetails = useCallback(() => {
    if (!issueId) return () => {};
    let alive = true;
    fetchIssueDetails(issueId)
      .then((d) => alive && (setDetails(d), setDetailsError(null)))
      .catch((e) => alive && setDetailsError(e instanceof Error ? e.message : 'Fehler'));
    return () => {
      alive = false;
    };
  }, [issueId]);
  useEffect(() => {
    setDetails(null);
    setDetailsError(null);
    return loadDetails();
  }, [loadDetails]);
  // Body and sub-issue list live outside the board item: reload them after such edits
  const save: IssueSave = async (patch, optimistic) => {
    const ok = await onSave(patch, optimistic);
    if (ok && (patch.body !== undefined || patch.addSubIssue || patch.removeSubIssue))
      loadDetails();
    return ok;
  };
  const none = <Muted>keine</Muted>;
  const subs = items.filter((i) => i.parent && issueKey(i.parent.repo, i.parent.number) === key);
  const statusName = (id: string | null) => options.find((o) => o.id === id)?.name ?? '–';
  const parentKey = item.parent ? issueKey(item.parent.repo, item.parent.number) : null;
  const parentOnBoard = !!parentKey && items.some((i) => itemKey(i) === parentKey);
  const parentView = item.parent ? (
    <button
      onClick={() => parentKey && onOpenKey(parentKey)}
      disabled={!parentOnBoard}
      className="text-left enabled:hover:text-white"
      title={parentOnBoard ? 'Parent öffnen' : 'Parent ist nicht auf dem Board'}
    >
      <span className="font-mono text-gray-400">#{item.parent.number}</span> {item.parent.title}
    </button>
  ) : (
    <Muted>keiner</Muted>
  );

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
      className={
        variant === 'modal'
          ? 'w-[640px] max-w-full max-h-[85vh] flex flex-col bg-gray-900 border border-gray-700 rounded-lg shadow-[0_0_40px_-8px_rgba(0,0,0,.6)]'
          : 'absolute top-0 right-0 z-20 h-full w-[420px] max-w-full flex flex-col bg-gray-900 border-l border-gray-700 shadow-[0_0_40px_-8px_rgba(0,0,0,.6)]'
      }
      aria-label="Issue-Details"
    >
      <div className="flex items-center gap-2 px-4 h-12 border-b border-gray-700 shrink-0">
        <ItemIcon item={item} size={16} />
        <span className="font-mono text-xs text-gray-400 truncate">
          {item.number != null ? `${item.repo}#${item.number}` : 'Entwurf'}
        </span>
        <div className="flex-1" />
        {onOpenBoard && (
          <button
            onClick={onOpenBoard}
            title="Im Board öffnen"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-300 hover:text-white hover:bg-gray-800"
          >
            <KanbanSquare size={14} />
            Board
          </button>
        )}
        <button
          onClick={() => onOpenCode(links.map((l) => l.jobId))}
          disabled={!item.repo && !links.length}
          title={
            item.repo || links.length
              ? 'Im Code-Modus öffnen (Worktree des Agents, sonst Repo)'
              : 'Kein Repo und kein Agent verknüpft'
          }
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-300 hover:text-white hover:bg-gray-800 disabled:opacity-40 disabled:pointer-events-none"
        >
          <Code2 size={14} />
          Code
        </button>
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
        <EditableTitle title={item.title} editable={editable} onSave={save} />
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
          {editable && (
            <>
              <dt className="text-gray-400">Zustand</dt>
              <dd>
                <IssueStateSelect item={item} onSave={save} />
              </dd>
            </>
          )}
          <dt className="text-gray-400">Projekt</dt>
          <dd className="text-gray-200">{item.repo ?? <Muted>–</Muted>}</dd>
          <dt className="text-gray-400">Labels</dt>
          <dd className="flex flex-wrap gap-1 min-w-0">
            {editable ? (
              <FieldPicker
                label="Labels"
                multi
                choices={labelChoices(repoOptions)}
                value={item.labels.map((l) => l.name)}
                onChange={(names) =>
                  save({ labels: names }, { labels: labelsFor(names, repoOptions) })
                }
                display={
                  item.labels.length
                    ? item.labels.map((l) => <LabelChip key={l.name} label={l} />)
                    : none
                }
              />
            ) : item.labels.length ? (
              item.labels.map((l) => <LabelChip key={l.name} label={l} />)
            ) : (
              none
            )}
          </dd>
          <dt className="text-gray-400">Parent</dt>
          <dd className="text-gray-200 min-w-0">
            {editable ? (
              <ParentEditor item={item} onSave={save}>
                {parentView}
              </ParentEditor>
            ) : (
              parentView
            )}
          </dd>
          {(editable || item.milestone) && (
            <>
              <dt className="text-gray-400">Milestone</dt>
              <dd className="text-gray-200 min-w-0">
                {editable ? (
                  <FieldPicker
                    label="Milestone"
                    choices={milestoneChoices(repoOptions)}
                    value={item.milestone ? [item.milestone] : []}
                    onChange={([m = null]) => save({ milestone: m }, { milestone: m })}
                    display={item.milestone ?? none}
                  />
                ) : (
                  item.milestone
                )}
              </dd>
            </>
          )}
          {(editable || item.assignees.length > 0) && (
            <>
              <dt className="text-gray-400">Assignees</dt>
              <dd className="text-gray-200 min-w-0">
                {editable ? (
                  <FieldPicker
                    label="Assignees"
                    multi
                    choices={assigneeChoices(repoOptions)}
                    value={item.assignees}
                    onChange={(logins) => save({ assignees: logins }, { assignees: logins })}
                    display={item.assignees.length ? item.assignees.join(', ') : none}
                  />
                ) : (
                  item.assignees.join(', ')
                )}
              </dd>
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

        {editable && <FlowControls item={item} repoOptions={repoOptions} onSave={save} />}

        {editable && <IssueBody body={details?.body ?? null} error={detailsError} onSave={save} />}

        {issueId && <IssueComments issueId={issueId} />}

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
                        onClick={() => onOpenCode([link.jobId])}
                        disabled={!session}
                        title={session ? session.cwd : 'Keine laufende Session'}
                        className="flex items-center gap-1 px-2 py-1 rounded text-gray-300 text-xs hover:text-white hover:bg-gray-800 disabled:opacity-40 disabled:pointer-events-none"
                      >
                        <Code2 size={14} />
                        Code
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
            <div className="rounded-md border border-dashed border-gray-700 px-3 py-3 text-xs text-gray-400 flex items-center gap-2">
              Kein Agent verknüpft.
              {item.url && (
                <button
                  onClick={() => onStartAgent(item)}
                  className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-gray-200 hover:text-white hover:bg-gray-800 transition-colors"
                >
                  <Play size={14} />
                  Agent starten
                </button>
              )}
            </div>
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

        {(editable || subs.length > 0) && (
          <section>
            <h3 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1.5">
              <ListChecks size={14} />
              Sub-Issues{' '}
              <span className="font-normal text-gray-400">
                {item.subIssues.completed}/{item.subIssues.total || subs.length}
              </span>
            </h3>
            <ul className="space-y-1 text-xs">
              {(details?.subIssues ?? subs.map((s) => ({ ...s, id: s.issueId ?? s.itemId })))
                .filter((s) => s.number != null)
                .map((s) => {
                  const subKey = issueKey(s.repo ?? '', s.number as number);
                  const onBoard = items.find((i) => itemKey(i) === subKey);
                  return (
                    <li key={s.id} className="group flex items-center gap-2">
                      <button
                        onClick={() => onOpenKey(subKey)}
                        disabled={!onBoard}
                        className="flex-1 min-w-0 flex items-center gap-2 text-left text-gray-200 enabled:hover:text-white"
                        title={onBoard ? 'Sub-Issue öffnen' : 'Nicht auf dem Board'}
                      >
                        <span className="font-mono text-gray-400">#{s.number}</span>
                        <span className="flex-1 truncate">{s.title}</span>
                        <span className="text-gray-400">
                          {onBoard ? statusName(onBoard.statusOptionId) : s.state.toLowerCase()}
                        </span>
                      </button>
                      {editable && details && (
                        <button
                          onClick={() => save({ removeSubIssue: s.id })}
                          className="p-0.5 rounded text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          aria-label={`#${s.number} als Sub-Issue entfernen`}
                          title="Als Sub-Issue entfernen"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </li>
                  );
                })}
            </ul>
            {editable && <AddSubIssue repo={item.repo} onSave={save} />}
          </section>
        )}
      </div>
    </aside>
  );
};
