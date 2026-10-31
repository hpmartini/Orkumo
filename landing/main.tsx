import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, Check, Copy, Github, Laptop, Server, Monitor } from 'lucide-react';
import './fonts';
import { Rack } from './Rack';
import { CometCard } from './components/ui/comet-card';
import { MagneticButton } from './components/ui/magnetic-button';
import overviewImg from './img/overview.webp';
import boardImg from './img/board.webp';
import agentsImg from './img/agents.webp';
import codeImg from './img/code.webp';
import terminalImg from './img/terminal.webp';

const REPO = 'https://github.com/hpmartini/DevHub';

function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function Nav() {
  return (
    <header className="rail sticky top-0 z-40">
      <nav aria-label="Main" className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-9">
        <a href="#top" className="silk mr-auto text-[15px] text-ink">
          DevOrbit
        </a>
        <div className="hidden items-center gap-6 font-mono text-xs text-muted sm:flex">
          <a className="hover:text-ink" href="#modes">
            Modes
          </a>
          <a className="hover:text-ink" href="#context">
            Context
          </a>
          <a className="hover:text-ink" href="#mesh">
            Mesh
          </a>
          <a className="hover:text-ink" href="#run">
            Run it
          </a>
        </div>
        <a
          href={REPO}
          className="flex min-h-12 items-center gap-1.5 font-mono text-xs text-ink hover:text-signal-green"
        >
          <Github size={16} aria-hidden /> Source
        </a>
      </nav>
    </header>
  );
}

function Hero() {
  const reduce = useReducedMotion();
  return (
    <section
      id="top"
      className="mx-auto grid max-w-7xl gap-12 px-5 pt-16 pb-24 sm:px-9 lg:grid-cols-12 lg:items-center lg:pt-24"
    >
      <div className="lg:col-span-5">
        <h1 className="text-[clamp(3rem,7vw,6rem)] leading-[0.92] font-[800] tracking-[-0.03em] [font-stretch:112%]">
          Patch your agents into one context.
        </h1>
        <p className="mt-6 max-w-md text-lg text-muted">
          DevOrbit keeps every issue, Claude Code agent, worktree, pull request and line of code
          linked, in one local workspace that runs on all your machines.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-4">
          <MagneticButton strength={reduce ? 0 : 0.35} maxDistance={18}>
            <a
              href="#run"
              className="silk flex min-h-12 items-center rounded-[4px] bg-signal-green px-6 text-sm text-ground shadow-[0_6px_18px_-6px_rgba(163,230,53,.55)] hover:bg-[#b5f04a]"
            >
              Run it locally
            </a>
          </MagneticButton>
          <a
            href={REPO}
            className="flex min-h-12 items-center gap-2 rounded-[4px] border border-[#3a3e48] px-5 text-sm font-semibold text-ink hover:border-ink"
          >
            View on GitHub <ArrowUpRight size={16} aria-hidden />
          </a>
        </div>
      </div>
      <div className="lg:col-span-7">
        <Rack />
      </div>
    </section>
  );
}

type Mode = {
  name: string;
  line: string;
  img: string;
  w: number;
  h: number;
  alt: string;
  className: string;
};

const MODES: Mode[] = [
  {
    name: 'Overview',
    line: 'Every project, port and service you run, with start, stop and logs one click away.',
    img: overviewImg,
    w: 1160,
    h: 545,
    alt: 'Overview mode: project counts, active ports, favourite apps and recommendations',
    className: 'lg:col-span-7',
  },
  {
    name: 'Agents',
    line: 'The browser version of claude agents: dispatch, peek, attach in tabs or tiles.',
    img: agentsImg,
    w: 440,
    h: 910,
    alt: 'Agents mode: a list of Claude Code sessions grouped by project with status and token use',
    className: 'lg:col-span-5 lg:row-span-2',
  },
  {
    name: 'Board',
    line: 'Your GitHub project as a board. Drag a card and the issue status follows.',
    img: boardImg,
    w: 1400,
    h: 1114,
    alt: 'Board mode: issues grouped by epic, with an issue panel showing status, labels and linked agents',
    className: 'lg:col-span-7',
  },
  {
    name: 'Code',
    line: 'VS Code in the same shell, opened on the project or the agent’s worktree.',
    img: codeImg,
    w: 825,
    h: 900,
    alt: 'Code mode: VS Code in the browser with a TypeScript file open',
    className: 'lg:col-span-5',
  },
  {
    name: 'Terminal',
    line: 'Real terminal tabs, Claude Code tabs included, next to everything else.',
    img: terminalImg,
    w: 1150,
    h: 800,
    alt: 'Terminal mode: a Claude Code session running in a web terminal tab',
    className: 'lg:col-span-7',
  },
];

