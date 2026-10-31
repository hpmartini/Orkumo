import { useState } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';

const JACKS = [
  { id: 'ISSUE', x: 70, link: 'The board comment carries the agent session id.' },
  { id: 'AGENT', x: 205, link: 'One unmodified claude session, started from the issue.' },
  { id: 'WORKTREE', x: 340, link: 'The session works in its own worktree and branch.' },
  { id: 'PR', x: 475, link: 'The PR link lands in the session state; "Closes #n" points back.' },
  { id: 'CODE', x: 610, link: 'Open the diff in the editor with the context still attached.' },
] as const;
const CABLES = ['#3B82F6', '#8B5CF6', '#A3E635', '#3B82F6'];
const JACK_Y = 120;

type JackId = (typeof JACKS)[number]['id'];

function Cable({
  i,
  sway,
  active,
}: {
  i: number;
  sway: ReturnType<typeof useSpring>;
  active: boolean;
}) {
  const a = JACKS[i].x;
  const b = JACKS[i + 1].x;
  // cables sag under their own weight and lean toward the pointer
  const d = useTransform(
    sway,
    (s: number) =>
      `M ${a} ${JACK_Y} C ${a + 10 + s} ${JACK_Y + 120}, ${b - 10 + s} ${JACK_Y + 120}, ${b} ${JACK_Y}`
  );
  return (
    <g style={{ opacity: active ? 1 : 0.18, transition: 'opacity 250ms' }}>
      <motion.path
        d={d}
        stroke="#000"
        strokeOpacity={0.55}
        strokeWidth={9}
        fill="none"
        transform="translate(3 6)"
      />
      <motion.path d={d} stroke={CABLES[i]} strokeWidth={6} strokeLinecap="round" fill="none" />
    </g>
  );
}

export function Rack() {
  const reduce = useReducedMotion();
  const raw = useMotionValue(0);
  const sway = useSpring(raw, { stiffness: 40, damping: 9 });
  const [selected, setSelected] = useState<JackId | null>(null);
  const idx = selected ? JACKS.findIndex((j) => j.id === selected) : -1;
  const cableActive = (i: number) => idx < 0 || i === idx || i === idx - 1;

  return (
    <div
      className="module relative overflow-hidden p-4 sm:p-6"
      onPointerMove={(e) => {
        if (reduce) return;
        const r = e.currentTarget.getBoundingClientRect();
        raw.set(((e.clientX - r.left) / r.width - 0.5) * 70);
      }}
      onPointerLeave={() => raw.set(0)}
    >
      <div className="flex items-baseline justify-between border-b border-[#2a2d35] pb-3">
        <span className="silk text-sm text-ink">Context</span>
        <span className="font-mono text-xs text-muted">5 jacks · 4 cables</span>
      </div>
      <svg
        viewBox="0 0 680 280"
        className="mt-2 w-full"
        role="img"
        aria-label="Five jacks, Issue, Agent, Worktree, PR and Code, joined by patch cables"
      >
        {CABLES.map((_, i) => (
          <Cable key={i} i={i} sway={sway} active={cableActive(i)} />
        ))}
        {JACKS.map((j) => (
          <g
            key={j.id}
            style={{
              opacity:
                idx < 0 || cableActive(JACKS.indexOf(j)) || cableActive(JACKS.indexOf(j) - 1)
                  ? 1
                  : 0.35,
            }}
          >
            <circle cx={j.x} cy={JACK_Y} r={22} fill="#0b0c10" stroke="#4a4f5b" strokeWidth={3} />
            <circle cx={j.x} cy={JACK_Y} r={9} fill="#000" />
            <text
              x={j.x}
              y={JACK_Y - 40}
              textAnchor="middle"
              fill="#ece9e2"
              fontSize="15"
              fontFamily="JetBrains Mono Variable, monospace"
              fontWeight="600"
            >
              {j.id}
            </text>
          </g>
        ))}
        {/* the single live element: the agent is running */}
        <circle
          cx={JACKS[1].x + 34}
          cy={JACK_Y - 46}
          r={6}
          fill="#FF3B30"
          style={{ filter: 'drop-shadow(1px 2px 5px rgba(255,59,48,.8))' }}
        >
          {!reduce && (
            <animate attributeName="opacity" values="1;.35;1" dur="1.6s" repeatCount="indefinite" />
          )}
        </circle>
      </svg>
      <div
        className="mt-2 grid grid-cols-5 gap-1.5"
        role="group"
        aria-label="Show one link of the chain"
      >
        {JACKS.map((j) => (
          <button
            key={j.id}
            type="button"
            aria-pressed={selected === j.id}
            onClick={() => setSelected(selected === j.id ? null : j.id)}
            className="min-h-12 rounded-[4px] border border-[#2f333c] bg-[#111318] px-1 font-mono text-[11px] text-muted transition-colors hover:border-signal-green hover:text-ink aria-pressed:border-signal-green aria-pressed:text-ink sm:text-xs"
          >
            {j.id}
          </button>
        ))}
      </div>
      <p className="mt-3 min-h-12 text-sm text-muted" aria-live="polite">
        {selected ? JACKS[idx].link : 'Pick a jack to trace its part of the chain.'}
      </p>
    </div>
  );
}
