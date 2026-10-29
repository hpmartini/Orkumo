import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, KanbanSquare, X } from 'lucide-react';
import type { AgentSession, IssueSummary } from '../../types';
import { fetchIssueSummary, setIssueLabels } from '../../services/boardApi';
import { deriveAgentLinks, itemKey } from '../../utils/board';
import { useDialogA11y } from '../CommandPalette/useDialogA11y';
import { useBoard } from './useBoard';
import { BoardItemPanel } from './BoardItemPanel';
import { LabelChip } from './BoardCard';
import { FlowControls } from './FlowControls';
import { IssueComments } from './IssueComments';
import type { IssueSave } from './IssueEditors';
import { useRepoOptions } from './IssueFields';
import { openCodeFor, sessionsByLinkId, startAgentOn } from './panelActions';

const boardUrl = (key: string) => `/board?item=${encodeURIComponent(key)}`;

/** "owner/name#12" -> parts, null if malformed */
const parseKey = (key: string) => {
  const m = /^([^/\s]+\/[^#\s]+)#(\d+)$/.exec(key);
  return m ? { repo: m[1], number: Number(m[2]) } : null;
};

/**
 * An issue as modal over the current view (#104): the board sidebar's controls, comments and
 * mw control buttons. Issues that are not on the board get the same minus status and board fields.
 */
export const IssueModal: React.FC<{
  issueKey: string;
  sessions: AgentSession[];
  onClose: () => void;
}> = ({ issueKey, sessions, onClose }) => {
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDivElement>(null);
  const trapTab = useDialogA11y(true, dialogRef, () =>
    dialogRef.current?.querySelector<HTMLElement>('button[aria-label^="Schließen"]')
  );
  const { data, error, moveItem, editIssue } = useBoard(true);
  const items = useMemo(() => data?.items ?? [], [data]);
  const item = items.find((i) => itemKey(i) === issueKey);
  const links = useMemo(
    () => deriveAgentLinks(items, sessions).filter((l) => l.issueKey === issueKey),
    [items, sessions, issueKey]
  );
  const sessionsById = useMemo(() => sessionsByLinkId(sessions), [sessions]);
  const openBoard = () => navigate(boardUrl(issueKey));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Issue ${issueKey}`}
        tabIndex={-1}
        onKeyDown={trapTab}
        className="outline-none max-w-full"
      >
        {item ? (
          <BoardItemPanel
            variant="modal"
            item={item}
            items={items}
            options={data?.statusField.options ?? []}
            links={links}
            sessionsById={sessionsById}
            onClose={onClose}
            onOpenBoard={openBoard}
            onStatus={(optionId) => moveItem(item.itemId, optionId)}
            onSave={(patch, optimistic) => editIssue(item.itemId, patch, optimistic)}
            onOpenKey={(key) => navigate(boardUrl(key))}
            onAttach={(jobId) => navigate(`/agents?attach=${encodeURIComponent(jobId)}`)}
            onStartAgent={(it) => startAgentOn(navigate, it)}
            onOpenCode={(jobIds) => openCodeFor(navigate, jobIds, sessionsById, item.repo)}
            onAgentIssues={(jobId) => navigate(`/board?agent=${encodeURIComponent(jobId)}`)}
          />
        ) : (
          <OffBoardIssue
            issueKey={issueKey}
            state={data || error ? 'missing' : 'loading'}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
};

/**
 * Fallback while the board loads or when the issue is not on it: title, body, labels, control
 * buttons and comments by issue number; status and board fields need the board item.
 */
const OffBoardIssue: React.FC<{
  issueKey: string;
  state: 'loading' | 'missing';
  onClose: () => void;
}> = ({ issueKey, state, onClose }) => {
  const ref = parseKey(issueKey);
  const [issue, setIssue] = useState<IssueSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { options: repoOptions } = useRepoOptions(issue?.repo ?? null);
  useEffect(() => {
    if (state !== 'missing' || !ref) return;
    let alive = true;
    fetchIssueSummary(ref.repo, ref.number)
      .then((i) => alive && setIssue(i))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Fehler'));
    return () => {
      alive = false;
    };
  }, [state, ref?.repo, ref?.number]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const saveLabels: IssueSave = async (patch) => {
    if (!issue || !patch.labels) return false;
    try {
      setIssue(await setIssueLabels(issue.issueId, patch.labels));
      setError(null);
      return true;
    } catch (e) {
      setError(`Labels nicht gespeichert: ${e instanceof Error ? e.message : 'Fehler'}`);
      return false;
    }
  };

  return (
    <section className="w-[640px] max-w-full max-h-[85vh] flex flex-col bg-gray-900 border border-gray-700 rounded-lg">
      <div className="flex items-center gap-2 px-4 h-12 border-b border-gray-700 shrink-0">
        <span className="font-mono text-xs text-gray-400 truncate">{issueKey}</span>
        <div className="flex-1" />
        <button
          disabled
          title="Issue ist nicht auf dem Board"
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-300 disabled:opacity-40"
        >
          <KanbanSquare size={14} />
          Board
        </button>
        {ref && (
          <a
            href={`https://github.com/${ref.repo}/issues/${ref.number}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-300 hover:text-white hover:bg-gray-800"
          >
            <ExternalLink size={14} />
            GitHub
          </a>
        )}
        <button
          onClick={onClose}
          className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cursor"
          aria-label="Schließen (Esc)"
          title="Schließen (Esc)"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scrollbar px-4 py-4 space-y-4">
        {state === 'loading' ? (
          <p className="text-xs text-gray-400">Board wird geladen…</p>
        ) : (
          <>
            <p className="text-xs text-gray-400">
              Nicht auf dem Board: Status und Board-Felder nur dort.
            </p>
            {error && <p className="text-xs text-red-400">{error}</p>}
            {issue && (
              <>
                <h2 className="text-base font-semibold text-white">
                  {issue.title}
                  {issue.state === 'CLOSED' && (
                    <span className="ml-2 text-xs font-normal text-gray-400">geschlossen</span>
                  )}
                </h2>
                {issue.labels.length > 0 && (
                  <div className="flex flex-wrap gap-1" aria-label="Labels">
                    {issue.labels.map((l) => (
                      <LabelChip key={l.name} label={l} />
                    ))}
                  </div>
                )}
                <FlowControls labels={issue.labels} repoOptions={repoOptions} onSave={saveLabels} />
                {issue.body && (
                  <div className="rounded-md border border-gray-700 bg-gray-850 px-3 py-2 text-xs text-gray-200 whitespace-pre-wrap break-words">
                    {issue.body}
                  </div>
                )}
                <IssueComments issueId={issue.issueId} />
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
};
