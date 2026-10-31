import { useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { motion, useMotionValueEvent, useScroll, useTransform } from 'motion/react';
import { Board, SLOTS, Trail } from '../Board';
import { useIsDesktop, useReduceMotion } from '../lib/media';
import { cn } from '../lib/utils';
import boardImg from '../img/board.webp';
import agentsImg from '../img/agents.webp';
import codeImg from '../img/code.webp';

type Step = {
  slot: string;
  claim: string;
  derive: string;
  andon: 'red' | 'amber' | 'green' | 'off';
  img: string;
  width: number;
  height: number;
  alt: string;
  zoom?: string;
};

const INTRO =
  'Scroll, and the same task card moves along the board. Each slot is filled from what your tools already leave behind.';

const LAST_SLOT = SLOTS.length - 1;

const STEPS: Step[] = [
  {
    slot: 'ISSUE',
    claim: 'The issue starts the chain.',
    derive:
      'Plan the work on the GitHub board inside DevOrbit. Put the session id in a comment and DevOrbit reads it back: the issue knows which agent works on it, and that agent knows its issue.',
    andon: 'off',
    img: boardImg,
    width: 1400,
    height: 1114,
    alt: 'Board mode: the GitHub project as swimlanes, with an issue panel listing status, labels, the agents on the issue and its pull requests.',
  },
  {
    slot: 'AGENT',
    claim: 'The agent is a session, not a tab.',
    derive:
      'Every agent is a background session of the unmodified claude CLI. The andon on the card says what it needs from you: red needs input, amber is working, green is ready for review.',
    andon: 'red',
    img: agentsImg,
    width: 440,
    height: 910,
    alt: 'Agents mode: Claude Code sessions grouped by state, with activity, age and pull request labels per session.',
  },
  {
    slot: 'WORKTREE',
    claim: 'With worktree isolation on, every session gets its own branch and worktree.',
    derive:
      'Terminals and the editor open exactly there, so several agents on one repository work in separate checkouts. Worktree isolation is a setting you switch on — without it, the sessions share the checkout.',
    andon: 'amber',
    img: codeImg,
    width: 825,
    height: 900,
    alt: 'Code mode: VS Code in the browser, opened on the checkout of the session.',
  },
  {
    slot: 'PR',
    claim: 'The pull request is found, not typed.',
    derive:
      'DevOrbit reads the pull request link out of the session state and puts it on the card. "Closes #n" in the body points back to the issue, so the board and the review stay in sync.',
    andon: 'green',
    img: boardImg,
    width: 1400,
    height: 1114,
    alt: 'The issue panel of Board mode, listing the pull requests and the agents working on the issue.',
    zoom: 'scale-[1.75] [transform-origin:right_top]',
  },
  {
    slot: 'CODE',
    claim: 'The code is one click away.',
    derive:
      'Open VS Code in the worktree of that session. Same shell, same context, no copying paths between a terminal and an editor.',
    andon: 'green',
    img: codeImg,
    width: 825,
    height: 900,
    alt: 'Code mode: VS Code in the browser, opened on the checkout of the session.',
    zoom: 'scale-[1.45] [transform-origin:right_bottom]',
  },
];

function railClass(index: number, step: number) {
  if (index === step) return 'border-signal-yellow/70 bg-signal-yellow/12 text-signal-yellow';
  if (index < step) return 'border-hairline bg-white/[0.04] text-muted';
  return 'border-hairline text-muted hover:text-paper';
}

function Shot({ step, contain }: { step: Step; contain?: boolean }) {
  return (
    <div className="overflow-hidden rounded-[8px] border border-hairline bg-[#070a0e] p-2">
      <div className="relative aspect-[16/11]">
        <img
          src={step.img}
          width={step.width}
          height={step.height}
          alt={step.alt}
          loading="lazy"
          decoding="async"
          className={cn(
            'absolute inset-0 h-full w-full object-cover object-top',
            contain && 'object-contain',
            step.zoom
          )}
        />
      </div>
    </div>
  );
}

function StepList() {
  return (
    <div className="mx-auto max-w-7xl px-5 pt-10 pb-24 sm:px-9">
      <ol className="grid gap-5">
        {STEPS.map((step, index) => (
          <li key={step.slot} className="grid gap-4">
            <div className="panel grid gap-6 p-5 sm:grid-cols-2 sm:p-6">
              <div>
                <h3 className="display-face text-2xl leading-tight">{step.claim}</h3>
                <p className="mt-3 text-[15px] text-muted">{step.derive}</p>
              </div>
              <Shot step={step} contain />
            </div>
            <Trail index={index} andon={step.andon} />
          </li>
        ))}
      </ol>
    </div>
  );
}

// Own component: mounted only after useIsDesktop flips, so wrapRef exists when useScroll subscribes
function Walk() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: wrapRef, offset: ['start start', 'end end'] });
  const cardPos = useTransform(scrollYProgress, [0, 1], [0, LAST_SLOT]);
  const [step, setStep] = useState(0);

  useMotionValueEvent(scrollYProgress, 'change', (value) => {
    const next = Math.min(LAST_SLOT, Math.max(0, Math.round(value * LAST_SLOT)));
    setStep((prev) => (prev === next ? prev : next));
  });

  const goToStep = (index: number) => {
    setStep(index);
    const el = wrapRef.current;
    if (!el) return;
    const travel = (el.offsetHeight - window.innerHeight) / LAST_SLOT;
    const top = el.getBoundingClientRect().top + window.scrollY + index * travel;
    window.scrollTo({ top, behavior: 'smooth' });
  };

  const current = STEPS[step];
  const ghost = step > 0 ? step - 1 : null;

  return (
    <div ref={wrapRef} className="relative h-[500vh]">
      <div className="sticky top-0 flex h-dvh items-center pt-16">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-5 sm:px-9 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-7">
            <Board index={cardPos} andon={current.andon} ghost={ghost} />
            <ol className="slot-rail mt-3 grid grid-cols-5 gap-1.5">
              {STEPS.map((item, index) => (
                <li key={item.slot}>
                  <button
                    type="button"
                    onClick={() => goToStep(index)}
                    aria-current={index === step ? 'step' : undefined}
                    className={cn(
                      'label-tape flex min-h-11 w-full items-center justify-center gap-1 rounded-[4px] border transition-colors',
                      railClass(index, step)
                    )}
                  >
                    {index === step && <ArrowRight size={12} aria-hidden />}
                    {item.slot}
                  </button>
                </li>
              ))}
            </ol>
          </div>

          <div className="min-w-0 lg:col-span-5">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <h3 className="display-face head-claim">{current.claim}</h3>
              <p className="mt-4 text-[15px] text-muted">{current.derive}</p>
              <div className="mt-6">
                <Shot step={current} />
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HowItWorks() {
  const reduce = useReduceMotion();
  const desktop = useIsDesktop();

  return (
    <section id="how" aria-labelledby="how-h">
      <div className="mx-auto max-w-7xl px-5 pt-24 sm:px-9">
        <div className="max-w-3xl">
          <h2 id="how-h" className="display-face head-section">
            One card walks five slots.
          </h2>
          <p className="mt-5 text-lg text-muted">{INTRO}</p>
        </div>
      </div>

      {reduce || !desktop ? <StepList /> : <Walk />}
    </section>
  );
}
