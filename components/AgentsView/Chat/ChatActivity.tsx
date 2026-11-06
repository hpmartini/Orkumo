import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  CheckSquare,
  ChevronRight,
  Circle,
  CircleDot,
  ListChecks,
  Loader2,
  SquareTerminal,
  X,
} from 'lucide-react';
import type { ChatBlock, ChatMessage } from '../../../utils/chatEvents';
import { toolSummary } from '../../../utils/chatEvents';
import { chatPlan, chatShells, chatSubagents, turnSteps } from '../../../utils/chatActivity';
import { fetchChatShell } from '../../../services/agentsApi';
import { AssistantBlock } from './ChatMessages';

const chip =
  'flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] focus-visible:outline-2 focus-visible:outline-blue-400 transition-colors';

/** One-line label of the latest step: "Bash npm test", "Thinking" */
function stepLabel(block: ChatBlock | undefined): string {
  if (!block) return 'Starting…';
  if (block.type === 'thinking') return 'Thinking…';
  if (block.type === 'tool') return `${block.name} ${toolSummary(block.input)}`.trim();
  return '';
}

/** Scroll box that keeps to the bottom while new content arrives */
const FollowBox: React.FC<{ children: React.ReactNode; dep: unknown; className?: string }> = ({
  children,
  dep,
  className = '',
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return (
    <div ref={ref} className={`overflow-y-auto ${className}`}>
      {children}
    </div>
  );
};

const ShellView: React.FC<{ chatId: string; shellId: string }> = ({ chatId, shellId }) => {
  const [data, setData] = useState<{ output: string; updatedAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchChatShell(chatId, shellId)
        .then((d) => {
          if (!cancelled) {
            setData(d);
            setError(null);
          }
        })
        .catch((e: Error) => !cancelled && setError(e.message));
    load();
    const timer = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [chatId, shellId]);
  if (error) return <div className="text-xs text-red-300">{error}</div>;
  if (!data) return <div className="text-xs text-gray-500">Loading…</div>;
  return (
    <>
      <FollowBox dep={data.output} className="max-h-64 rounded bg-black/60 p-2">
        <pre className="text-xs font-mono text-gray-200 whitespace-pre-wrap break-all">
          {data.output || '(no output yet)'}
        </pre>
      </FollowBox>
      <div className="mt-1 text-[10px] text-gray-500">
        updated {new Date(data.updatedAt).toLocaleTimeString()}
      </div>
    </>
  );
};

type Detail =
  | { kind: 'shell'; id: string; title: string }
  | { kind: 'agent'; id: string; title: string };

interface ChatActivityProps {
  chatId: string;
  messages: ChatMessage[];
  sub: Record<string, ChatBlock[]>;
  busy: boolean;
}

/** Above the input: plan with checkmarks, shells and sub-agents to look into, the running turn */
export const ChatActivity: React.FC<ChatActivityProps> = ({ chatId, messages, sub, busy }) => {
  const plan = useMemo(() => chatPlan(messages), [messages]);
  const shells = useMemo(() => chatShells(messages), [messages]);
  const agents = useMemo(() => chatSubagents(messages), [messages]);
  const steps = useMemo(() => turnSteps(messages), [messages]);
  const [planOpen, setPlanOpen] = useState(true);
  const [workOpen, setWorkOpen] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);

  const done = plan.filter((t) => t.status === 'completed').length;
  const runningAgents = agents.filter((a) => !a.done).length;
  if (!plan.length && !shells.length && !agents.length && !busy) return null;

  return (
    <div className="mb-2 space-y-1.5">
      {plan.length > 0 && (
        <div className="rounded-md border border-gray-800 bg-gray-900/70">
          <button
            type="button"
            onClick={() => setPlanOpen((o) => !o)}
            aria-expanded={planOpen}
            className="flex w-full items-center gap-1.5 px-2 py-1 text-xs text-gray-300 hover:text-white focus-visible:outline-2 focus-visible:outline-blue-400"
          >
            <ChevronRight
              size={13}
              aria-hidden
              className={`transition-transform motion-reduce:transition-none ${planOpen ? 'rotate-90' : ''}`}
            />
            <ListChecks size={13} aria-hidden className="text-emerald-400" />
            Plan
            <span className="text-gray-500 tabular-nums">
              {done}/{plan.length}
            </span>
          </button>
          {planOpen && (
            <ul className="max-h-40 overflow-y-auto px-2 pb-1.5 space-y-0.5" aria-label="Plan">
              {plan.map((t) => (
                <li key={t.id} className="flex items-start gap-1.5 text-xs">
                  {t.status === 'completed' ? (
                    <CheckSquare
                      size={13}
                      aria-label="done"
                      className="mt-px shrink-0 text-emerald-400"
                    />
                  ) : t.status === 'in_progress' ? (
                    <CircleDot
                      size={13}
                      aria-label="in progress"
                      className="mt-px shrink-0 text-blue-300"
                    />
                  ) : (
                    <Circle size={13} aria-label="open" className="mt-px shrink-0 text-gray-500" />
                  )}
                  <span
                    className={
                      t.status === 'completed'
                        ? 'text-gray-500 line-through'
                        : t.status === 'in_progress'
                          ? 'text-gray-100 font-medium'
                          : 'text-gray-300'
                    }
                  >
                    {t.subject}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(shells.length > 0 || agents.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {shells.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() =>
                setDetail(
                  detail?.id === s.id
                    ? null
                    : { kind: 'shell', id: s.id, title: s.description || s.command }
                )
              }
              aria-pressed={detail?.id === s.id}
              title={s.command}
              className={`${chip} ${detail?.id === s.id ? 'border-blue-400 text-white bg-blue-500/15' : 'border-gray-700 text-gray-300 hover:border-gray-500'}`}
            >
              <SquareTerminal size={11} aria-hidden />
              <span className="max-w-[12rem] truncate">{s.description || s.command}</span>
            </button>
          ))}
          {agents.map((a) => (
            <button
              key={a.toolId}
              type="button"
              onClick={() =>
                setDetail(
                  detail?.id === a.toolId
                    ? null
                    : { kind: 'agent', id: a.toolId, title: `${a.type}: ${a.description}` }
                )
              }
              aria-pressed={detail?.id === a.toolId}
              className={`${chip} ${detail?.id === a.toolId ? 'border-blue-400 text-white bg-blue-500/15' : 'border-gray-700 text-gray-300 hover:border-gray-500'}`}
            >
              {a.done ? (
                <Bot
                  size={11}
                  aria-hidden
                  className={a.isError ? 'text-red-400' : 'text-emerald-400'}
                />
              ) : (
                <Loader2
                  size={11}
                  aria-hidden
                  className="animate-spin motion-reduce:animate-none text-blue-300"
                />
              )}
              <span className="max-w-[12rem] truncate">
                {a.type} · {a.description}
              </span>
            </button>
          ))}
          {runningAgents > 0 && (
            <span className="text-[11px] text-gray-500">{runningAgents} running</span>
          )}
        </div>
      )}

      {detail && (
        <div className="rounded-md border border-gray-700 bg-gray-900/90 p-2">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-gray-300">
            {detail.kind === 'shell' ? (
              <SquareTerminal size={12} aria-hidden />
            ) : (
              <Bot size={12} aria-hidden />
            )}
            <span className="truncate min-w-0">{detail.title}</span>
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="ml-auto p-0.5 rounded text-gray-400 hover:text-white hover:bg-gray-700 focus-visible:outline-2 focus-visible:outline-blue-400"
              aria-label="Close"
            >
              <X size={12} />
            </button>
          </div>
          {detail.kind === 'shell' ? (
            <ShellView chatId={chatId} shellId={detail.id} />
          ) : (
            <FollowBox dep={sub[detail.id]?.length} className="max-h-72">
              {(sub[detail.id] ?? []).length === 0 ? (
                <div className="text-xs text-gray-500">No sub-agent output yet</div>
              ) : (
                sub[detail.id].map((b, i) => <AssistantBlock key={i} block={b} />)
              )}
            </FollowBox>
          )}
        </div>
      )}

      {busy && (
        <div className="rounded-md border border-blue-900/60 bg-gray-900/70">
          <button
            type="button"
            onClick={() => setWorkOpen((o) => !o)}
            aria-expanded={workOpen}
            className="flex w-full items-center gap-1.5 px-2 py-1 text-xs text-gray-300 hover:text-white focus-visible:outline-2 focus-visible:outline-blue-400"
          >
            <ChevronRight
              size={13}
              aria-hidden
              className={`shrink-0 transition-transform motion-reduce:transition-none ${workOpen ? 'rotate-90' : ''}`}
            />
            <Loader2
              size={12}
              aria-hidden
              className="shrink-0 animate-spin motion-reduce:animate-none text-blue-300"
            />
            <span className="truncate min-w-0 font-mono text-gray-400">
              {stepLabel(steps[steps.length - 1])}
            </span>
            <span className="ml-auto shrink-0 text-gray-500 tabular-nums">
              {steps.length} steps
            </span>
          </button>
          {workOpen && (
            <FollowBox dep={steps} className="max-h-64 px-2 pb-1">
              {steps.map((b, i) => (
                <AssistantBlock key={i} block={b} />
              ))}
            </FollowBox>
          )}
        </div>
      )}
    </div>
  );
};
