import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowLeft } from 'lucide-react';
import { DEMO_ALTS, DEMO_PROJECTS } from '../copy';
import { cn } from '../lib/utils';

type Checks = 'passing' | 'failing' | 'pending';

type Pull = {
  project: string;
  number: number;
  title: string;
  checks: Checks;
  branch: string;
  session: string;
  diff: string[];
};

type CheckInfo = { word: string; state: 'needs' | 'working' | 'done'; tone: string };

const PULLS: Pull[] = [
  {
    project: DEMO_PROJECTS[0],
    number: 42,
    title: 'Add retry to webhook',
    checks: 'passing',
    branch: 'feat/retry-webhook -> main',
    session: 'Add retry to webhook',
    diff: [
      ' async function send(url: string, options: RequestInit) {',
      '-  const res = await fetch(url, options);',
      '+  const res = await fetch(url, options, { retry: 3 });',
      '+  if (!res.ok) throw new WebhookError(res.status);',
      '   return res.json();',
    ],
  },
  {
    project: DEMO_PROJECTS[1],
    number: 18,
    title: 'Retry the failed charge',
    checks: 'failing',
    branch: 'feat/charge-retry -> main',
    session: 'Retry the failed charge',
    diff: [
      '   const charge = await stripe.charges.create(input);',
      '-  return charge;',
      '+  if (charge.status === "failed") return retryCharge(input, charge.id);',
      '+  return charge;',
    ],
  },
  {
    project: DEMO_PROJECTS[2],
    number: 7,
    title: 'Rewrite the install guide',
    checks: 'pending',
    branch: 'docs/install-rewrite -> main',
    session: 'Rewrite the install guide',
    diff: [
      '-## Install',
      '+## Install DevOrbit',
      '+1. Download the pre-release',
      '+2. Point it at your project folders',
    ],
  },
  {
    project: DEMO_PROJECTS[3],
    number: 23,
    title: 'Bump the SDK version',
    checks: 'passing',
    branch: 'chore/sdk-2-3 -> main',
    session: 'Bump the SDK version',
    diff: ['   "dependencies": {', '-    "sdk": "2.2.4"', '+    "sdk": "2.3.0"', '   }'],
  },
  {
    project: DEMO_PROJECTS[0],
    number: 39,
    title: 'Show the discount breakdown',
    checks: 'passing',
    branch: 'feat/discount-breakdown -> main',
    session: 'Show the discount breakdown',
    diff: [
      '   const total = cart.items.reduce((sum, item) => sum + item.price, 0);',
      '+  const breakdown = cart.items.map((item) => ({',
      '+    label: item.name,',
      '+    amount: item.price * (1 - item.discount),',
      '+  }));',
    ],
  },
  {
    project: DEMO_PROJECTS[2],
    number: 12,
    title: 'Fix the broken links',
    checks: 'failing',
    branch: 'fix/broken-links -> main',
    session: 'Fix the broken links',
    diff: [
      '   See the [setup guide](../install.md) for details.',
      '-  Read [the docs](/docs/start).',
      '+  Read [the docs](/docs/getting-started).',
      '   Then run `bun run dev`.',
    ],
  },
];

const CHECKS: Record<Checks, CheckInfo> = {
  passing: { word: 'Passing', state: 'done', tone: 'text-emerald' },
  failing: { word: 'Failing', state: 'needs', tone: 'text-rose' },
  pending: { word: 'Pending', state: 'working', tone: 'text-amber' },
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

/** the mark and the word carry the state together, never the colour alone */
function ChecksMark({ checks }: { checks: Checks }) {
  const check = CHECKS[checks];
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusMark state={check.state} />
      <span className={cn('text-[12px]', check.tone)}>{check.word}</span>
    </span>
  );
}

/** added lines are green, removed lines rose, context stays muted */
function diffTone(line: string) {
  if (line.startsWith('+')) return 'text-emerald';
  if (line.startsWith('-')) return 'text-rose';
  return 'text-muted';
}