function ModeModule({ mode, i }: { mode: Mode; i: number }) {
  const reduce = useReducedMotion();
  const shot = (
    <img
      src={mode.img}
      width={mode.w}
      height={mode.h}
      alt={mode.alt}
      loading="lazy"
      decoding="async"
      className="h-auto w-full rounded-[4px] border border-black/60"
    />
  );
  return (
    <Reveal delay={reduce ? 0 : i * 0.08} className={mode.className}>
      <article className="module flex h-full flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="silk text-lg">{mode.name}</h3>
          <span
            aria-hidden
            className="h-3 w-3 shrink-0 rounded-full border-2 border-[#4a4f5b] bg-black"
          />
        </div>
        <p className="max-w-prose text-[15px] text-muted">{mode.line}</p>
        <div className="mt-auto">
          {reduce ? (
            shot
          ) : (
            <CometCard rotateDepth={4} translateDepth={6}>
              {shot}
            </CometCard>
          )}
        </div>
      </article>
    </Reveal>
  );
}

function Modes() {
  return (
    <section id="modes" className="mx-auto max-w-7xl px-5 py-24 sm:px-9" aria-labelledby="modes-h">
      <h2
        id="modes-h"
        className="max-w-3xl text-[clamp(2rem,4.5vw,3.5rem)] leading-[1] font-[800] tracking-[-0.02em]"
      >
        Five modes, one rack. Switch modes, keep the context.
      </h2>
      <div className="mt-12 grid gap-5 lg:grid-cols-12">
        {MODES.map((m, i) => (
          <ModeModule key={m.name} mode={m} i={i} />
        ))}
      </div>
    </section>
  );
}

const LINKS = [
  { from: 'Issue', to: 'Agent', how: 'A board comment carries the session id.', color: '#3B82F6' },
  {
    from: 'Agent',
    to: 'Worktree',
    how: 'The session’s own worktree and branch.',
    color: '#8B5CF6',
  },
  { from: 'Agent', to: 'PR', how: 'PR links land in the session state.', color: '#A3E635' },
  { from: 'PR', to: 'Issue', how: '“Closes #n” in the PR body points back.', color: '#3B82F6' },
];

