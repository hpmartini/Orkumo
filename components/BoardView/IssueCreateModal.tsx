import React, { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import type { BoardItem, BoardStatusOption } from '../../types';
import { createBoardIssue, errorDetails, uploadIssueImage } from '../../services/boardApi';
import { useDialogA11y } from '@hpmartini/agents-ui/components/CommandPalette/useDialogA11y';
import {
  ImageAttachments,
  imageDropHandlers,
} from '@hpmartini/agents-ui/components/ImageAttachments';
import { bodyWithImages, submitIntent } from '@hpmartini/agents-ui/utils/composer';
import { LabelChip } from './BoardCard';
import { Choice } from '@hpmartini/agents-ui/components/Choice';
import {
  NewKindTabs,
  type NewKind,
} from '@hpmartini/agents-ui/components/AgentsView/NewTaskButton';
import {
  FIELD_INPUT,
  FieldPicker,
  assigneeChoices,
  labelChoices,
  labelsFor,
  milestoneChoices,
  NO_MILESTONE,
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

/**
 * Repositories a title of the form `#text` picks from (#228, like GitHub Projects' add bar):
 * null unless the whole title is that one token. Matches on the repo name come first.
 */
export function repoHashMatches(title: string, repos: string[]): string[] | null {
  const query = /^#(\S*)$/.exec(title)?.[1].toLowerCase();
  if (query === undefined) return null;
  const name = (r: string) => r.slice(r.indexOf('/') + 1).toLowerCase();
  return [
    ...repos.filter((r) => name(r).startsWith(query)),
    ...repos.filter((r) => !name(r).startsWith(query) && r.toLowerCase().includes(query)),
  ];
}

/** What moves along when the user switches between the "new" dialogs (#271) */
export interface IssueDraft {
  title: string;
  body: string;
  images: File[];
}

interface IssueCreateModalProps {
  /** Preselected repository ("owner/name") */
  repo: string | null;
  /** Choosable repositories; without them the repo is fixed */
  repos?: string[];
  /** Status options of the board; without them the server picks "Backlog" */
  statusOptions?: BoardStatusOption[];
  statusOptionId?: string;
  /** Text and images typed in another "new" dialog */
  draft?: IssueDraft;
  /** Shows the Task/Agent/Chat/Issue switch; called with the current draft (#271) */
  onKindChange?: (kind: Exclude<NewKind, 'issue'>, draft: IssueDraft) => void;
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
  draft,
  onKindChange,
  onClose,
  onCreated,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const trapTab = useDialogA11y(true, dialogRef, () => titleRef.current);
  const [repo, setRepo] = useState(initialRepo ?? repos?.[0] ?? '');
  const [statusOptionId, setStatusOptionId] = useState(
    initialStatus ?? statusOptions?.find((o) => o.name.toLowerCase() === 'backlog')?.id ?? ''
  );
  const [title, setTitle] = useState(draft?.title ?? '');
  const [body, setBody] = useState(draft?.body ?? '');
  const [labels, setLabels] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [milestone, setMilestone] = useState<string[]>([]);
  const [images, setImages] = useState<File[]>(draft?.images ?? []);
  const [saving, setSaving] = useState(false);
  // Issue exists on GitHub but the project step failed: the next submit only retries that step
  const [orphan, setOrphan] = useState<{ id: string; url: string | null } | null>(null);
  const { options, error } = useRepoOptions(repo || null);

  // `#` in the empty title picks the repository (#228); Escape hides the list until the title changes
  const [hash, setHash] = useState({ index: 0, hidden: false });
  const hashRepos =
    repos && repos.length > 1 && !orphan && !hash.hidden ? repoHashMatches(title, repos) : null;

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
    let fullBody = body;
    if (images.length && !orphan) {
      try {
        // One after another: parallel commits to issue-assets collide (409/422)
        const urls: string[] = [];
        for (const f of images) urls.push(await uploadIssueImage(repo, f));
        // Uploaded once: a retry after a failed create must not upload them again
        fullBody = bodyWithImages(body, urls);
        setBody(fullBody);
        setImages([]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Images not uploaded');
        setSaving(false);
        return;
      }
    }
    try {
      const item = await createBoardIssue({
        repo,
        title: title.trim(),
        body: fullBody,
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
      toast.error(err instanceof Error ? err.message : 'Issue not created');
      setSaving(false);
    }
  };

  const none = <span className="text-gray-400">none</span>;
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
          if (submitIntent(e)) {
            e.preventDefault();
            formRef.current?.requestSubmit();
            return;
          }
          if (e.key === 'Escape' && !e.defaultPrevented) {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        onMouseDown={(e) => e.stopPropagation()}
        {...(orphan ? {} : imageDropHandlers((files) => setImages((prev) => [...prev, ...files])))}
        className="w-full max-w-[620px] bg-gray-800 border border-gray-600 rounded-xl shadow-2xl p-4"
      >
        <form ref={formRef} onSubmit={submit}>
          <div className="flex items-center mb-3">
            <h2 id="issue-create-title" className="text-sm font-semibold text-gray-50">
              New issue
            </h2>
            {onKindChange && (
              <div className="ml-3">
                <NewKindTabs
                  kind="issue"
                  // the issue may already exist (orphan) or be on its way
                  disabled={saving || !!orphan}
                  onChange={(kind) =>
                    kind !== 'issue' && onKindChange(kind, { title, body, images })
                  }
                />
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="ml-auto p-1.5 rounded-md text-gray-200 hover:bg-gray-700 hover:text-white focus-visible:outline-2 focus-visible:outline-blue-400"
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </div>

          <div className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 items-center text-xs">
            <label htmlFor="issue-create-repo" className="text-gray-400">
              Repository
            </label>
            {repos && repos.length > 1 ? (
              <Choice
                id="issue-create-repo"
                value={repo}
                disabled={!!orphan}
                onChange={changeRepo}
                options={repos.map((r) => ({ value: r, label: r }))}
                label="Repository"
                className="w-full"
              />
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
                <Choice
                  id="issue-create-status"
                  value={statusOptionId}
                  onChange={setStatusOptionId}
                  options={statusOptions.map((o) => ({ value: o.id, label: o.name }))}
                  label="Status"
                  placeholder="Backlog (default)"
                  className="w-full"
                />
              </>
            )}

            <label htmlFor="issue-create-name" className="text-gray-400">
              Title
            </label>
            <div className="relative">
              <input
                id="issue-create-name"
                ref={titleRef}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setHash({ index: 0, hidden: false });
                }}
                onKeyDown={(e) => {
                  if (hashRepos) {
                    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
                    const pick = hashRepos[hash.index];
                    if (step && hashRepos.length) {
                      e.preventDefault();
                      const index = (hash.index + step + hashRepos.length) % hashRepos.length;
                      setHash({ index, hidden: false });
                    } else if ((e.key === 'Enter' || e.key === 'Tab') && pick) {
                      e.preventDefault();
                      e.stopPropagation();
                      if (pick !== repo) changeRepo(pick);
                      setTitle('');
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setHash({ index: 0, hidden: true });
                    }
                  }
                  // Only Cmd/Ctrl+Enter submits (#105), so a stray Enter cannot create the issue
                  if (e.key === 'Enter' && !submitIntent(e)) e.preventDefault();
                }}
                maxLength={256}
                required
                disabled={!!orphan}
                placeholder={
                  repos && repos.length > 1
                    ? 'What should happen? (# picks the repository)'
                    : 'What should happen?'
                }
                role="combobox"
                aria-expanded={!!hashRepos}
                aria-controls="issue-create-repo-list"
                aria-activedescendant={
                  hashRepos?.length ? `issue-create-repo-option-${hash.index}` : undefined
                }
                aria-autocomplete="list"
                autoComplete="off"
                className={FIELD_INPUT}
              />
              {hashRepos && (
                <ul
                  id="issue-create-repo-list"
                  role="listbox"
                  aria-label="Repository"
                  className="absolute z-10 left-0 right-0 top-full mt-1 max-h-56 overflow-y-auto bg-gray-850 border border-gray-600 rounded shadow-xl py-1"
                >
                  {hashRepos.length === 0 && (
                    <li className="px-2 py-1 text-gray-400">No matching repository</li>
                  )}
                  {hashRepos.map((r, i) => (
                    <li
                      key={r}
                      id={`issue-create-repo-option-${i}`}
                      role="option"
                      aria-selected={i === hash.index}
                      // mousedown: the input keeps the focus
                      onMouseDown={(e) => {
                        e.preventDefault();
                        if (r !== repo) changeRepo(r);
                        setTitle('');
                      }}
                      className={`px-2 py-1 font-mono cursor-pointer ${
                        i === hash.index
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-200 hover:bg-gray-700'
                      }`}
                    >
                      {r}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <label htmlFor="issue-create-body" className="text-gray-400 self-start pt-1">
              Description
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

            <span className="text-gray-400 self-start pt-3">Images</span>
            <ImageAttachments
              images={images}
              onChange={setImages}
              disabled={!!orphan || saving}
              note={
                images.length
                  ? `Uploaded to ${repo || 'the repo'} (branch issue-assets); as visible as the repo`
                  : undefined
              }
            />

            <span className="text-gray-400">Labels</span>
            <FieldPicker
              boxed
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
              boxed
              disabled={!!orphan}
              label="Assignees"
              multi
              choices={assigneeChoices(options)}
              value={assignees}
              onChange={setAssignees}
              display={assignees.length ? assignees.join(', ') : none}
            />
            <span className="text-gray-400">Milestone</span>
            <Choice
              disabled={!!orphan || !options}
              label="Milestone"
              value={milestone[0] ?? ''}
              onChange={(v) => setMilestone(v ? [v] : [])}
              options={[NO_MILESTONE, ...(milestoneChoices(options) ?? [])]}
              title={options ? undefined : 'Loading options…'}
              mode={options ? 'auto' : 'menu'}
            />
          </div>

          {error && <p className="mt-2 text-xs text-red-300">{`Options not loaded: ${error}`}</p>}
          {orphan && (
            <p role="status" className="mt-3 text-xs text-amber-200">
              Issue created on GitHub
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
                    open
                  </a>
                  )
                </>
              )}
              , but not on the board yet. “Retry adding to board” only repeats that step and will
              not create a second issue.
            </p>
          )}
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded text-xs text-gray-300 hover:text-white hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!repo || !title.trim() || saving}
              className="px-3 py-1.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Creating…' : orphan ? 'Retry adding to board' : 'Create issue (⌘↵)'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
