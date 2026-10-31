import { CopyBlock } from '../components/CopyBlock';
import { Reveal } from '../components/Reveal';
import { QUICKSTART, RELEASES } from '../lib/links';

const INTRO =
  'Take the pre-release build, or run the repository on your own machine. Both give you the same dashboard.';

const DESKTOP_LEAD =
  'A pre-release build for macOS and Linux. It brings its own backend; for the agents view you also need the claude CLI installed and signed in once.';

const BUILD_NOTE =
  'Every build lives on the releases page. macOS and Linux are supported; there is no native Windows build.';

const SOURCE_LEAD =
  'Needs Bun, Node.js, Docker for Postgres and Redis, and the claude CLI signed in once. Then the dashboard comes up on port 3098.';

const SOURCE_NOTE = 'The Code mode needs code-server on the machine (README, "Web IDE").';

const DOCKER_LEAD =
  'No checkout, no build: take docker-compose.release.yml and init-db.sql from the releases page and start the stack.';

const DOCKER_NOTE = 'No agents view, and the terminals need the PTY host running on the machine.';

const BUILDS = [
  { label: 'macOS · Apple Silicon', note: '.dmg (arm64)' },
  { label: 'macOS · Intel', note: '.dmg (x64)' },
  { label: 'Linux · AppImage', note: 'run it anywhere' },
  { label: 'Linux · Debian / Ubuntu', note: '.deb (amd64)' },
  { label: 'Linux · Fedora / RHEL', note: '.rpm (x86_64)' },
];

const DOCKER_COMMANDS = 'docker compose -f docker-compose.release.yml up -d';

export function Install() {
  return (
    <section id="install" aria-labelledby="install-h">
      <div className="mx-auto max-w-7xl px-5 py-24 sm:px-9">
        <div className="max-w-3xl">
          <h2 id="install-h" className="display-face head-section">
            Two ways to run it.
          </h2>
          <p className="mt-5 text-lg text-muted">{INTRO}</p>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          <Reveal className="min-w-0">
            <div className="panel flex h-full flex-col p-6">
              <h3 className="display-face text-2xl leading-tight">Desktop app</h3>
              <p className="mt-2 text-[15px] text-muted">{DESKTOP_LEAD}</p>
              <ul className="mt-5 divide-y divide-hairline border-y border-hairline">
                {BUILDS.map((build) => (
                  <li key={build.label}>
                    <a
                      href={RELEASES}
                      className="flex min-h-12 items-center justify-between gap-4 px-1 text-[15px] text-paper transition-colors hover:text-signal-yellow"
                    >
                      <span>{build.label}</span>
                      <span className="font-mono text-xs text-muted">{build.note}</span>
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted">{BUILD_NOTE}</p>
            </div>
          </Reveal>

          <Reveal delay={0.06} className="min-w-0">
            <div className="panel flex h-full flex-col p-6">
              <h3 className="display-face text-2xl leading-tight">From source</h3>
              <p className="mt-2 text-[15px] text-muted">{SOURCE_LEAD}</p>
              <div className="mt-5">
                <CopyBlock commands={QUICKSTART} />
              </div>
              <p className="mt-4 font-mono text-xs text-paper/85">http://localhost:3098</p>
              <p className="mt-3 text-xs text-muted">{SOURCE_NOTE}</p>
            </div>
          </Reveal>
        </div>

        <Reveal className="mt-5">
          <div className="panel grid grid-cols-1 gap-4 p-6 lg:grid-cols-12 lg:items-center">
            <div className="min-w-0 lg:col-span-6">
              <h3 className="display-face text-xl leading-tight">Or Docker, from a release</h3>
              <p className="mt-2 text-[15px] text-muted">{DOCKER_LEAD}</p>
              <p className="mt-2 text-xs text-muted">{DOCKER_NOTE}</p>
            </div>
            <div className="min-w-0 lg:col-span-6">
              <CopyBlock commands={DOCKER_COMMANDS} />
              <p className="mt-3 font-mono text-xs text-paper/85">http://localhost:3000</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
