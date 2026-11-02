import { DEMO_PROJECTS } from '../copy';

const ROSE = '#fb7185';
const AMBER = '#fbbf24';
const EMERALD = '#34d399';

type State = 'needs' | 'working' | 'done';

/** state is a mark as well as a hue: hollow ring, half ring, filled */
function StatusMark({ state }: { state: State }) {
  if (state === 'needs') {
    return (
      <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden className="shrink-0">
        <circle cx={6} cy={6} r={4} fill="none" stroke={ROSE} strokeWidth={2} />
      </svg>
    );
  }
  if (state === 'working') {
    return (
      <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden className="shrink-0">
        <circle
          cx={6}
          cy={6}
          r={4}
          fill="none"
          stroke={AMBER}
          strokeWidth={2.5}
          strokeDasharray="12.6 12.6"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden className="shrink-0">
      <circle cx={6} cy={6} r={4} fill={EMERALD} />
    </svg>
  );
}

type Entry = { project: string; task: string };

const GROUPS: { label: string; state: State; entries: Entry[] }[] = [
  {
    label: 'Needs input',
    state: 'needs',
    entries: [
      { project: DEMO_PROJECTS[0], task: 'Add retry to webhook' },
      { project: DEMO_PROJECTS[1], task: 'Choose a retry policy' },
    ],
  },
  {
    label: 'Working',
    state: 'working',
    entries: [
      { project: DEMO_PROJECTS[2], task: 'Rewrite the install guide' },
      { project: DEMO_PROJECTS[3], task: 'Bump the SDK version' },
      { project: DEMO_PROJECTS[0], task: 'Fix the failing test' },
    ],
  },
  {
    label: 'Done',
    state: 'done',
    entries: [
      { project: DEMO_PROJECTS[1], task: 'Add the usage endpoint' },
      { project: DEMO_PROJECTS[2], task: 'Index the changelog' },
    ],
  },
];

/** the overview: sessions sorted by what they need from you */
export function MonitorIllustration() {
  return (
    <div className="bg-[#101a33]">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <span className="label-tape text-muted">Overview</span>
        <span className="label-tape text-muted">Illustration</span>
      </div>
      <div className="space-y-4 p-4">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <div className="flex items-center gap-2">
              <StatusMark state={group.state} />
              <span className="label-tape text-muted">{group.label}</span>
            </div>
            <ul className="mt-2 space-y-1.5">
              {group.entries.map((entry) => (
                <li
                  key={`${group.label}-${entry.task}`}
                  className="flex items-baseline gap-2 rounded-[4px] border border-hairline bg-panel px-3 py-2"
                >
                  <span className="font-mono text-[12px] text-link">{entry.project}</span>
                  <span className="text-[13px] text-muted">{entry.task}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
