import { useEffect, useRef, useState } from 'react';
import { GitPullRequest, RotateCcw, Rocket } from 'lucide-react';
import { DEMO_ALTS, DEMO_PROJECTS, WORKFLOW } from '../copy';
import { cn } from '../lib/utils';

type Wait = 'you' | 'agent' | 'poll' | 'review' | 'done';

type Issue = {
  number: number;
  project: string;
  title: string;
  stage: number; // index into WORKFLOW.stages
  wait: Wait;
  round: number; // 1 until feedback sends it back
  pr?: number;
  mode: string;
};

const GO = WORKFLOW.stages.indexOf('GO');
const BRIEF = WORKFLOW.stages.indexOf('Brief');
const BUILD = WORKFLOW.stages.indexOf('Build');

const START: Issue[] = [
  {
    number: 51,
    project: DEMO_PROJECTS[0],
    title: 'Add guest checkout',
    stage: GO,
    wait: 'you',
    round: 1,
    mode: 'Standard',
  },
  {
    number: 30,
    project: DEMO_PROJECTS[3],
    title: 'Cache feeds offline',
    stage: BUILD,
    wait: 'agent',
    round: 1,
    mode: 'Standard',
  },
  {
    number: 18,
    project: DEMO_PROJECTS[1],
    title: 'Retry the failed charge',
    stage: WORKFLOW.stages.indexOf('Review'),
    wait: 'review',
    round: 1,
    pr: 18,
    mode: 'Standard',
  },
  {
    number: 9,
    project: DEMO_PROJECTS[2],
    title: 'Version the API docs',
    stage: BRIEF,
    wait: 'agent',
    round: 2,
    mode: 'Standard',
  },
  {
    number: 47,
    project: DEMO_PROJECTS[0],
    title: 'Fix the cart badge',
    stage: 0,
    wait: 'poll',
    round: 1,
    mode: 'Standard',
  },
  {
    number: 7,
    project: DEMO_PROJECTS[2],
    title: 'Rewrite the install guide',
    stage: WORKFLOW.stages.length - 1,
    wait: 'done',
    round: 1,
    pr: 7,
    mode: 'Image',
  },
];

const WAIT: Record<Wait, { word: string; tone: string }> = {
  you: { word: 'Waiting for your GO', tone: 'text-rose' },
  agent: { word: 'Agent working', tone: 'text-amber' },
  poll: { word: 'Waiting for the poll', tone: 'text-muted' },
  review: { word: 'Pull request open', tone: 'text-link' },
  done: { word: 'Merged', tone: 'text-emerald' },
};

/** the mark and the word carry the state together, never the colour alone */
function WaitMark({ wait }: { wait: Wait }) {
  const ring = (stroke: string, dash?: string) => (
    <circle
      cx={6}
      cy={6}
      r={4}
      fill="none"
      stroke={stroke}
      strokeWidth={2}
      strokeDasharray={dash}
    />
  );
  return (
    <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden className="shrink-0">
      {wait === 'you' && ring('#fb7185')}
      {wait === 'agent' && ring('#fbbf24', '12.6 12.6')}
      {wait === 'poll' && ring('#a8bbe2', '2 3')}
      {wait === 'review' && ring('#60a5fa')}
      {wait === 'done' && <circle cx={6} cy={6} r={4} fill="#34d399" />}
    </svg>
  );
}

/**
 * The stations as one line: a button per station with its issue count, the feedback loop as a
 * siding from GO back to Brief underneath. Only H/V segments, so the drawing survives the stretch.
 */
