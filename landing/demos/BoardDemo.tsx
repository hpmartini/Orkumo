import { useEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { X } from 'lucide-react';
import { DEMO_ALTS, DEMO_PROJECTS } from '../copy';
import { cn } from '../lib/utils';

type Column = 'backlog' | 'todo' | 'progress' | 'review';
type Lane = 'epic' | 'chores';

const COLUMNS: { id: Column; name: string }[] = [
  { id: 'backlog', name: 'Backlog' },
  { id: 'todo', name: 'Todo' },
  { id: 'progress', name: 'In progress' },
  { id: 'review', name: 'Review' },
];

const LANES: { id: Lane; name: string }[] = [
  { id: 'epic', name: 'Epic: Checkout retries' },
  { id: 'chores', name: 'Chores' },
];

type Issue = {
  id: number;
  title: string;
  labels: string[];
  lane: Lane;
  column: Column;
  agent: boolean;
};

const INITIAL_ISSUES: Issue[] = [
  {
    id: 12,
    title: 'Retry failed webhook delivery',
    labels: ['bug', 'api'],
    lane: 'epic',
    column: 'backlog',
    agent: false,
  },
  {
    id: 14,
    title: 'Show the discount breakdown',
    labels: ['ui'],
    lane: 'epic',
    column: 'todo',
    agent: false,
  },
  {
    id: 18,
    title: 'Persist the idempotency key',
    labels: ['api'],
    lane: 'epic',
    column: 'review',
    agent: false,
  },
  {
    id: 9,
    title: 'Bump the SDK to 2.3',
    labels: ['chore'],
    lane: 'chores',
    column: 'backlog',
    agent: false,
  },
  {
    id: 16,
    title: 'Tidy the checkout copy',
    labels: ['ui', 'chore'],
    lane: 'chores',
    column: 'todo',
    agent: false,
  },
];

/** state is a mark as well as a hue: hollow ring, half ring, filled */
function StatusMark({ state }: { state: 'needs' | 'working' | 'done' }) {
  if (state === 'needs')
    return (
      <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden className="shrink-0">
        <circle cx={6} cy={6} r={4} fill="none" stroke="#fb7185" strokeWidth={2} />
      </svg>
    );
  if (state === 'working')
    return (
      <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden className="shrink-0">
        <circle
          cx={6}
          cy={6}
          r={4}
          fill="none"
          stroke="#fbbf24"
          strokeWidth={2.5}
          strokeDasharray="12.6 12.6"
        />
      </svg>
    );
  return (
    <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden className="shrink-0">
      <circle cx={6} cy={6} r={4} fill="#34d399" />
    </svg>
  );
}

function IssueCard({
  issue,
  expanded,
  onOpen,
}: {
  issue: Issue;
  expanded: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={expanded}
      aria-controls="board-issue-panel"
      data-issue-id={issue.id}
      className="w-full rounded-[4px] border border-hairline bg-panel px-2.5 py-2 text-left transition-colors motion-reduce:transition-none hover:border-link focus-visible:outline-2 focus-visible:outline-link"
    >
      <span className="flex items-center gap-2">
        <span className="font-mono text-[12px] text-link">#{issue.id}</span>
        {issue.agent && (
          <span className="flex items-center gap-1 text-[12px] text-amber">
            <StatusMark state="working" />
            agent
          </span>
        )}
      </span>
      <span className="mt-1 block text-[13px] text-text">{issue.title}</span>
      <span className="mt-1.5 flex flex-wrap gap-1">
        {issue.labels.map((label) => (
          <span
            key={label}
            className="rounded-[3px] bg-raised px-1.5 py-0.5 text-[12px] text-muted"
          >
            {label}
          </span>
        ))}
      </span>
    </button>
  );
}

function IssuePanel({
  issue,
  closeRef,
  onClose,
  onMove,
  onStart,
}: {
  issue: Issue | null;
  closeRef: Ref<HTMLButtonElement>;
  onClose: () => void;
  onMove: (id: number, column: Column) => void;
  onStart: (id: number) => void;
}) {
  return (
    <div
      id="board-issue-panel"
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') onClose();
      }}
      className={cn(
        'absolute inset-y-0 right-0 z-10 w-full max-w-[300px] overflow-y-auto border-l border-hairline bg-panel',
        !issue && 'hidden'
      )}
    >
      {issue && (
        <>
          <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
            <span className="label-tape text-muted">Issue</span>
            <button
              type="button"
              ref={closeRef}
              onClick={onClose}
              aria-label="Close issue panel"
              className="grid h-7 w-7 place-items-center rounded-[4px] text-muted transition-colors motion-reduce:transition-none hover:bg-raised hover:text-text focus-visible:outline-2 focus-visible:outline-link"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
          <div className="space-y-3 p-3">
            <p className="text-[14px] text-text">{issue.title}</p>
            <label className="block">
              <span className="block text-[12px] font-semibold tracking-[0.12em] uppercase text-muted">
                Status
              </span>
              <select
                value={issue.column}
                onChange={(event) => onMove(issue.id, event.target.value as Column)}
                className="mt-1 w-full rounded-[4px] border border-hairline bg-raised px-2 py-1.5 text-[13px] text-text scheme-dark focus-visible:outline-2 focus-visible:outline-link"
              >
                {COLUMNS.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-1">
              {issue.labels.map((label) => (
                <span
                  key={label}
                  className="rounded-[3px] bg-raised px-1.5 py-0.5 text-[12px] text-muted"
                >
                  {label}
                </span>
              ))}
            </div>
            <p className="text-[13px] text-muted">Agents on this issue: {issue.agent ? 1 : 0}</p>
            {issue.agent && (
              <div className="flex items-center gap-2 text-[13px] text-text">
                <StatusMark state="working" />
                agent · working
              </div>
            )}
            <button
              type="button"
              disabled={issue.agent}
              onClick={() => onStart(issue.id)}
              className={cn(
                'w-full rounded-[5px] px-3 py-2 text-[13px] transition-colors motion-reduce:transition-none',
                issue.agent
                  ? 'cursor-not-allowed bg-raised text-muted'
                  : 'bg-blue-strong text-white hover:bg-[#1d4ed8]'
              )}
            >
              {issue.agent ? 'Agent running' : 'Start agent'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function BoardDemo() {
  const [issues, setIssues] = useState<Issue[]>(INITIAL_ISSUES);
  const [openId, setOpenId] = useState<number | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerIdRef = useRef<number | null>(null);

  // the panel takes the focus when it opens and hands it back to the card that opened it
  useEffect(() => {
    if (openId !== null) {
      closeRef.current?.focus();
      return;
    }
    const openerId = openerIdRef.current;
    if (openerId === null) return;
    openerIdRef.current = null;
    boardRef.current?.querySelector<HTMLButtonElement>(`[data-issue-id="${openerId}"]`)?.focus();
  }, [openId]);

  const open = openId === null ? null : (issues.find((issue) => issue.id === openId) ?? null);
  const epic = issues.filter((issue) => issue.lane === 'epic');
  const epicDone = epic.filter((issue) => issue.column === 'review').length;
  const epicPercent = Math.round((epicDone / epic.length) * 100);

  const move = (id: number, column: Column) =>
    setIssues((prev) => prev.map((issue) => (issue.id === id ? { ...issue, column } : issue)));

  const startAgent = (id: number) =>
    setIssues((prev) => prev.map((issue) => (issue.id === id ? { ...issue, agent: true } : issue)));

  const openIssue = (id: number) => {
    openerIdRef.current = id;
    setOpenId(id);
  };

  return (
    <div role="group" aria-label={DEMO_ALTS.board} className="bg-[#101a33]">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <span className="label-tape text-muted">Board</span>
        <span className="label-tape text-muted">Interactive demo</span>
      </div>
      <div className="relative h-[420px]">
        <div ref={boardRef} inert={openId !== null} className="flex h-full flex-col">
          <div className="flex items-center justify-between px-3 pt-3">
            <span className="font-mono text-[12px] text-muted">acme/{DEMO_PROJECTS[0]}</span>
            <span className="font-mono text-[12px] text-muted">{issues.length} issues</span>
          </div>
          <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto">
            <div className="min-w-[620px] px-3 pb-3">
              <div className="grid grid-cols-4 gap-3">
                {COLUMNS.map((column) => (
                  <div
                    key={column.id}
                    className="flex items-center justify-between border-b border-hairline pb-1.5"
                  >
                    <span className="label-tape text-muted">{column.name}</span>
                    <span className="font-mono text-[12px] text-muted">
                      {issues.filter((issue) => issue.column === column.id).length}
                    </span>
                  </div>
                ))}
              </div>
              {LANES.map((lane) => (
                <div key={lane.id}>
                  <div className="mt-4 flex items-center gap-3">
                    <span className="text-[13px] text-text">{lane.name}</span>
                    {lane.id === 'epic' && (
                      <>
                        <span className="block h-1 w-24 rounded-full bg-hairline">
                          <span
                            className="block h-1 rounded-full bg-emerald"
                            style={{ width: `${epicPercent}%` }}
                          />
                        </span>
                        <span className="font-mono text-[12px] text-muted">
                          {epicDone}/{epic.length} done
                        </span>
                      </>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-3">
                    {COLUMNS.map((column) => (
                      <div key={column.id} className="flex flex-col gap-2">
                        {issues
                          .filter((issue) => issue.lane === lane.id && issue.column === column.id)
                          .map((issue) => (
                            <IssueCard
                              key={issue.id}
                              issue={issue}
                              expanded={openId === issue.id}
                              onOpen={() => openIssue(issue.id)}
                            />
                          ))}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <IssuePanel
          issue={open}
          closeRef={closeRef}
          onClose={() => setOpenId(null)}
          onMove={move}
          onStart={startAgent}
        />
      </div>
    </div>
  );
}
