import React from 'react';
import { Brain, ChevronRight, ShieldQuestion, Wrench, CheckCircle2, XCircle } from 'lucide-react';
import { toolDiff, toolSummary, type ChatBlock, type ChatMessage } from '../../../utils/chatEvents';
import { ChatMarkdown } from './ChatMarkdown';

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

const AssistantBlock: React.FC<{ block: ChatBlock }> = ({ block }) => {
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

type PermissionMessage = Extract<ChatMessage, { kind: 'permission' }>;

const PermissionCard: React.FC<{
  message: PermissionMessage;
  onAnswer: (requestId: string, decision: 'allow' | 'deny' | 'always') => void;
}> = ({ message, onAnswer }) => {
  const diff = toolDiff(message.toolName, message.input);
  const btn = `px-2.5 py-1 rounded-md text-xs font-medium ${focusRing} disabled:opacity-50`;
  return (
    <div
      role="group"
      aria-label={`Permission request: ${message.toolName}`}
      className="my-2 rounded-md border border-amber-600/60 bg-amber-950/30 p-2.5"
    >
      <div className="flex items-center gap-1.5 text-xs text-amber-100">
        <ShieldQuestion size={14} aria-hidden />
        <span className="font-medium">{message.toolName}</span>
        <span className="font-mono text-amber-200/80 truncate min-w-0">
          {toolSummary(message.input)}
        </span>
      </div>
      {message.description && (
        <div className="mt-1 text-xs text-gray-300">{message.description}</div>
      )}
      {diff ? (
        <DiffView lines={diff} />
      ) : (
        <pre className="mt-1 max-h-40 overflow-auto rounded bg-gray-950 p-2 text-xs font-mono text-gray-300">
          {JSON.stringify(message.input, null, 2)}
        </pre>
      )}
      {message.decision ? (
        <div className="mt-2 text-xs text-gray-400">
          {message.decision === 'deny'
            ? 'Denied'
            : message.decision === 'always'
              ? 'Always allowed'
              : 'Allowed'}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            autoFocus
            onClick={() => onAnswer(message.requestId, 'allow')}
            className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`}
          >
            Allow
          </button>
          {message.canAlways && (
            <button
              type="button"
              onClick={() => onAnswer(message.requestId, 'always')}
              className={`${btn} bg-gray-700 hover:bg-gray-600 text-gray-100`}
              title="Allow and apply the rule the CLI suggests for this session"
            >
              Always allow
            </button>
          )}
          <button
            type="button"
            onClick={() => onAnswer(message.requestId, 'deny')}
            className={`${btn} bg-red-700 hover:bg-red-600 text-white`}
          >
            Deny
          </button>
        </div>
      )}
    </div>
  );
};

export const ChatMessageView: React.FC<{
  message: ChatMessage;
  onAnswer: (requestId: string, decision: 'allow' | 'deny' | 'always') => void;
}> = React.memo(({ message, onAnswer }) => {
  switch (message.kind) {
    case 'user':
      return (
        <div className="flex justify-end my-3">
          <div className="max-w-[85%] rounded-lg bg-blue-900/50 border border-blue-800/60 px-3 py-2 text-sm text-gray-100 whitespace-pre-wrap break-words">
            {message.text}
          </div>
        </div>
      );
    case 'assistant':
      return (
        <div className="my-3">
          {message.blocks.map((b, i) => (
            <AssistantBlock key={i} block={b} />
          ))}
          {message.streaming && (
            <span className="inline-block w-1.5 h-4 align-middle bg-gray-400 animate-pulse motion-reduce:animate-none" />
          )}
        </div>
      );
    case 'permission':
      return <PermissionCard message={message} onAnswer={onAnswer} />;
    case 'result':
      return (
        <div className="my-2 flex items-center gap-1.5 text-[11px] text-gray-500">
          {message.ok ? (
            <CheckCircle2 size={12} aria-hidden className="text-emerald-500" />
          ) : (
            <XCircle size={12} aria-hidden className="text-red-400" />
          )}
          {message.ok
            ? 'Done'
            : message.subtype === 'error_during_execution'
              ? 'Interrupted'
              : `Error (${message.subtype})`}
          {message.durationMs !== null && ` · ${(message.durationMs / 1000).toFixed(1)} s`}
        </div>
      );
    case 'notice':
      return (
        <div
          className={`my-2 text-xs ${message.tone === 'error' ? 'text-red-300' : 'text-gray-400'}`}
        >
          {message.text}
        </div>
      );
  }
});
ChatMessageView.displayName = 'ChatMessageView';
