import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DEMO_ALTS, DEMO_PROJECTS } from '../copy';
import { cn } from '../lib/utils';

type State = 'needs' | 'working' | 'done';

type Session = {
  id: string;
  project: string;
  title: string;
  branch: string;
  age: string;
  message: string;
  state: State;
  reply?: string;
};

const INITIAL_SESSIONS: Session[] = [
  {
    id: 'policy',
    project: DEMO_PROJECTS[0],
    title: 'Choose a retry policy',
    branch: 'feat/retry-policy',
    age: '5m',
    message: 'Which retry policy should I use? 1) exponential backoff 2) fixed delay',
    state: 'needs',
  },
  {
    id: 'webhook',
    project: DEMO_PROJECTS[0],
    title: 'Add retry to webhook',
    branch: 'feat/retry-webhook',
    age: '22m',
    message: 'The webhook now retries with backoff. Running the integration test now.',
    state: 'working',
  },
  {
    id: 'usage-endpoint',
    project: DEMO_PROJECTS[0],
    title: 'Add the usage endpoint',
    branch: 'feat/usage-endpoint',
    age: '2h',
    message: 'The endpoint is merged and the tests are green.',
    state: 'done',
  },
  {
    id: 'charge-retry',
    project: DEMO_PROJECTS[1],
    title: 'Retry the failed charge',
    branch: 'feat/charge-retry',
    age: '12m',
    message: 'The charge failed twice. Retry with an idempotency key or push it to the queue?',
    state: 'needs',
  },
  {
    id: 'usage-test',
    project: DEMO_PROJECTS[1],
    title: 'Fix the failing test',
    branch: 'fix/usage-test',
    age: '31m',
    message: 'One assertion still fails on the empty cart. Looking at the rounding.',
    state: 'working',
  },
  {
    id: 'install-rewrite',
    project: DEMO_PROJECTS[2],
    title: 'Rewrite the install guide',
    branch: 'docs/install-rewrite',
    age: '44m',
    message: 'Drafting the install guide for macOS and Linux.',
    state: 'working',
  },
  {
    id: 'changelog',
    project: DEMO_PROJECTS[2],
    title: 'Index the changelog',
    branch: 'docs/changelog',
    age: '5h',
    message: 'The changelog is indexed by version.',
    state: 'done',
  },
  {
    id: 'broken-links',
    project: DEMO_PROJECTS[2],
    title: 'Fix the broken links',
    branch: 'fix/broken-links',
    age: '6h',
    message: 'All links resolve again.',
    state: 'done',
  },
  {
    id: 'sdk-version',
    project: DEMO_PROJECTS[3],
    title: 'Bump the SDK version',
    branch: 'chore/sdk-2-3',
    age: '8h',
    message: 'SDK 2.3 is in the lockfile.',
    state: 'done',
  },
];

const FILTERS: { state: State; label: string }[] = [
  { state: 'needs', label: 'Needs input' },
  { state: 'working', label: 'Working' },
  { state: 'done', label: 'Done' },
];

const STATE_NAME: Record<State, string> = {
  needs: 'Needs input',
  working: 'Working',
  done: 'Done',
};

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

