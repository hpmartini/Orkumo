import React, { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import type { BoardItem, BoardStatusOption } from '../../types';
import { createBoardIssue, errorDetails } from '../../services/boardApi';
import { useDialogA11y } from '../CommandPalette/useDialogA11y';
import { LabelChip } from './BoardCard';
import {
  FIELD_INPUT,
  FieldPicker,
  assigneeChoices,
  labelChoices,
  labelsFor,
  milestoneChoices,
  useRepoOptions,
} from './IssueFields';

const LAST_REPO_KEY = 'devOrbitLastIssueRepo';

/** Repo used for the last created issue, if it is still among `repos` */
export function lastIssueRepo(repos: string[]): string | null {
  try {
    const last = localStorage.getItem(LAST_REPO_KEY);
    return last && repos.includes(last) ? last : null;
  } catch {
    return null;
  }
}

interface IssueCreateModalProps {
  /** Preselected repository ("owner/name") */
  repo: string | null;
  /** Choosable repositories; without them the repo is fixed */
  repos?: string[];
  /** Status options of the board; without them the server picks "Backlog" */
  statusOptions?: BoardStatusOption[];
  statusOptionId?: string;
  onClose: () => void;
  /** Called with the new item; the caller gives the success feedback */
  onCreated: (item: BoardItem) => void;
}

/** "New issue" dialog: creates a GitHub issue and puts it on the board project. */
export const IssueCreateModal: React.FC<IssueCreateModalProps> = ({
  repo: initialRepo,
  repos,
  statusOptions,
  statusOptionId: initialStatus,
  onClose,
  onCreated,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const trapTab = useDialogA11y(true, dialogRef, () => titleRef.current);
  const [repo, setRepo] = useState(initialRepo ?? repos?.[0] ?? '');
  const [statusOptionId, setStatusOptionId] = useState(
    initialStatus ?? statusOptions?.find((o) => o.name.toLowerCase() === 'backlog')?.id ?? ''
  );
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [milestone, setMilestone] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // Issue exists on GitHub but the project step failed: the next submit only retries that step
  const [orphan, setOrphan] = useState<{ id: string; url: string | null } | null>(null);
  const { options, error } = useRepoOptions(repo || null);

  const changeRepo = (next: string) => {
    setRepo(next);
    // Names belong to the old repo
    setLabels([]);
    setAssignees([]);
    setMilestone([]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repo || !title.trim() || saving) return;
    setSaving(true);
    try {
      const item = await createBoardIssue({
        repo,
        title: title.trim(),
        body,
        labels,
        assignees,
        milestone: milestone[0] ?? null,
        ...(statusOptionId ? { statusOptionId } : {}),
        ...(orphan ? { issueId: orphan.id } : {}),
      });
      try {
        localStorage.setItem(LAST_REPO_KEY, repo);
      } catch {
        // preset is a convenience only
      }
      onCreated(item);
      onClose();
    } catch (err) {
      const issue = errorDetails(err).issue as { id?: string; url?: string | null } | undefined;
      if (issue?.id) setOrphan((o) => ({ id: issue.id!, url: issue.url ?? o?.url ?? null }));
      toast.error(err instanceof Error ? err.message : 'Issue nicht angelegt');
      setSaving(false);
    }
  };

  const none = <span className="text-gray-400">keine</span>;
  return (
    <div
      className="fixed inset-0 z-[90] bg-gray-950/70 flex items-start justify-center px-4 pt-[10vh]"
      onMouseDown={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-create-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          trapTab(e);
          if (e.key === 'Escape' && !e.defaultPrevented) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[620px] bg-gray-800 border border-gray-600 rounded-xl shadow-2xl p-4"
      >
        <form onSubmit={submit}>
          <div className="flex items-center mb-3">
            <h2 id="issue-create-title" className="text-sm font-semibold text-gray-50">
              Neues Issue
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto p-1.5 rounded-md text-gray-200 hover:bg-gray-700 hover:text-white focus-visible:outline-2 focus-visible:outline-blue-400"
              aria-label="Schließen"
            >
              <X size={15} />
            </button>
          </div>

          <div className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 items-center text-xs">
            <label htmlFor="issue-create-repo" className="text-gray-400">
              Repository
            </label>
            {repos && repos.length > 1 ? (
              <select
                id="issue-create-repo"
                value={repo}
                disabled={!!orphan}
                onChange={(e) => changeRepo(e.target.value)}
                className={FIELD_INPUT}
              >
                {repos.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            ) : (
              <span id="issue-create-repo" className="font-mono text-gray-200">
                {repo || '–'}
              </span>
            )}

            {statusOptions && statusOptions.length > 0 && (
              <>
                <label htmlFor="issue-create-status" className="text-gray-400">
                  Status
                </label>
                <select
                  id="issue-create-status"
                  value={statusOptionId}
                  onChange={(e) => setStatusOptionId(e.target.value)}
                  className={FIELD_INPUT}
                >
                  {!statusOptionId && <option value="">Backlog (Standard)</option>}
                  {statusOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </>
            )}

            <label htmlFor="issue-create-name" className="text-gray-400">
              Titel
            </label>
            <input
              id="issue-create-name"
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={256}
              required
              disabled={!!orphan}
              placeholder="Was soll passieren?"
              className={FIELD_INPUT}
            />

            <label htmlFor="issue-create-body" className="text-gray-400 self-start pt-1">
              Beschreibung
            </label>
            <textarea
              id="issue-create-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={7}
              disabled={!!orphan}
              placeholder="Markdown"
              className={`${FIELD_INPUT} font-mono resize-y`}
            />

            <span className="text-gray-400">Labels</span>
            <FieldPicker
              disabled={!!orphan}
              label="Labels"
              multi
              choices={labelChoices(options)}
              value={labels}
              onChange={setLabels}
              display={
                labels.length
                  ? labelsFor(labels, options).map((l) => <LabelChip key={l.name} label={l} />)
                  : none
              }
            />
            <span className="text-gray-400">Assignees</span>
            <FieldPicker
              disabled={!!orphan}
              label="Assignees"
              multi
              choices={assigneeChoices(options)}
              value={assignees}
              onChange={setAssignees}
              display={assignees.length ? assignees.join(', ') : none}
            />
            <span className="text-gray-400">Milestone</span>
            <FieldPicker
              disabled={!!orphan}
              label="Milestone"
              choices={milestoneChoices(options)}
              value={milestone}
              onChange={setMilestone}
              display={milestone[0] ?? none}
            />
          </div>

          {error && <p className="mt-2 text-xs text-red-300">Auswahl nicht geladen: {error}</p>}
          {orphan && (
            <p role="status" className="mt-3 text-xs text-amber-200">
              Das Issue ist auf GitHub angelegt
              {orphan.url && (
                <>
                  {' '}
                  (
                  <a
                    href={orphan.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    öffnen
                  </a>
                  )
                </>
              )}
              , steht aber noch nicht auf dem Board. „Erneut aufs Board setzen“ wiederholt nur
              diesen Schritt, ohne ein zweites Issue anzulegen.
            </p>
          )}
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs text-gray-300 hover:text-white hover:bg-gray-700"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={!repo || !title.trim() || saving}
              className="px-3 py-1.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Lege an …' : orphan ? 'Erneut aufs Board setzen' : 'Issue anlegen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
