import { Reveal } from '../components/Reveal';

const INTRO =
  'DevOrbit joins your machines over the tailnet you already run — no new protocol, no account. An agent keeps running on the machine it was started on.';

const POINTS = [
  'Remote sessions show up in the same agent list, tagged with the machine they run on.',
  'Attach over SSH with claude attach — the session keeps running while you watch.',
  'No session migration: the long job stays on the build box.',
];

const MACHINES = [
  { name: 'laptop', note: 'where you drive' },
  { name: 'workstation', note: 'where sessions run' },
  { name: 'build-box', note: 'where the long jobs run' },
];

export function Mesh() {
  return (
    <section id="mesh" aria-labelledby="mesh-h">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-24 sm:px-9 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-5">
          <h2 id="mesh-h" className="display-face head-section">
            Agents stay where they run.
          </h2>
          <p className="mt-5 text-muted">{INTRO}</p>
          <ul className="mt-6 space-y-3 text-[15px] text-muted">
            {POINTS.map((point) => (
              <li key={point} className="flex gap-2.5">
                <span aria-hidden className="text-signal-yellow">
                  —
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
        <Reveal className="lg:col-span-7">
          <div className="panel p-5 sm:p-6">
            <div className="flex items-center justify-between border-b border-hairline pb-3">
              <span className="label-tape text-paper/90">Mesh</span>
              <span className="label-tape text-muted">Example</span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {MACHINES.map((machine) => (
                <div key={machine.name} className="inset p-4">
                  <p className="font-mono text-sm text-paper">{machine.name}</p>
                  <p className="mt-1 text-[13px] text-muted">{machine.note}</p>
                </div>
              ))}
            </div>
            <p className="inset mt-3 py-2.5 text-center font-mono text-xs text-muted">
              your Tailscale tailnet
            </p>
            <p className="mt-3 overflow-x-auto rounded-[6px] border border-hairline bg-[#080b0f] px-3 py-2.5 font-mono text-xs text-paper/85">
              ssh -t &lt;host&gt; claude attach &lt;id&gt;
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