export function AgentsDemo() {
  const [sessions, setSessions] = useState<Session[]>(INITIAL_SESSIONS);
  const [draft, setDraft] = useState('');
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<State[]>([]);
  const taskCounter = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const filterRowRef = useRef<HTMLDivElement>(null);
  const focusSessionRef = useRef<string | null>(null);

  const counts: Record<State, number> = { needs: 0, working: 0, done: 0 };
  for (const session of sessions) counts[session.state] += 1;

  const visible = filters.length ? sessions.filter((s) => filters.includes(s.state)) : sessions;
  const byProject = DEMO_PROJECTS.map((project) => ({
    project,
    sessions: visible.filter((s) => s.project === project),
  }));
  const groups = byProject.filter((group) => group.sessions.length > 0);

  function toggleFilter(state: State) {
    const has = filters.includes(state);
    setFilters(has ? filters.filter((s) => s !== state) : [...filters, state]);
  }

  function toggleOpen(id: string) {
    const has = openIds.includes(id);
    setOpenIds(has ? openIds.filter((x) => x !== id) : [...openIds, id]);
  }

  function setReply(id: string, text: string) {
    setReplies((prev) => ({ ...prev, [id]: text }));
  }

  function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = draft.trim().slice(0, 60);
    if (!title) return;
    const id = `task-${taskCounter.current}`;
    taskCounter.current += 1;
    setSessions((prev) => [
      {
        id,
        project: DEMO_PROJECTS[0],
        title,
        branch: 'main',
        age: 'now',
        message: 'Reading the code and starting on the task.',
        state: 'working',
      },
      ...prev,
    ]);
    setDraft('');
    // the new row has to be visible, so a state filter would hide it
    setFilters([]);
  }

  function sendReply(id: string) {
    const text = (replies[id] ?? '').trim();
    if (!text) return;
    focusSessionRef.current = id;
    setSessions((prev) =>
      prev.map((s): Session => (s.id === id ? { ...s, state: 'working', reply: text } : s))
    );
    setReplies((prev) => ({ ...prev, [id]: '' }));
  }

  // the send button disappears with the reply, so the focus has to be moved on
  useEffect(() => {
    const id = focusSessionRef.current;
    if (!id) return;
    focusSessionRef.current = null;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-session-row="${id}"]`);
    if (row) {
      row.focus();
      return;
    }
    // the session left the active filter, so the filter chip takes the focus
    filterRowRef.current
      ?.querySelector<HTMLElement>('[data-filter-chip][aria-pressed="true"]')
      ?.focus();
  }, [sessions, filters]);

  return (
    <div role="group" aria-label={DEMO_ALTS.agents} className="bg-[#101a33]">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <span className="label-tape text-muted">Agents</span>
        <span className="label-tape text-muted">Interactive demo</span>
      </div>

      <div className="flex h-[420px] flex-col">
        {/* the situation: how many sessions are waiting, working or finished */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-[12px] text-muted">
          <span className="flex items-center gap-1.5">
            <StatusMark state="needs" />
            {counts.needs} need input
          </span>
          <span aria-hidden>·</span>
          <span className="flex items-center gap-1.5">
            <StatusMark state="working" />
            {counts.working} working
          </span>
          <span aria-hidden>·</span>
          <span className="flex items-center gap-1.5">
            <StatusMark state="done" />
            {counts.done} done
          </span>
        </div>

        <form onSubmit={addTask} className="flex gap-2 px-3 pb-2">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="New task"
            placeholder="Describe a task, @agent, #issue"
            className="min-w-0 flex-1 rounded-[5px] border border-hairline bg-ground px-2.5 py-1.5 text-[13px] text-text placeholder:text-muted focus-visible:outline-2 focus-visible:outline-link"
          />
          <button
            type="submit"
            className="shrink-0 rounded-[5px] bg-blue-strong px-3 py-2 text-[13px] text-white transition-colors hover:bg-[#1d4ed8] motion-reduce:transition-none"
          >
            New task
          </button>
        </form>

        <div
          role="group"
          aria-label="Filter by state"
          className="flex gap-1.5 px-3 pb-2"
          ref={filterRowRef}
        >
          {FILTERS.map((filter) => {
            const active = filters.includes(filter.state);
            return (
              <button
                key={filter.state}
                type="button"
                aria-pressed={active}
                data-filter-chip=""
                onClick={() => toggleFilter(filter.state)}
                className={cn(
                  'rounded-[5px] border px-2 py-1 text-[12px] transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-link',
                  active
                    ? 'border-link bg-raised text-text'
                    : 'border-hairline text-muted hover:text-text'
                )}
              >
                {filter.label}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" ref={listRef}>
          {groups.map((group) => (
            <div key={group.project} className="mb-2 last:mb-0">
              <div className="font-mono text-[12px] leading-tight text-muted">{group.project}</div>
              <ul className="mt-1 space-y-1">
                {group.sessions.map((session) => {
                  const open = openIds.includes(session.id);
                  const peekId = `agents-peek-${session.id}`;
                  return (
                    <li key={session.id}>
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={peekId}
                        data-session-row={session.id}
                        onClick={() => toggleOpen(session.id)}
                        className="flex w-full items-start gap-2 rounded-[4px] border border-hairline bg-panel px-2.5 py-2 text-left transition-colors hover:border-link focus-visible:outline-2 focus-visible:outline-link motion-reduce:transition-none"
                      >
                        <span className="mt-1">
                          <StatusMark state={session.state} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="sr-only">{STATE_NAME[session.state]}: </span>
                          <span className="block truncate text-[13px] leading-tight text-text">
                            {session.title}
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-[12px] leading-tight text-muted">
                            {session.branch}
                          </span>
                        </span>
                        <span className="shrink-0 text-[12px] leading-tight text-muted">
                          {session.age}
                        </span>
                      </button>
                      <div id={peekId} hidden={!open} className="mt-1">
                        <div className="rounded-[4px] border border-hairline bg-ground px-2.5 py-2">
                          <p className="text-[13px] text-muted">{session.message}</p>
                          {session.reply ? (
                            <>
                              <p className="mt-1.5 text-[13px] text-text">You: {session.reply}</p>
                              <p className="mt-1 text-[12px] text-muted">
                                Sent · the agent is working on it
                              </p>
                            </>
                          ) : session.state === 'needs' ? (
                            <div className="mt-2 flex items-center gap-2">
                              <input
                                type="text"
                                value={replies[session.id] ?? ''}
                                onChange={(event) => setReply(session.id, event.target.value)}
                                aria-label="Reply to agent"
                                placeholder="Answer the agent"
                                className="min-w-0 flex-1 rounded-[5px] border border-hairline bg-panel px-2 py-1.5 text-[12px] text-text placeholder:text-muted focus-visible:outline-2 focus-visible:outline-link"
                              />
                              <button
                                type="button"
                                onClick={() => sendReply(session.id)}
                                className="shrink-0 rounded-[5px] bg-blue-strong px-2.5 py-1.5 text-[12px] text-white transition-colors hover:bg-[#1d4ed8] motion-reduce:transition-none"
                              >
                                Send
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