function ListPane({
  pulls,
  filter,
  onFilter,
  onOpen,
  containerRef,
}: {
  pulls: Pull[];
  filter: string;
  onFilter: (project: string) => void;
  onOpen: (number: number) => void;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={containerRef} className="flex h-full flex-col p-3">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-text">Open pull requests</span>
        <span className="font-mono text-[12px] text-muted">{pulls.length}</span>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {['all', ...DEMO_PROJECTS].map((project) => {
          const active = filter === project;
          return (
            <button
              key={project}
              type="button"
              aria-pressed={active}
              onClick={() => onFilter(project)}
              className={cn(
                'rounded-[3px] border px-2 py-1 text-[12px] transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-link',
                active ? 'border-link bg-raised text-text' : 'border-hairline text-muted'
              )}
            >
              {project === 'all' ? 'All' : project}
            </button>
          );
        })}
      </div>

      <ul className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        {pulls.map((pull) => (
          <li key={pull.number}>
            <button
              type="button"
              data-pr-row={pull.number}
              onClick={() => onOpen(pull.number)}
              className="w-full rounded-[4px] border border-hairline bg-panel px-2.5 py-2 text-left transition-colors hover:border-link focus-visible:outline-2 focus-visible:outline-link motion-reduce:transition-none"
            >
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-mono text-[12px] text-link">acme/{pull.project}</span>
                <span className="font-mono text-[12px] text-muted">#{pull.number}</span>
                <span className="text-[13px] text-text">{pull.title}</span>
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <ChecksMark checks={pull.checks} />
                <span className="font-mono text-[12px] text-muted">{pull.branch}</span>
                <span className="text-[12px] text-link">agent: {pull.session}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewPane({
  pull,
  sent,
  onSent,
  onBack,
}: {
  pull: Pull;
  sent: boolean;
  onSent: () => void;
  onBack: () => void;
}) {
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [vscode, setVscode] = useState(false);

  const headingRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  /** only a fresh send may pull the focus onto the status, not an already sent pane */
  const justSentRef = useRef(false);

  const feedbackId = `pulls-feedback-${pull.number}`;
  const vscodeId = `pulls-vscode-${pull.number}`;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!sent || !justSentRef.current) return;
    justSentRef.current = false;
    statusRef.current?.focus();
  }, [sent]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-3 p-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to the list of pull requests"
          className="inline-flex items-center gap-1.5 rounded-[4px] border border-hairline px-2 py-1 text-[12px] text-muted transition-colors hover:border-link hover:text-text focus-visible:outline-2 focus-visible:outline-link motion-reduce:transition-none"
        >
          <ArrowLeft width={14} height={14} aria-hidden />
          All pull requests
        </button>

        <div>
          <div ref={headingRef} tabIndex={-1} className="text-[14px] text-text">
            #{pull.number} {pull.title}
          </div>
          <p className="font-mono text-[12px] text-muted">acme/{pull.project}</p>
        </div>

        <div className="overflow-x-auto rounded-[4px] border border-hairline bg-[#0c152b] p-3 font-mono text-[12px] leading-[1.6]">
          {pull.diff.map((line, i) => (
            <div key={i} className={cn('whitespace-pre', diffTone(line))}>
              {line}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[12px] text-link">agent: {pull.session}</span>
          <ChecksMark checks={pull.checks} />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setComposing(true)}
            aria-expanded={composing}
            aria-controls={feedbackId}
            className="rounded-[5px] bg-blue-strong px-3 py-2 text-[13px] text-white transition-colors hover:bg-[#1d4ed8] focus-visible:outline-2 focus-visible:outline-link motion-reduce:transition-none"
          >
            Send feedback to agent
          </button>
          <button
            type="button"
            onClick={() => setVscode((open) => !open)}
            aria-expanded={vscode}
            aria-controls={vscodeId}
            className="rounded-[5px] border border-hairline px-3 py-2 text-[13px] text-text transition-colors hover:border-link focus-visible:outline-2 focus-visible:outline-link motion-reduce:transition-none"
          >
            Open in VS Code
          </button>
        </div>

        <div id={feedbackId} className={cn('space-y-2', !composing && 'hidden')}>
          <textarea
            aria-label="Feedback for the agent"
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="w-full resize-none rounded-[4px] border border-hairline bg-[#0c152b] p-2 text-[13px] text-text focus-visible:outline-2 focus-visible:outline-link"
          />
          <button
            type="button"
            onClick={() => {
              onSent();
              setComposing(false);
              // the status appears after the state update; a repeat send finds it in place
              if (sent) statusRef.current?.focus();
              else justSentRef.current = true;
            }}
            disabled={draft.trim() === ''}
            className="rounded-[5px] bg-blue-strong px-3 py-2 text-[13px] text-white transition-colors hover:bg-[#1d4ed8] focus-visible:outline-2 focus-visible:outline-link motion-reduce:transition-none disabled:bg-raised disabled:text-muted"
          >
            Send
          </button>
        </div>

        {sent && (
          <div ref={statusRef} role="status" tabIndex={-1} className="text-[12px] text-emerald">
            Sent to agent · session now working
          </div>
        )}

        <p id={vscodeId} className={cn('text-[12px] text-muted', !vscode && 'hidden')}>
          Opens the branch in Code mode
        </p>
      </div>
    </div>
  );
}

/** the review: open pull requests of the demo projects, each linked to the agent that wrote it */
export function PullsDemo() {
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState<number | null>(null);
  const [sentPrs, setSentPrs] = useState<Record<number, boolean>>({});

  const listRef = useRef<HTMLDivElement>(null);
  const backToRef = useRef<number | null>(null);

  const visible = filter === 'all' ? PULLS : PULLS.filter((pull) => pull.project === filter);
  const current = open === null ? null : PULLS.find((pull) => pull.number === open);

  /** the list is unmounted while the review shows, so the focus returns after it renders again */
  useEffect(() => {
    if (open !== null) return;
    const number = backToRef.current;
    if (number === null) return;
    backToRef.current = null;
    listRef.current?.querySelector<HTMLButtonElement>(`[data-pr-row="${number}"]`)?.focus();
  }, [open]);

  return (
    <div role="group" aria-label={DEMO_ALTS.pulls} className="bg-[#101a33]">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <span className="label-tape text-muted">Pull requests</span>
        <span className="label-tape text-muted">Interactive demo</span>
      </div>
      <div className="h-[420px] overflow-hidden">
        {current ? (
          <ReviewPane
            pull={current}
            sent={Boolean(sentPrs[current.number])}
            onSent={() => setSentPrs((prev) => ({ ...prev, [current.number]: true }))}
            onBack={() => {
              backToRef.current = current.number;
              setOpen(null);
            }}
          />
        ) : (
          <ListPane
            pulls={visible}
            filter={filter}
            onFilter={setFilter}
            onOpen={setOpen}
            containerRef={listRef}
          />
        )}
      </div>
    </div>
  );
}
