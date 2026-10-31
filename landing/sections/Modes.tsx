import { Minus } from 'lucide-react';
import { useReduceMotion } from '../lib/media';
import { CometCard } from '../components/ui/comet-card';
import { Reveal } from '../components/Reveal';
import agentsImg from '../img/agents.webp';
import boardImg from '../img/board.webp';
import codeImg from '../img/code.webp';

type Mode = {
  name: string;
  claim: string;
  points: string[];
  img?: string;
  width?: number;
  height?: number;
  alt?: string;
  span: string;
};

const INTRO =
  'Switch modes and the context stays: the issue knows its agent, the agent knows its branch, the branch knows its pull request.';

const USAGE =
  'A separate page reads your local session logs: tokens per day, per model and per provider (Claude Code, each Codex account, MiniMax), plus the five-hour and weekly plan limits.';

const MODES: Mode[] = [
  {
    name: 'Agents',
    claim: 'Every agent, one list.',
    points: [
      'Dispatch with the CLI syntax: <agent> prompt, @agent, #123',
      'Peek and reply without attaching to the session',
      'Attach in tabs or as tiled panes, detach and let it keep running',
      'A notification the moment a session needs input',
    ],
    img: agentsImg,
    width: 440,
    height: 910,
    alt: 'Agents mode: Claude Code sessions grouped by state, with activity, age and pull request labels per session.',
    span: 'lg:col-span-5 lg:row-span-2',
  },
  {
    name: 'Board',
    claim: 'Your GitHub project as a board.',
    points: [
      'Your GitHub Project mirrored, issues as cards in swimlanes',
      'Drag a card and the issue status follows on GitHub',
      'One panel for labels, sub-issues, linked agents and pull requests',
    ],
    img: boardImg,
    width: 1400,
    height: 1114,
    alt: 'Board mode: the GitHub project as swimlanes with an issue panel showing status, labels and linked agents.',
    span: 'lg:col-span-7',
  },
  {
    name: 'Code',
    claim: 'VS Code, in the same shell.',
    points: [
      'code-server per project, or per agent worktree',
      'Extensions, git and an integrated terminal',
      'Opens on the worktree of the agent you came from',
    ],
    img: codeImg,
    width: 825,
    height: 900,
    alt: 'Code mode: VS Code in the browser, opened on the project folder with a file from the repository.',
    span: 'lg:col-span-7',
  },
  // the two text-only modes share the last row
  {
    name: 'Overview',
    claim: 'What runs here, and what needs you.',
    points: [
      'Agent situation: running, needs input, working, done',
      'Needs attention: cache expires in under 10 min, or a compaction is needed',
      'Usage card with tokens per day and plan limits',
      'System health: memory, CPU and the heaviest processes',
    ],
    span: 'lg:col-span-6',
  },
  {
    name: 'Terminal',
    claim: 'Real terminals, next to everything else.',
    points: [
      'Web terminal with tabs, Claude Code tabs included',
      'Same shell as the board, the agents and the editor',
      'Opens in the worktree of the session you are looking at',
    ],
    span: 'lg:col-span-6',
  },
];

function ModeCard({ mode, index }: { mode: Mode; index: number }) {
  const reduce = useReduceMotion();
  const shot = mode.img ? (
    <img
      src={mode.img}
      width={mode.width}
      height={mode.height}
      alt={mode.alt}
      loading="lazy"
      decoding="async"
      className="h-auto w-full"
    />
  ) : null;

  return (
    <Reveal delay={index * 0.06} className={mode.span}>
      <article className="panel flex h-full flex-col p-5">
        <h3 className="display-face text-2xl leading-tight">{mode.name}</h3>
        <p className="mt-2 text-[15px] text-paper/85">{mode.claim}</p>
        <ul className="mt-4 space-y-2 text-[14px] text-muted">
          {mode.points.map((point) => (
            <li key={point} className="flex gap-2.5">
              <Minus size={14} aria-hidden className="mt-1 shrink-0 text-signal-yellow" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
        {shot && (
          <div className="mt-6">
            <div className="overflow-hidden rounded-[6px] border border-hairline bg-[#070a0e]">
              {reduce ? (
                <div className="rounded-md">{shot}</div>
              ) : (
                <CometCard rotateDepth={3} translateDepth={4}>
                  {shot}
                </CometCard>
              )}
            </div>
          </div>
        )}
      </article>
    </Reveal>
  );
}

export function Modes() {
  return (
    <section id="modes" aria-labelledby="modes-h">
      <div className="mx-auto max-w-7xl px-5 py-24 sm:px-9">
        <div className="max-w-3xl">
          <h2 id="modes-h" className="display-face head-section">
            Five modes, one shell.
          </h2>
          <p className="mt-5 text-lg text-muted">{INTRO}</p>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-12">
          {MODES.map((mode, index) => (
            <ModeCard key={mode.name} mode={mode} index={index} />
          ))}
          <Reveal className="lg:col-span-12">
            <p className="panel flex flex-wrap items-baseline gap-x-3 gap-y-1 p-5 text-[15px] text-muted">
              {USAGE}
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