function Track({
  counts,
  selected,
  onSelect,
  loopLit,
}: {
  counts: number[];
  selected: number | null;
  onSelect: (stage: number | null) => void;
  loopLit: boolean;
}) {
  const n = WORKFLOW.stages.length;
  const at = (i: number) => ((i + 0.5) / n) * 600;
  return (
    <div className="relative px-1 pt-1">
      <div
        aria-hidden
        className="absolute inset-x-[8%] top-[22px] h-[3px] rounded-full bg-[#3b82f6]/70"
      />
      <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {WORKFLOW.stages.map((stage, i) => {
          const active = selected === i;
          const gate = i === GO;
          return (
            <li key={stage} className="flex justify-center">
              <button
                type="button"
                aria-pressed={active}
                aria-label={`${stage}, ${counts[i]} ${counts[i] === 1 ? 'issue' : 'issues'}`}
                onClick={() => onSelect(active ? null : i)}
                className="group flex flex-col items-center gap-1.5 rounded-[4px] px-1 py-1 focus-visible:outline-2 focus-visible:outline-link"
              >
                <span
                  className={cn(
                    'flex h-[30px] min-w-[30px] items-center justify-center rounded-full border-2 px-1.5 font-mono text-[12px] font-bold tabular-nums transition-colors motion-reduce:transition-none',
                    active
                      ? 'border-white bg-white text-ground'
                      : counts[i] > 0
                        ? gate
                          ? 'border-rose bg-[#101a33] text-text group-hover:border-white'
                          : 'border-[#e8eefa] bg-[#101a33] text-text group-hover:border-white'
                        : 'border-hairline bg-[#101a33] text-muted group-hover:border-muted'
                  )}
                >
                  {counts[i]}
                </span>
                <span
                  className={cn(
                    'text-[12px] font-semibold sm:text-[13px]',
                    active ? 'text-white' : 'text-muted group-hover:text-text'
                  )}
                >
                  {stage}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <svg
        viewBox="0 0 600 22"
        preserveAspectRatio="none"
        aria-hidden
        className="mt-0.5 block h-[22px] w-full"
      >
        <path
          d={`M ${at(GO)} 0 V 14 H ${at(BRIEF)} V 0`}
          fill="none"
          stroke="#a78bfa"
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          opacity={loopLit ? 1 : 0.45}
          className="transition-opacity duration-500 motion-reduce:transition-none"
        />
      </svg>
      <p
        className={cn(
          'mt-1 text-center leading-none text-[11px] transition-colors motion-reduce:transition-none',
          loopLit ? 'text-violet' : 'text-muted'
        )}
        style={{ marginLeft: `${(at(BRIEF) / 600) * 100}%`, width: `${(100 / n) * (GO - BRIEF)}%` }}
      >
        {WORKFLOW.loop}
      </p>
    </div>
  );
}

function GoButton({ onGo }: { onGo: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      onClick={() => (armed ? onGo() : setArmed(true))}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-link motion-reduce:transition-none',
        armed ? 'bg-amber text-ground' : 'bg-blue-strong text-white hover:bg-[#1d4ed8]'
      )}
    >
      <Rocket size={14} aria-hidden />
      {armed ? 'Sure? Click again' : 'GO: Build'}
    </button>
  );
}

function Card({
  issue,
  onGo,
  onFeedback,
}: {
  issue: Issue;
  onGo: () => void;
  onFeedback: () => void;
}) {
  const wait = WAIT[issue.wait];
  return (
    <li
      className={cn(
        'rounded-[4px] border bg-panel px-3 py-2.5',
        issue.wait === 'you' ? 'border-rose/60' : 'border-hairline'
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-mono text-[12px] text-link">acme/{issue.project}</span>
        <span className="font-mono text-[12px] text-muted">#{issue.number}</span>
      </div>
      <p className="mt-0.5 text-[14px] text-text">{issue.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5">
          <WaitMark wait={issue.wait} />
          <span className={cn('text-[12px]', wait.tone)}>{wait.word}</span>
        </span>
        <span className="rounded-[3px] bg-raised px-1.5 py-0.5 text-[11px] text-muted">
          {WORKFLOW.stages[issue.stage]}
        </span>
        <span className="rounded-[3px] bg-raised px-1.5 py-0.5 text-[11px] text-muted">
          {issue.mode}
        </span>
        {issue.round > 1 && (
          <span className="inline-flex items-center gap-1 rounded-[3px] bg-violet/15 px-1.5 py-0.5 text-[11px] text-violet">
            <RotateCcw size={11} aria-hidden />
            Round {issue.round}
          </span>
        )}
        {issue.pr && (
          <span className="inline-flex items-center gap-1 text-[12px] text-link">
            <GitPullRequest size={12} aria-hidden />
            PR #{issue.pr}
          </span>
        )}
      </div>
      {issue.wait === 'you' && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <GoButton onGo={onGo} />
          <button
            type="button"
            onClick={onFeedback}
            className="rounded-[5px] border border-hairline px-3 py-1.5 text-[13px] text-text transition-colors hover:border-violet focus-visible:outline-2 focus-visible:outline-link motion-reduce:transition-none"
          >
            Send back with feedback
          </button>
        </div>
      )}
    </li>
  );
}

/** the live workflow: every issue on its station, the GO gate on the card that waits for it */
export function WorkflowDemo() {
  const [issues, setIssues] = useState(START);
  const [selected, setSelected] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [loopLit, setLoopLit] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);

  const counts = WORKFLOW.stages.map((_, i) => issues.filter((issue) => issue.stage === i).length);
  const visible = selected === null ? issues : issues.filter((issue) => issue.stage === selected);
  const changed = issues !== START;

  const move = (number: number, patch: Partial<Issue>, message: string, loop: boolean) => {
    setIssues((prev) =>
      prev.map((issue) => (issue.number === number ? { ...issue, ...patch } : issue))
    );
    setSelected(null);
    setLoopLit(loop);
    setStatus(message);
  };

  // the card with the buttons is gone after the move; the focus lands on what happened instead
  useEffect(() => {
    if (status) statusRef.current?.focus();
  }, [status]);

  return (
    <div role="group" aria-label={DEMO_ALTS.workflow} className="bg-[#101a33]">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <span className="label-tape text-muted">Workflow</span>
        <span className="label-tape text-muted">Interactive demo</span>
      </div>
      <div className="flex h-[480px] flex-col">
        <div className="border-b border-hairline px-2 pt-3 pb-4 sm:px-4">
          <Track counts={counts} selected={selected} onSelect={setSelected} loopLit={loopLit} />
        </div>
        <div className="flex items-center justify-between gap-2 px-3 pt-3 sm:px-4">
          <span className="text-[13px] font-semibold text-text">
            {selected === null ? 'All issues' : WORKFLOW.stages[selected]}{' '}
            <span className="font-mono font-normal text-muted">{visible.length}</span>
          </span>
          {changed && (
            <button
              type="button"
              onClick={() => {
                setIssues(START);
                setSelected(null);
                setLoopLit(false);
                setStatus('');
              }}
              className="rounded-[4px] px-1.5 py-1 text-[12px] text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-link motion-reduce:transition-none"
            >
              Reset demo
            </button>
          )}
        </div>
        <div
          ref={statusRef}
          role="status"
          tabIndex={-1}
          className={cn('px-3 pt-1 text-[12px] sm:px-4', status ? 'text-emerald' : 'sr-only')}
        >
          {status}
        </div>
        <ul className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto p-3 sm:grid-cols-2 sm:px-4">
          {visible.map((issue) => (
            <Card
              key={issue.number}
              issue={issue}
              onGo={() =>
                move(
                  issue.number,
                  { stage: BUILD, wait: 'agent' },
                  `GO given · #${issue.number} is building`,
                  false
                )
              }
              onFeedback={() =>
                move(
                  issue.number,
                  { stage: BRIEF, wait: 'agent', round: issue.round + 1 },
                  `Sent back · #${issue.number} reworks its brief, round ${issue.round + 1}`,
                  true
                )
              }
            />
          ))}
          {visible.length === 0 && (
            <li className="text-[13px] text-muted sm:col-span-2">
              No issue on this station right now.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
