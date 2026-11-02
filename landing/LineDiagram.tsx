import { useEffect, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { animate, motion, useMotionValue } from 'motion/react';
import { DEMO_PROJECTS, HERO } from './copy';
import { useReduceMotion } from './lib/media';

// Plan, Steer, Monitor, Review on the main line; Edit is a spur off Review that leads back to it,
// so editing is a loop inside review, never a station after the pull request.
const COLS = [150, 222, 294, 366];
const END = 430;
const LINE_Y = [70, 120, 170, 220];
const SIDING = 20; // the Edit spur drops this far below its line, at 45°
const LINE_COLOR = ['#3b82f6', '#34d399', '#a78bfa', '#fbbf24'];
const ROSE = '#fb7185';
const FOCUS = 1; // Steer: the station with the waiting agent is the brightest thing
const STEP = 1.6;
const DWELL = 2.2;
const MONO = 'JetBrains Mono Variable, ui-monospace, monospace';

type Point = { x: number; y: number };
type Train = { line: number; color: string; rose?: boolean; edits?: boolean; from: number };

const TRAINS: Train[] = [
  { line: 0, color: ROSE, rose: true, from: 1 },
  { line: 1, color: LINE_COLOR[1], from: 2 },
  { line: 2, color: LINE_COLOR[2], edits: true, from: 0 },
  { line: 3, color: LINE_COLOR[3], from: 0 },
];

const REVIEW = COLS[3];
const EDIT = REVIEW + SIDING + 18; // Edit sits on a spur off Review

function trackPath(y: number) {
  return [
    `M ${COLS[0] - 18} ${y} H ${END}`,
    `M ${REVIEW} ${y} L ${REVIEW + SIDING} ${y + SIDING} H ${EDIT + 10}`,
  ];
}

/** waypoints of one run; the edit train takes the spur from Review to Edit and back */
function route(train: Train): { p: Point; hold: number }[] {
  const y = LINE_Y[train.line];
  const pts: { p: Point; hold: number }[] = [];
  for (let i = train.from; i < COLS.length; i++) {
    if (i === 3 && train.edits) {
      // Review, down the spur to Edit, back to Review, then on
      const knee = { x: REVIEW + SIDING, y: y + SIDING };
      pts.push({ p: { x: REVIEW, y }, hold: 0.5 });
      pts.push({ p: knee, hold: 0 });
      pts.push({ p: { x: EDIT, y: y + SIDING }, hold: 0.9 });
      pts.push({ p: knee, hold: 0 });
      pts.push({ p: { x: REVIEW, y }, hold: 0.4 });
      continue;
    }
    pts.push({ p: { x: COLS[i], y }, hold: train.rose && i === train.from ? DWELL : 0.5 });
  }
  pts.push({ p: { x: END - 8, y }, hold: 0 });
  return pts;
}

function TrainMark({ train, still }: { train: Train; still: boolean }) {
  const start = { x: COLS[train.from], y: LINE_Y[train.line] };
  const x = useMotionValue(start.x);
  const y = useMotionValue(start.y);
  const alpha = useMotionValue(1);
  const ring = useMotionValue(0); // the one pulse of the waiting train's ring
  const ringScale = useMotionValue(1);

  useEffect(() => {
    const start = { x: COLS[train.from], y: LINE_Y[train.line] };
    if (still) {
      // reduced motion or paused: a static snapshot with every train at its start station
      x.set(start.x);
      y.set(start.y);
      alpha.set(1);
      return;
    }
    const xs: number[] = [];
    const ys: number[] = [];
    const as: number[] = [];
    const ts: number[] = [];
    let t = 0;
    const push = (p: Point, a: number) => {
      xs.push(p.x);
      ys.push(p.y);
      as.push(a);
      ts.push(t);
    };
    for (const [i, { p, hold }] of route(train).entries()) {
      if (i > 0) t += STEP * 0.5;
      push(p, 1);
      if (hold) {
        t += hold;
        push(p, 1);
      }
    }
    // fade out at the end of the line, reappear at the start: last frame equals the first
    t += 0.3;
    push({ x: END - 8, y: LINE_Y[train.line] }, 0);
    t += 0.2;
    push(start, 0);
    t += 0.3;
    push(start, 1);
    const times = ts.map((v) => v / t);
    const opts = { duration: t, times, repeat: Infinity, ease: 'easeInOut' as const };
    const controls = [
      animate(x, xs, opts),
      animate(y, ys, opts),
      animate(alpha, as, { ...opts, ease: 'linear' as const }),
    ];
    if (train.rose) {
      // pulse once at the end of the dwell at Steer, then move on
      const a = (DWELL - 0.6) / t;
      const b = DWELL / t;
      const pulse = {
        duration: t,
        times: [0, a, b, 1],
        repeat: Infinity,
        ease: 'easeOut' as const,
      };
      controls.push(
        animate(ring, [0, 1, 0, 0], pulse),
        animate(ringScale, [1, 1, 1.9, 1.9], pulse)
      );
    }
    return () => controls.forEach((c) => c.stop());
  }, [train, still, x, y, alpha, ring, ringScale]);

  return (
    <motion.g style={{ x, y, opacity: alpha }}>
      <rect
        x={-14}
        y={-7}
        width={28}
        height={14}
        rx={7}
        fill={train.color}
        stroke="#0d1526"
        strokeWidth={2}
        opacity={train.rose ? 1 : 0.7}
      />
      {/* needs input: a hollow ring, so the state does not hang on the hue alone */}
      {train.rose && <circle cx={0} cy={-17} r={4} fill="none" stroke={ROSE} strokeWidth={2} />}
      {train.rose && (
        <motion.circle
          cx={0}
          cy={-17}
          r={4}
          fill="none"
          stroke={ROSE}
          strokeWidth={2}
          style={{ opacity: ring, scale: ringScale }}
        />
      )}
    </motion.g>
  );
}

function Tick({ x, y, small }: { x: number; y: number; small?: boolean }) {
  const h = small ? 7 : 10;
  const d = `M ${x} ${y - h} V ${y + h}`;
  return (
    <>
      <path d={d} stroke="#0d1526" strokeWidth={7} strokeLinecap="round" />
      <path d={d} stroke="#e8eefa" strokeWidth={3} strokeLinecap="round" />
    </>
  );
}

export function LineDiagram() {
  const [paused, setPaused] = useState(false);
  const reduce = useReduceMotion();
  const bottom = LINE_Y[LINE_Y.length - 1] + SIDING;
  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 450 ${bottom + 52}`}
        role="img"
        aria-label="Line diagram: four example projects run through Plan, Steer, Monitor and Review. Edit is a spur off Review that leads back to it. One agent waits at Steer for input."
        className="block h-auto w-full"
      >
        <text x={0} y={14} fontSize={12} fill="#a8bbe2">
          {HERO.diagramLabel}
        </text>

        {COLS.map((cx, i) => (
          <g key={cx}>
            <path
              d={`M ${cx} 44 V ${bottom + 12}`}
              stroke="#34497a"
              strokeWidth={1}
              opacity={i === FOCUS ? 0.7 : 0.3}
            />
            <text
              x={cx}
              y={36}
              textAnchor="middle"
              fontSize={15}
              fontWeight={700}
              fill={i === FOCUS ? '#ffffff' : '#a8bbe2'}
            >
              {HERO.stations[i]}
            </text>
          </g>
        ))}
        <text
          x={EDIT}
          y={bottom + 34}
          textAnchor="middle"
          fontSize={15}
          fontWeight={700}
          fill="#a8bbe2"
        >
          {HERO.stations[4]}
        </text>
        <text x={EDIT} y={bottom + 49} textAnchor="middle" fontSize={11} fill="#a8bbe2">
          loop off Review
        </text>

        {LINE_Y.map((ly, i) => (
          <g key={ly}>
            {trackPath(ly).map((d) => (
              <path
                key={d}
                d={d}
                fill="none"
                stroke={LINE_COLOR[i]}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={i === 0 ? 0.9 : 0.5}
              />
            ))}
            <path
              d={`M ${END} ${ly - 7} V ${ly + 7}`}
              stroke={LINE_COLOR[i]}
              strokeWidth={3}
              strokeLinecap="round"
            />
            <text
              x={COLS[0] - 26}
              y={ly + 4.5}
              textAnchor="end"
              fontSize={13}
              fontFamily={MONO}
              fill="#c9d6f0"
            >
              {DEMO_PROJECTS[i]}
            </text>
          </g>
        ))}

        {COLS.map((cx, i) => (
          <g key={cx} opacity={i === FOCUS ? 1 : 0.6}>
            {LINE_Y.map((ly) => (
              <Tick key={ly} x={cx} y={ly} />
            ))}
          </g>
        ))}
        <g opacity={0.6}>
          {LINE_Y.map((ly) => (
            <Tick key={ly} x={EDIT} y={ly + SIDING} small />
          ))}
        </g>

        {TRAINS.map((train) => (
          <TrainMark key={train.line} train={train} still={reduce || paused} />
        ))}
      </svg>
      {!reduce && (
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
          className="mt-2 inline-flex items-center gap-1.5 rounded-[5px] px-1.5 py-1 text-[13px] text-muted transition-colors hover:text-text"
        >
          {paused ? <Play size={13} aria-hidden /> : <Pause size={13} aria-hidden />}
          {paused ? 'Play animation' : 'Pause animation'}
        </button>
      )}
    </figure>
  );
}
