// All visible copy of the landing page. Every claim is grounded in README / code; no numbers, prices or users invented.

export const META = {
  title: 'Orkumo · One workspace. Every agent.',
  description:
    'Orkumo is a local workspace for Claude Code agents: plan on its own issue board, steer every session, watch what needs you, review pull requests and edit in VS Code — terminal first, without switching apps.',
  ogTitle: 'Orkumo · one window for dozens of coding agents',
  ogDescription:
    'Plan, steer, monitor, review and edit agent work across all your projects. Real terminals, VS Code and a browser built in. Runs on your machine.',
};

export const NAV = [
  { href: '#features', label: 'Features' },
  { href: '#workspace', label: 'Terminal & IDE' },
  { href: '#workflow', label: 'Workflow' },
  { href: '#install', label: 'Install' },
  { href: '#faq', label: 'FAQ' },
];

export const HERO = {
  title: 'One workspace. Every agent.',
  lead: 'All your issues on one kanban board, every Claude Code session with its pull request and live workflow, VS\u00a0Code and a preview browser — side by side in one window.',
  claim: 'Plan · Orchestrate · Review · Ship',
  primary: 'Download', // os-specific label comes from useDownloadLabel()
  secondary: 'Run from source',
  note: 'Free pre-release · macOS & Linux · open source on GitHub',
  // the five verbs of the hero line diagram, in this order; Edit loops back from Review
  stations: ['Plan', 'Steer', 'Monitor', 'Review', 'Edit'],
  ship: 'Ship', // label over the end of the lines
  diagramLabel: 'Example projects',
};

// synthetic project names for every diagram / illustration (never real repos)
export const DEMO_PROJECTS = ['storefront', 'billing-api', 'docs-site', 'mobile-app'];

// the interactive demos label themselves with these (role="group" aria-label)
export const DEMO_ALTS = {
  board:
    'Interactive demo of Board mode: a kanban board with issue cards, an issue panel and an agent you can start.',
  agents:
    'Interactive demo of Agents mode: agent sessions grouped by project, filterable by state, with a reply to a waiting agent.',
  pulls:
    'Interactive demo of the review: open pull requests of the demo projects with checks, a diff and feedback for the agent.',
  workflow:
    'Interactive demo of the live workflow: issues on their stations from queued to done, one waiting for your GO, with a feedback loop back to the brief.',
  code: 'Interactive demo of Code mode: VS Code with a project explorer, tabs and a source file, including a review fix applied in place.',
};

export const FEATURES_INTRO = {
  title: 'Five jobs, one window.',
  lead: 'Running ten agents across six repositories means ten terminals, six browser tabs, a board, a PR list and an editor. Orkumo keeps all of it in one structured surface, linked by issue, agent, branch and pull request.',
};

export type Feature = {
  id: string;
  verb: string;
  title: string;
  body: string;
  points: string[];
  media: 'board' | 'agents' | 'monitor' | 'pulls' | 'code';
  alt: string;
};