function Context() {
  const reduce = useReducedMotion();
  return (
    <section
      id="context"
      className="border-y border-[#1b1d23] bg-case/60"
      aria-labelledby="context-h"
    >
      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-24 sm:px-9 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <h2
            id="context-h"
            className="text-[clamp(2rem,4.5vw,3.5rem)] leading-[1] font-[800] tracking-[-0.02em]"
          >
            The context is the cable.
          </h2>
          <p className="mt-5 text-muted">
            Nothing to maintain by hand. DevOrbit reads the links your tools already leave behind
            and patches them together: Issue, Agent, Worktree, PR, Code.
          </p>
        </div>
        <ol className="grid gap-4 sm:grid-cols-2 lg:col-span-8">
          {LINKS.map((l, i) => (
            <li key={l.from + l.to} className="module p-5">
              <svg viewBox="0 0 240 48" className="w-full" aria-hidden>
                <circle cx="16" cy="24" r="10" fill="#0b0c10" stroke="#4a4f5b" strokeWidth="2.5" />
                <circle cx="224" cy="24" r="10" fill="#0b0c10" stroke="#4a4f5b" strokeWidth="2.5" />
                <motion.path
                  d="M16 24 C 80 52, 160 52, 224 24"
                  stroke={l.color}
                  strokeWidth="4"
                  strokeLinecap="round"
                  fill="none"
                  initial={reduce ? false : { pathLength: 0 }}
                  whileInView={{ pathLength: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.9, delay: i * 0.15, ease: 'easeInOut' }}
                />
              </svg>
              <p className="mt-3 font-mono text-sm text-ink">
                {l.from} → {l.to}
              </p>
              <p className="mt-1 text-[15px] text-muted">{l.how}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const MACHINES = [
  { name: 'laptop', Icon: Laptop, note: 'agents run here' },
  { name: 'workstation', Icon: Monitor, note: 'and here' },
  { name: 'build box', Icon: Server, note: 'and here' },
];

function Mesh() {
  return (
    <section
      id="mesh"
      className="mx-auto grid max-w-7xl gap-12 px-5 py-24 sm:px-9 lg:grid-cols-12 lg:items-center"
      aria-labelledby="mesh-h"
    >
      <Reveal className="lg:col-span-7 lg:order-2">
        <div className="module p-5 sm:p-8">
          <div className="grid grid-cols-3 gap-3 sm:gap-6">
            {MACHINES.map(({ name, Icon, note }) => (
              <div
                key={name}
                className="flex flex-col items-center gap-3 rounded-[4px] border border-[#2a2d35] bg-[#0f1115] px-2 py-6"
              >
                <Icon size={32} strokeWidth={1.5} className="text-ink" aria-hidden />
                <span className="font-mono text-xs text-ink sm:text-sm">{name}</span>
                <span className="font-mono text-[11px] text-muted">{note}</span>
              </div>
            ))}
          </div>
          <svg viewBox="0 0 600 70" className="mt-2 w-full" aria-hidden>
            <path
              d="M100 0 V35 H500 V0 M300 0 V35"
              stroke="#8B5CF6"
              strokeWidth="3"
              fill="none"
              strokeDasharray="6 6"
            />
            <path d="M300 35 V70" stroke="#8B5CF6" strokeWidth="3" fill="none" />
          </svg>
          <p className="rounded-[4px] border border-[#2a2d35] bg-[#0f1115] py-3 text-center font-mono text-xs text-muted sm:text-sm">
            your tailnet · view, steer or attach over SSH
          </p>
        </div>
      </Reveal>
      <div className="lg:col-span-5 lg:order-1">
        <h2
          id="mesh-h"
          className="text-[clamp(2rem,4.5vw,3.5rem)] leading-[1] font-[800] tracking-[-0.02em]"
        >
          Agents stay where they run.
        </h2>
        <p className="mt-5 text-muted">
          DevOrbit joins your machines over your existing Tailscale tailnet. An agent keeps running
          on its own machine; you watch it, steer it, or attach over SSH from wherever you are.
          Sessions never migrate.
        </p>
      </div>
    </section>
  );
}

const COMMANDS = `git clone ${REPO}.git
cd DevHub
bun install
bun run dev:full`;

function Quickstart() {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard?.writeText(COMMANDS).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  return (
    <section id="run" className="mx-auto max-w-7xl px-5 py-24 sm:px-9" aria-labelledby="run-h">
      <div className="module grid gap-10 p-6 sm:p-10 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-5">
          <h2
            id="run-h"
            className="text-[clamp(2rem,4.5vw,3.5rem)] leading-[1] font-[800] tracking-[-0.02em]"
          >
            Run it locally.
          </h2>
          <p className="mt-5 text-muted">
            Needs Bun, Docker for Postgres and Redis, and the{' '}
            <code className="font-mono text-ink">claude</code> CLI. Then open the dashboard on port
            3000.
          </p>
          <a
            href={REPO}
            className="mt-6 inline-flex min-h-12 items-center gap-2 font-semibold text-ink underline decoration-signal-green decoration-2 underline-offset-4 hover:text-signal-green"
          >
            Read the setup guide in the repo <ArrowUpRight size={16} aria-hidden />
          </a>
        </div>
        <div className="relative min-w-0 lg:col-span-7">
          <pre className="overflow-x-auto rounded-[4px] border border-black/60 bg-[#050608] p-5 pr-14 font-mono text-sm leading-7 text-ink">
            {COMMANDS.split('\n').map((c) => (
              <div key={c}>
                <span className="select-none text-signal-green">$ </span>
                {c}
              </div>
            ))}
          </pre>
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? 'Copied' : 'Copy commands'}
            className="absolute top-2 right-2 grid h-12 w-12 place-items-center rounded-[4px] text-muted hover:text-ink"
          >
            {copied ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}
          </button>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="rail">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-9 py-5 font-mono text-xs text-muted">
        <span className="silk text-ink">DevOrbit</span>
        <span>Built on the unmodified claude CLI.</span>
        <a
          href={REPO}
          className="ml-auto inline-flex min-h-12 items-center text-ink hover:text-signal-green"
        >
          Source on GitHub
        </a>
      </div>
    </footer>
  );
}

function Page() {
  return (
    <>
      <a
        href="#modes"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-ink focus:px-4 focus:py-3 focus:text-ground"
      >
        Skip to content
      </a>
      <Nav />
      <main>
        <Hero />
        <Modes />
        <Context />
        <Mesh />
        <Quickstart />
      </main>
      <Footer />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>
);
