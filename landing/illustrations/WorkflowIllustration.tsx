import { WORKFLOW } from '../copy';

const TRACK_Y = 56;
const STAGE_X = WORKFLOW.stages.map((_, i) => 28 + 62 * i);
const FOCUS = 3; // Review: the step the run waits at is the brightest thing
const DONE_UNTIL = 3; // Plan, Build and Gates are done; Review waits, Check has not run
const SIDING_BASE = 34; // the first loop drops below the done marks
const SIDING_STEP = 30; // each deeper loop clears the label of the one above it

const LOOPS = WORKFLOW.loops.map((loop, i) => {
  const from = STAGE_X[WORKFLOW.stages.indexOf(loop.from)];
  const to = STAGE_X[WORKFLOW.stages.indexOf(loop.to)];
  const depth = SIDING_BASE + i * SIDING_STEP;
  const bottom = TRACK_Y + depth;
  return {
    label: loop.label,
    // down at 45° toward the target, straight back, up at 45°: a nested siding under the track
    d: `M ${from} ${TRACK_Y} L ${from - depth} ${bottom} H ${to + depth} L ${to} ${TRACK_Y}`,
    labelX: (from + to) / 2,
    labelY: bottom + 16,
  };
});

/** a station: white tick on a dark keyline, same grammar as the hero line diagram */
function Tick({ x, y }: { x: number; y: number }) {
  const d = `M ${x} ${y - 9} V ${y + 9}`;
  return (
    <>
      <path d={d} stroke="#0d1526" strokeWidth={7} strokeLinecap="round" />
      <path d={d} stroke="#e8eefa" strokeWidth={3} strokeLinecap="round" />
    </>
  );
}

/** the live workflow graph of an orchestrated run */
export function WorkflowIllustration() {
  return (
    <div className="bg-[#101a33]">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <span className="label-tape text-muted">Workflow</span>
        <span className="label-tape text-muted">{WORKFLOW.illustrationLabel}</span>
      </div>
      <div className="p-4">
        <svg
          viewBox="0 0 360 230"
          role="img"
          aria-label="Workflow graph: Plan, Build, Gates, Review and Check. Review is the active step; a fix round leads back to Build and a goal loop back to Plan."
          className="block w-full max-w-[440px] mx-auto"
        >
          {/* the track */}
          <path
            d="M 8 56 H 340"
            fill="none"
            stroke="#3b82f6"
            strokeWidth={3}
            strokeLinecap="round"
          />

          {/* the loops back, as sidings under the track */}
          {LOOPS.map((loop) => (
            <g key={loop.label}>
              <path
                d={loop.d}
                fill="none"
                stroke="#a78bfa"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <text
                x={loop.labelX}
                y={loop.labelY}
                textAnchor="middle"
                fontSize={15}
                fill="#a8bbe2"
              >
                {loop.label}
              </text>
            </g>
          ))}

          {/* the stations */}
          {WORKFLOW.stages.map((stage, i) => (
            <g key={stage}>
              <text
                x={STAGE_X[i]}
                y={32}
                textAnchor="middle"
                fontSize={16}
                fontWeight={700}
                fill={i === FOCUS ? '#ffffff' : '#a8bbe2'}
              >
                {stage}
              </text>
              <g opacity={i === FOCUS ? 1 : 0.6}>
                <Tick x={STAGE_X[i]} y={TRACK_Y} />
              </g>
              {i < DONE_UNTIL && <circle cx={STAGE_X[i]} cy={78} r={4} fill="#34d399" />}
            </g>
          ))}

          {/* the GO button, part of the picture */}
          <rect x={264} y={176} width={76} height={30} rx={5} fill="#2563eb" />
          <text x={302} y={197} textAnchor="middle" fontSize={15} fontWeight={700} fill="#ffffff">
            GO
          </text>
        </svg>
      </div>
    </div>
  );
}
