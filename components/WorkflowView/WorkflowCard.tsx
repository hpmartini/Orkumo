import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, GitPullRequest, Hand, Rocket } from 'lucide-react';
import type { AgentSession } from '../../types';
import type { WorkflowCard as Card } from '../../utils/workflows';
import { shortRepo } from '../../utils/board';
import { AgentGlyph, CheckIcon } from '../BoardView/BoardCard';
import { WorkflowDetails, WorkflowStats, type WorkflowNav } from './WorkflowDetails';

export const MODE_LABEL = {
  default: 'Standard',
  orchestrate: 'Orchestrate',
  pipeline: 'Pipeline',
  image: 'Bild',
};

const WAITING: Record<string, { text: string; className: string }> = {
  hape: { text: 'Wartet auf dich', className: 'text-amber-200' },
  agent: { text: 'Agent arbeitet', className: 'text-cursor' },
  poll: { text: 'Wartet auf den Poll', className: 'text-gray-400' },
};

interface WorkflowCardProps {
  card: Card;
  session?: AgentSession;
  expanded: boolean;
  /** stage changed on the last refresh: one highlight sweep */
  moved: boolean;
  onToggle: () => void;
  onGo: () => Promise<void>;
  nav: WorkflowNav;
}

/** Clicks on these stay with the control: GO, links, jumps in the details */
const INTERACTIVE = 'button, a, input, select, textarea';

/** Issue in a workflow stage: hover overlay with the essentials, a click anywhere expands, GO */
export const WorkflowCard: React.FC<WorkflowCardProps> = ({
  card,
  session,
  expanded,
  moved,
  onToggle,
  onGo,
  nav,
}) => {
  const { item, state } = card;
  const ref = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState(false);
  const waiting = state.waitingOn ? WAITING[state.waitingOn] : null;
  const needsGo = !!state.go;
  const pr = item.pullRequests[0];

  return (
    <motion.article
      layout
      layoutId={card.key}
      ref={ref}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      onMouseMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (r) setSpot({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setSpot(null);
      }}
      onFocus={() => setHover(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setHover(false);
      }}
      className={`group relative rounded-xl ${needsGo ? 'p-px' : ''} ${expanded ? 'z-20' : hover ? 'z-30' : 'z-0'}`}
    >
      {/* Waiting for Hape: a slowly turning light edge, the one place that asks for attention */}
      {needsGo && (
        <div aria-hidden="true" className="absolute inset-0 overflow-hidden rounded-xl">
          <div className="absolute -inset-[60%] motion-safe:animate-[spin_5s_linear_infinite] bg-[conic-gradient(from_0deg,transparent_0deg,#fcd34d_60deg,transparent_140deg,transparent_360deg)] opacity-80" />
        </div>
      )}
      <div
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest(INTERACTIVE)) onToggle();
        }}
        tabIndex={0}
        aria-label={`${card.key}: ${item.title}`}
        onKeyDown={(e) => {
          // Only the focused card itself; keys on GO and the jumps stay with them
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onToggle();
          }
        }}
        className={`relative cursor-pointer rounded-xl border bg-gray-900/95 transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-cursor ${
          needsGo ? 'border-transparent' : 'border-gray-750 hover:border-gray-700'
        } ${moved ? 'wf-moved' : ''}`}
      >
        {/* Spotlight following the pointer */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={
            spot
              ? {
                  background: `radial-gradient(220px circle at ${spot.x}px ${spot.y}px, rgba(143,208,255,0.12), transparent 70%)`,
                }
              : undefined
          }
        />
        <div className="relative p-3">
          <div className="flex items-center gap-2 text-[11px] text-gray-400">
            <AgentGlyph session={session} />
            <span className="min-w-0 truncate tabular-nums" title={`${item.repo}#${item.number}`}>
              {shortRepo(item.repo)}#{item.number}
            </span>
            <span className="ml-auto shrink-0 rounded-full border border-gray-750 px-1.5 leading-[18px] text-gray-300">
              {MODE_LABEL[state.mode]}
            </span>
            {/* The card toggles on click and Enter/Space; this button carries aria-expanded */}
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={expanded ? `Details zu ${card.key} schließen` : `Details zu ${card.key}`}
              title={expanded ? 'Weniger' : 'Details'}
              className="-mr-1 shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-850 hover:text-gray-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-cursor"
            >
              <ChevronDown
                size={14}
                className={`transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
              />
            </button>
          </div>
          <h3 className="mt-1.5 text-[13px] font-medium leading-snug text-gray-100 [text-wrap:balance] line-clamp-2">
            {item.title}
          </h3>
          <div className="mt-2 flex items-center gap-2 text-[11.5px]">
            {waiting && (
              <span className={`inline-flex items-center gap-1 ${waiting.className}`}>
                {state.waitingOn === 'hape' && <Hand size={11} />}
                {state.reason}
              </span>
            )}
            {state.phase && state.stage === 'building' && (
              <span className="rounded bg-gray-850 px-1.5 text-gray-200">{state.phase}</span>
            )}
            {pr && (
              <span className="ml-auto inline-flex items-center gap-1 text-gray-400">
                <GitPullRequest size={11} /> #{pr.number} <CheckIcon state={pr.checks} />
              </span>
            )}
          </div>

          {needsGo && (
            <GoButton
              label={state.go?.kind === 'build' ? 'GO: Umsetzung' : `GO: ${state.go?.stage}`}
              onGo={onGo}
            />
          )}
        </div>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="details"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <WorkflowDetails card={card} session={session} nav={nav} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Hover overlay: the essentials without opening the card */}
      <AnimatePresence>
        {hover && !expanded && (
          <motion.div
            role="tooltip"
            initial={{ opacity: 0, y: 4, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: 4, filter: 'blur(4px)' }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-none absolute left-2 right-2 top-full mt-1.5 rounded-lg border border-gray-700 bg-gray-950/95 p-3 text-[11.5px] text-gray-300 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6)] backdrop-blur"
          >
            <p className="font-medium text-gray-100">{item.title}</p>
            <WorkflowStats card={card} session={session} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
};

/** Two-step GO: the first click arms, the second sends; arming expires after 4 s */
const GoButton: React.FC<{ label: string; onGo: () => Promise<void> }> = ({ label, onGo }) => {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (!armed) {
          setArmed(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setArmed(false), 4000);
          return;
        }
        clearTimeout(timer.current);
        setBusy(true);
        try {
          await onGo();
        } finally {
          setBusy(false);
          setArmed(false);
        }
      }}
      className={`mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:cursor-wait disabled:opacity-60 ${
        armed
          ? 'bg-amber-300 text-gray-950 hover:bg-amber-200'
          : 'bg-amber-300/15 text-amber-100 hover:bg-amber-300/25'
      }`}
    >
      <Rocket size={13} />
      {busy ? 'Sende GO…' : armed ? 'Wirklich? Nochmal klicken' : label}
    </button>
  );
};
