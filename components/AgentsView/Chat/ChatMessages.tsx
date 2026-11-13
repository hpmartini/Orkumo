import React from 'react';
import {
  Brain,
  ChevronRight,
  History,
  Wrench,
  CheckCircle2,
  XCircle,
  Sparkles,
} from 'lucide-react';
import {
  toolDiff,
  toolSummary,
  type ChatAnswer,
  type ChatBlock,
  type ChatItem,
  type ResultMessage,
} from '../../../utils/chatEvents';
import { splitImages } from '../../../utils/chatComposer';
import { agentImageUrl } from '../../../services/agentsApi';
import { ChatMarkdown, CopyButton } from './ChatMarkdown';

const focusRing = 'focus-visible:outline-2 focus-visible:outline-blue-400';

const Collapsible: React.FC<{
  summary: React.ReactNode;
  children: React.ReactNode;
  open?: boolean;
  tone?: string;
}> = ({ summary, children, open, tone = 'border-gray-800' }) => (
  <details open={open} className={`group my-1.5 rounded-md border ${tone} bg-gray-900/60`}>
    <summary
      className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer select-none text-xs text-gray-300 hover:text-white list-none [&::-webkit-details-marker]:hidden ${focusRing}`}
    >
      <ChevronRight
        size={13}
        aria-hidden
        className="shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
      />
      {summary}
    </summary>
    <div className="px-2 pb-2">{children}</div>
  </details>
);

const DiffView: React.FC<{ lines: { sign: string; text: string }[] }> = ({ lines }) => (
  <pre className="mt-1 max-h-80 overflow-auto rounded bg-gray-950 text-xs leading-snug font-mono">
    {lines.map((l, i) => (
      <div
        key={i}
        className={
          l.sign === '+'
            ? 'bg-emerald-900/40 text-emerald-200'
            : l.sign === '-'
              ? 'bg-red-900/40 text-red-200'
              : 'text-gray-300'
        }
      >
        <span className="select-none px-1.5 text-gray-500">{l.sign}</span>
        {l.text}
      </div>
    ))}
  </pre>
);

const ToolBlock: React.FC<{ block: Extract<ChatBlock, { type: 'tool' }> }> = ({ block }) => {
  const diff = toolDiff(block.name, block.input);
  const pending = block.result === undefined;
  return (
    <Collapsible
      tone={block.isError ? 'border-red-800/70' : 'border-gray-800'}
      summary={
        <>
          <Wrench size={12} aria-hidden className="shrink-0 text-gray-400" />
          <span className="font-medium text-gray-100">{block.name}</span>
          <span className="font-mono text-gray-400 truncate min-w-0">
            {toolSummary(block.input)}
          </span>
          <span className="ml-auto shrink-0 text-[11px] text-gray-500">
            {pending ? 'running…' : block.isError ? 'error' : diff ? `${diff.length} lines` : ''}
          </span>
        </>
      }
    >
      {diff ? (
        <DiffView lines={diff} />
      ) : (
        <pre className="mt-1 max-h-48 overflow-auto rounded bg-gray-950 p-2 text-xs font-mono text-gray-300">
          {JSON.stringify(block.input, null, 2)}
        </pre>
      )}
      {block.result !== undefined && (
        <pre
          className={`mt-1.5 max-h-64 overflow-auto rounded p-2 text-xs font-mono whitespace-pre-wrap ${block.isError ? 'bg-red-950/40 text-red-200' : 'bg-gray-950 text-gray-400'}`}
        >
          {block.result || '(no output)'}
        </pre>
      )}
    </Collapsible>
  );
};

export const AssistantBlock: React.FC<{ block: ChatBlock }> = ({ block }) => {
  if (!block) return null;
  if (block.type === 'text') return block.text ? <ChatMarkdown text={block.text} /> : null;
  if (block.type === 'thinking')
    return (
      <Collapsible
        summary={
          <>
            <Brain size={12} aria-hidden className="text-purple-300" /> Thinking
          </>
        }
      >
        <div className="text-xs text-gray-400 whitespace-pre-wrap">
          {block.text || '(not shown by the CLI)'}
        </div>
      </Collapsible>
    );
  return <ToolBlock block={block} />;
};

const UserMessage: React.FC<{ text: string }> = ({ text }) => {
  const { text: body, images } = splitImages(text);
  const previews = images.map((p) => ({ path: p, url: agentImageUrl(p) }));
  return (
    <div className="flex justify-end my-3">
      <div className="max-w-[85%] rounded-lg bg-blue-900/50 border border-blue-800/60 px-3 py-2 text-sm text-gray-100 whitespace-pre-wrap break-words">
        {body}
        {previews.length > 0 && (
          <div className={`flex flex-wrap gap-1.5 ${body ? 'mt-2' : ''}`}>
            {previews.map(({ path, url }) =>
              url ? (
                <a key={path} href={url} target="_blank" rel="noreferrer" title={path}>
                  <img
                    src={url}
                    alt="Attached image"
                    loading="lazy"
                    className="h-20 max-w-[10rem] rounded border border-blue-800/60 object-cover hover:opacity-90"
                  />
                </a>
              ) : (
                <span key={path} className="text-xs text-blue-200/80 font-mono">
                  [Image: {path}]
                </span>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/** 12.3 s · 4 min 12 s · 1 h 5 min */
export function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min ${Math.round(s % 60)} s`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

function resultLabel(result: ResultMessage): string {
  if (result.ok) return 'Done';
  return result.subtype === 'error_during_execution' ? 'Interrupted' : `Error (${result.subtype})`;
}

const ResultMark: React.FC<{ result: ResultMessage }> = ({ result }) => (
  <>
    {result.ok ? (
      <CheckCircle2 size={12} aria-hidden className="text-emerald-500" />
    ) : (
      <XCircle size={12} aria-hidden className="text-red-400" />
    )}
    <span className={result.ok ? 'text-gray-400' : 'text-red-300'}>{resultLabel(result)}</span>
    {result.durationMs !== null && (
      <span className="tabular-nums">· {formatDuration(result.durationMs)}</span>
    )}
  </>
);

const Working: React.FC = () => (
  <span className="flex items-center gap-1.5 text-blue-300" role="status">
    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse motion-reduce:animate-none" />
    Working…
  </span>
);

interface AnswerCardProps {
  answer: ChatAnswer | null;
  showSteps: boolean;
  /** The agent is still on this turn */
  live: boolean;
  /** Harness name for the header ("Claude Code", "omp") */
  harness: string;
  /** Session model, when the messages do not name theirs */
  model: string | null;
}

/**
 * One turn's answer: the assistant messages between a prompt and its result in one card,
 * left-aligned (the prompt sits right). Text renders as markdown; thinking and tool calls stay
 * collapsible inside while steps are shown. `answer` null: the agent works on a prompt and has
 * not written yet.
 */
const AnswerCard: React.FC<AnswerCardProps> = ({ answer, showSteps, live, harness, model }) => {
  const parts = answer?.parts ?? [];
  const blocks = parts.flatMap((m) => m.blocks).filter(Boolean);
  const visible = showSteps ? blocks : blocks.filter((b) => b.type === 'text');
  const hasBody = visible.some((b) => b.type !== 'text' || b.text);
  const steps = blocks.filter((b) => b.type === 'tool').length;
  const text = blocks
    .filter((b): b is Extract<ChatBlock, { type: 'text' }> => b.type === 'text' && !!b.text)
    .map((b) => b.text)
    .join('\n\n');
  const named = [...parts].reverse().find((m) => m.model)?.model;
  const shownModel = (named ?? model ?? '').replace(/^.*\//, '');
  const result = answer?.result ?? null;
  const working = live || parts.some((m) => m.streaming);
  return (
    <article
      className="my-3 rounded-lg border border-gray-800 bg-gray-900/40"
      aria-label={`Answer from ${harness}`}
      aria-busy={working || undefined}
    >
      <header
        className={`flex items-center gap-1.5 h-7 px-3 text-[11px] text-gray-500 min-w-0 ${hasBody ? 'border-b border-gray-800/80' : ''}`}
      >
        <Sparkles size={12} aria-hidden className="shrink-0 text-blue-300" />
        <span className="shrink-0 font-medium text-gray-300">{harness}</span>
        {shownModel && <span className="truncate font-mono">{shownModel}</span>}
        <span className="flex-1" />
        {!showSteps && steps > 0 && (
          <span className="shrink-0" title="Tool calls of this answer (show steps to see them)">
            {steps} {steps === 1 ? 'step' : 'steps'}
          </span>
        )}
      </header>
      {hasBody && (
        <div className="px-3 py-2.5">
          {visible.map((b, i) => (
            <AssistantBlock key={i} block={b} />
          ))}
        </div>
      )}
      {(working || result || text) && (
        <footer
          className={`flex items-center gap-1.5 h-7 px-3 text-[11px] text-gray-500 ${hasBody ? 'border-t border-gray-800/80' : ''}`}
        >
          {working ? <Working /> : result ? <ResultMark result={result} /> : null}
          <span className="flex-1" />
          {text && !working && <CopyButton text={text} label="Copy answer" />}
        </footer>
      )}
    </article>
  );
};

const sameAnswer = (a: ChatAnswer | null, b: ChatAnswer | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.result === b.result &&
    a.parts.length === b.parts.length &&
    a.parts.every((m, i) => m === b.parts[i]));

/** Answers are regrouped on every event: memoized on their parts, not the group object */
const MemoAnswerCard = React.memo(
  AnswerCard,
  (prev, next) =>
    prev.showSteps === next.showSteps &&
    prev.live === next.live &&
    prev.harness === next.harness &&
    prev.model === next.model &&
    sameAnswer(prev.answer, next.answer)
);

export const ChatItemView: React.FC<{
  item: ChatItem | null;
  showSteps: boolean;
  live?: boolean;
  harness: string;
  model: string | null;
}> = ({ item, showSteps, live = false, harness, model }) => {
  if (!item || item.kind === 'answer')
    return (
      <MemoAnswerCard
        answer={item}
        showSteps={showSteps}
        live={live}
        harness={harness}
        model={model}
      />
    );
  return <PlainItem item={item} />;
};

const PlainItem: React.FC<{ item: Exclude<ChatItem, ChatAnswer> }> = React.memo(({ item }) => {
  switch (item.kind) {
    case 'user':
      return <UserMessage text={item.text} />;
    case 'recap':
      return (
        <div className="my-3 flex gap-2 rounded-md border border-gray-800 bg-gray-900/60 px-3 py-2 text-sm text-gray-300">
          <History size={14} aria-hidden className="mt-0.5 shrink-0 text-gray-500" />
          <div>
            <span className="text-gray-500">recap: </span>
            {item.text}
          </div>
        </div>
      );
    case 'result':
      // A result without an answer before it (an interrupted turn that wrote nothing)
      return (
        <div className="my-2 flex items-center gap-1.5 text-[11px] text-gray-500">
          <ResultMark result={item} />
        </div>
      );
    case 'notice':
      return (
        <div className={`my-2 text-xs ${item.tone === 'error' ? 'text-red-300' : 'text-gray-400'}`}>
          {item.text}
        </div>
      );
  }
});
PlainItem.displayName = 'PlainItem';
