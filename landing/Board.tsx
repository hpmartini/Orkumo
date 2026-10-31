import { useRef, type CSSProperties } from 'react';
import { useMotionValue, useMotionValueEvent, type MotionValue } from 'motion/react';
import { cn } from './lib/utils';

export const SLOTS = ['ISSUE', 'AGENT', 'WORKTREE', 'PR', 'CODE'] as const;

export type Andon = 'red' | 'amber' | 'green' | 'off';

const LAMP_ORDER = ['red', 'amber', 'green'] as const;

const ANDON_TEXT: Record<Andon, string> = {
  red: 'needs input',
  amber: 'working',
  green: 'ready for review',
  off: 'no status',
};

function Lamps({ state }: { state: Andon }) {
  return (
    <span className="andon" aria-hidden>
      {LAMP_ORDER.map((color) => (
        <span
          key={color}
          className="andon-lamp"
          data-color={color}
          data-state={state === color ? 'on' : 'off'}
        />
      ))}
    </span>
  );
}

function AndonLight({ state }: { state: Andon }) {
  return (
    <>
      <Lamps state={state} />
      <span className="sr-only">Status: {ANDON_TEXT[state]}</span>
    </>
  );
}

function Card({ andon, ghost }: { andon: Andon; ghost?: boolean }) {
  return (
    <div className={cn('tcard', ghost && 'tcard--ghost')}>
      <div className="tcard-head">
        <span className="tcard-id">#142</span>
        {ghost ? <Lamps state="off" /> : <AndonLight state={andon} />}
      </div>
      <p className="tcard-title">Add retry to webhook</p>
      <p className="tcard-meta">feat/webhook-retry</p>
    </div>
  );
}

/**
 * The planning board: five slots and one task card. The card position is a
 * plain CSS variable (--i, in slots) so the walk can be driven by scroll
 * without re-rendering React on every frame.
 */
export function Board({
  index,
  andon = 'red',
  ghost = null,
  caption,
}: {
  index: number | MotionValue<number>;
  andon?: Andon;
  ghost?: number | null;
  caption?: string;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const still = useMotionValue(typeof index === 'number' ? index : 0);
  const position = typeof index === 'number' ? still : index;
  // the slot has to be in the markup: the prerendered HTML shows the card before the bundle runs
  const start = useRef(position.get()).current;
  const fixed = { '--i': typeof index === 'number' ? index : start } as CSSProperties;
  // only a plain number names the active slot, a motion value has no readable index here
  const active = typeof index === 'number' ? SLOTS[Math.round(index)] : undefined;

  useMotionValueEvent(position, 'change', (value) => {
    layerRef.current?.style.setProperty('--i', value.toFixed(4));
  });

  return (
    <div className="board">
      <div className="board-rail">
        <span className="tape label-tape">Planning board</span>
        <span className="label-tape text-muted">{caption ?? 'Example'}</span>
      </div>
      <div className="board-slots">
        {SLOTS.map((slot) => (
          <div className="board-col" key={slot}>
            <div className="board-label label-tape">
              <span className={cn('tape', slot === active && 'tape--red')}>{slot}</span>
            </div>
            <div className="board-slot" />
          </div>
        ))}
        <div className="board-card-layer" ref={layerRef} style={fixed}>
          {ghost !== null && (
            <div className="board-card" style={{ '--i': ghost } as CSSProperties}>
              <Card andon="off" ghost />
            </div>
          )}
          <div className="board-card">
            <Card andon={andon} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact static board row: the card stands in its slot, the slots it came
 * from are ghosted. Used where the scroll walk cannot run.
 */
export function Trail({ index, andon }: { index: number; andon: Andon }) {
  return (
    <ol className="trail">
      {SLOTS.map((slot, i) => (
        <li key={slot} className="trail-slot">
          <span className="trail-label label-tape">
            <span className="tape">{slot}</span>
          </span>
          {i < index && <span className="trail-card trail-card--ghost" aria-hidden />}
          {i === index && (
            <span className="trail-card">
              <AndonLight state={andon} />
            </span>
          )}
          {i > index && <span className="trail-card trail-card--empty" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}