export const FEATURES: Feature[] = [
  {
    id: 'plan',
    verb: 'Plan',
    title: 'Plan the work on a board built in.',
    body: 'Orkumo brings its own issue and kanban board — no detour to GitHub. Write the issue, set its status, hand it to an agent — the card already knows which session and which pull request belong to it.',
    points: [
      'Issues as cards in swimlanes, drag and drop to change status, kept in sync with GitHub in the background',
      'One panel for labels, sub-issues, comments, linked agents and pull requests',
      'Start an agent straight from the issue',
    ],
    media: 'board',
    alt: DEMO_ALTS.board,
  },
  {
    id: 'steer',
    verb: 'Steer',
    title: 'Steer every agent from one list.',
    body: 'All Claude Code background sessions of all projects in one list, grouped by state. Dispatch a new one, peek at what it is doing, answer it, or attach to its real terminal.',
    points: [
      'Dispatch with the CLI syntax you know: prompt, @agent, #issue',
      'Peek and reply without attaching',
      'Attach in tabs or tile several sessions side by side; detach and it keeps running',
      'Pin, rename, stop, respawn — with keyboard shortcuts',
    ],
    media: 'agents',
    alt: DEMO_ALTS.agents,
  },
  {
    id: 'monitor',
    verb: 'Monitor',
    title: 'Know which agent needs you, right now.',
    body: 'The overview sorts every session into running, needs input, working and done. A notification arrives the moment one is waiting, and the tab title counts how many are.',
    points: [
      'Needs input, finished or failed: in-app and browser notifications',
      'Warnings when a prompt cache is about to expire or a session needs compaction',
      'Token usage per day, model and provider, plus your 5-hour and weekly plan limits',
      'System health: memory, CPU and the heaviest processes',
    ],
    media: 'monitor',
    alt: 'Illustration of the overview: sessions sorted into needs input, working and done.',
  },
  {
    id: 'review',
    verb: 'Review',
    title: 'Review the pull request next to the agent that wrote it.',
    body: 'Every open pull request of your projects in one list, linked to the session that wrote it. Open one in a split pane, read the diff, then send feedback back to the agent.',
    points: [
      'Open pull requests across all repositories, filterable by project',
      'Checks, merge state, branch and linked issue at a glance',
      'Each PR shows the agent session that wrote it — one click selects it',
      'In the desktop app the PR opens in a pane beside the list',
    ],
    media: 'pulls',
    alt: DEMO_ALTS.pulls,
  },
  {
    id: 'edit',
    verb: 'Edit',
    title: 'Found something in review? Fix it in VS Code, right here.',
    body: 'A full VS Code runs inside Orkumo, opened on the project — or on the exact worktree of the agent you came from. Extensions, git, debugger and terminal included.',
    points: [
      'VS Code (code-server) per project or per agent worktree',
      'Open a pull request’s branch in VS Code with one click',
    ],
    media: 'code',
    alt: DEMO_ALTS.code,
  },
];

export const WORKSPACE = {
  title: 'Terminal first. Editor and browser built in.',
  lead: 'Agents are not hidden behind a chat box. Every session is a real terminal running the unmodified claude CLI — and the tools you need around it live in the same window.',
  illustrationLabel: 'Illustration',
  items: [
    {
      name: 'Terminal first',
      text: 'Each agent is a real terminal (claude attach), not a re-rendered transcript. Type, scroll, interrupt — exactly like in your shell. Plain terminal tabs sit right next to them.',
    },
    {
      name: 'VS Code embedded',
      text: 'code-server opens on the project or on the agent’s worktree, with your extensions, git and debugger.',
    },
    {
      name: 'Browser embedded',
      text: 'Preview the app an agent is building at desktop, tablet or phone width, with console and network logs beside it. Links from a session open in a pane next to it.',
    },
  ],
};

export const WORKFLOW = {
  badge: 'Pro',
  title: 'Watch the workflow run, live.',
  lead: 'For orchestrated runs Orkumo shows every issue on its station: which one is being briefed, which one waits for your GO, and which one feedback sent back for another round.',
  points: [
    'Queued → Brief → GO → Build → Review → Done, drawn from each run’s real state',
    'Loops stay visible: feedback at the GO gate sends the issue back to its brief, with the round count',
    'Give the GO right on the issue card — two clicks, so nothing starts by accident',
  ],
  note: 'Part of the upcoming Pro version.',
  stages: ['Queued', 'Brief', 'GO', 'Build', 'Review', 'Done'],
  loop: 'feedback', // the siding from GO back to Brief
};

export const SCALE = {
  title: 'Dozens of projects. Every machine you own.',
  lead: 'Point Orkumo at your project folders and every repository shows up — with its board, its agents and its pull requests. Machines in your Tailscale tailnet join the same list.',
  points: [
    'All configured project folders in one registry, each opens in Code mode',
    'Sessions on other machines appear in the same agent list, tagged with their host',
    'Attach over SSH; a long job stays on the machine that runs it',
  ],
};

export const PRINCIPLES = {
  title: 'Your CLI, your machine, your rules.',
  items: [
    {
      title: 'The unmodified claude CLI',
      text: 'Orkumo drives the CLI you already have. It does not patch it, wrap it or read tokens out of it.',
    },
    {
      title: 'Runs on your machine',
      text: 'Your code, your keys, your network. Nothing is sent to a server we run.',
    },
    {
      title: 'Scoped to your projects',
      text: 'Sessions can only be dispatched into the project folders you configured. Symlinks are resolved before the check.',
    },
    {
      title: 'Unsafe flags locked',
      text: 'Flags that widen a session’s reach — --dangerously-skip-permissions, custom settings, MCP configs — are refused unless you allow them.',
    },
  ],
};

export const INSTALL = {
  title: 'Get it running.',
  lead: 'Take the desktop pre-release, or run the repository yourself. Both give you the same workspace.',
  desktopTitle: 'Desktop app',
  desktopLead:
    'Pre-release for macOS and Linux. It brings its own backend; the agents view needs the claude CLI installed and signed in once.',
  builds: [
    { label: 'macOS · Apple Silicon', note: '.dmg (arm64)' },
    { label: 'macOS · Intel', note: '.dmg (x64)' },
    { label: 'Linux · AppImage', note: 'any distro' },
    { label: 'Linux · Debian / Ubuntu', note: '.deb (amd64)' },
    { label: 'Linux · Fedora / RHEL', note: '.rpm (x86_64)' },
  ],
  buildNote: 'All builds are on the releases page. No native Windows build; use WSL.',
  sourceTitle: 'From source',
  sourceLead:
    'Needs Bun, Node.js, Docker for Postgres and Redis, and the claude CLI signed in once. The dashboard then runs on port 3098.',
  sourceUrl: 'http://localhost:3098',
  sourceNote: 'VS Code inside Orkumo needs code-server on the machine (README, "Web IDE").',
  dockerTitle: 'Or Docker, from a release',
  dockerLead:
    'No checkout, no build: take docker-compose.release.yml and init-db.sql from the releases page and start the stack.',
  dockerNote: 'Without the agents view; terminals need the PTY host running on the machine.',
  dockerCommand: 'docker compose -f docker-compose.release.yml up -d',
  dockerUrl: 'http://localhost:3000',
};

export const FAQ_TITLE = 'Questions worth asking.';

export const FAQ = [
  {
    question: 'Do I need an API key?',
    answer:
      'No. Orkumo drives the claude CLI you are already signed in with and uses that subscription — no second key, no token scraping.',
  },
  {
    question: 'Which agents does it work with?',
    answer:
      'Agents are Claude Code sessions. The usage page additionally reads local logs of Codex accounts and MiniMax, so you see all your token use in one place.',
  },
  {
    question: 'Does Orkumo change the claude CLI?',
    answer:
      'No. It uses the unmodified CLI and the state it already keeps in your home directory. Nothing is patched, wrapped or bypassed.',
  },
  {
    question: 'Does it run in the cloud?',
    answer:
      'No. Dashboard, database and terminals run on your machine; agents on other machines stay there and join through your tailnet.',
  },
  {
    question: 'Does it work on Windows?',
    answer:
      'No native Windows build yet. macOS and Linux are supported; on Windows, run it in WSL.',
  },
  {
    question: 'What is Pro?',
    answer:
      'The live workflow visualisation is planned for a Pro version. Everything else on this page is in the open-source pre-release today.',
  },
];

export const CLOSE = {
  title: 'Stop switching apps. Start orchestrating.',
  lead: 'Download the pre-release, point it at your project folders and dispatch your first agent from the board.',
  secondary: 'Source on GitHub',
  footer: 'Built on the unmodified claude CLI. Your code stays on your machine.',
};
